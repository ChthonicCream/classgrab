const DOWNLOADS_KEY = "classgrabTrackedDownloads";
const STATUSES_KEY = "classgrabDownloadStatuses";
const STATUS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STATUSES = 100;
let storageOperationQueue = Promise.resolve();

function readStorage(keys) {
    return chrome.storage.local.get(keys);
}

function writeStorage(values) {
    return chrome.storage.local.set(values);
}

function queueStorageOperation(operation) {
    const result = storageOperationQueue.then(operation);
    storageOperationQueue = result.catch(() => {});
    return result;
}

function isHtmlDownload(item) {
    const downloadedName = item && item.filename ? item.filename.toLowerCase() : "";
    const mime = item && item.mime ? item.mime.toLowerCase() : "";

    return downloadedName.endsWith(".htm") || downloadedName.endsWith(".html") || mime.includes("text/html");
}

function isValidTrackedFile(file) {
    return file && typeof file.id === "string" && file.id.length > 0 && file.id.length <= 200;
}

function pruneStatuses(statuses) {
    const cutoff = Date.now() - STATUS_RETENTION_MS;

    return Object.fromEntries(
        Object.entries(statuses)
            .filter(([, status]) => status && (!status.updatedAt || status.updatedAt >= cutoff))
            .sort(([, left], [, right]) => (right.updatedAt || 0) - (left.updatedAt || 0))
            .slice(0, MAX_STATUSES),
    );
}

async function updateStoredStatus(file, label, type, message) {
    if (!isValidTrackedFile(file)) {
        throw new Error("Invalid tracked file metadata.");
    }

    const current = await readStorage([STATUSES_KEY]);
    const statuses = current[STATUSES_KEY] || {};

    statuses[file.id] = {
        label,
        type,
        message,
        updatedAt: Date.now(),
    };

    await writeStorage({ [STATUSES_KEY]: pruneStatuses(statuses) });
}

async function removeTrackedDownload(downloadId) {
    const current = await readStorage([DOWNLOADS_KEY]);
    const downloads = current[DOWNLOADS_KEY] || {};

    delete downloads[String(downloadId)];
    await writeStorage({ [DOWNLOADS_KEY]: downloads });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "trackDownload") {
        if (typeof request.downloadId !== "number" || !isValidTrackedFile(request.file)) {
            sendResponse({ ok: false, error: "Invalid download tracking request." });
            return false;
        }

        queueStorageOperation(async () => {
            const current = await readStorage([DOWNLOADS_KEY]);
            const downloads = current[DOWNLOADS_KEY] || {};
            downloads[String(request.downloadId)] = { id: request.file.id };
            await writeStorage({ [DOWNLOADS_KEY]: downloads });
            await updateStoredStatus(request.file, "started", "success", "Download started.");
        }).then(() => {
            sendResponse({ ok: true });
        }).catch((error) => {
            sendResponse({ ok: false, error: error.message });
        });

        return true;
    }

    if (request.action === "getDownloadStatuses") {
        queueStorageOperation(async () => {
            const current = await readStorage([STATUSES_KEY]);
            const statuses = pruneStatuses(current[STATUSES_KEY] || {});
            await writeStorage({ [STATUSES_KEY]: statuses });
            return statuses;
        }).then((statuses) => {
            sendResponse({ statuses });
        }).catch((error) => {
            sendResponse({ statuses: {}, error: error.message });
        });

        return true;
    }

    return false;
});

chrome.downloads.onChanged.addListener((delta) => {
    queueStorageOperation(async () => {
        const current = await readStorage([DOWNLOADS_KEY]);
        const downloads = current[DOWNLOADS_KEY] || {};
        const file = downloads[String(delta.id)];

        if (!file) {
            return;
        }

        if (delta.error) {
            await updateStoredStatus(file, "failed", "error", delta.error.current);
            await removeTrackedDownload(delta.id);
            return;
        }

        if (!delta.state || delta.state.current !== "complete") {
            return;
        }

        const items = await chrome.downloads.search({ id: delta.id });
        const item = items && items[0];
        const status = isHtmlDownload(item)
            ? {
                label: "html warning",
                type: "warning",
                message: "Google Drive returned an HTML confirmation page instead of the file.",
            }
            : {
                label: "complete",
                type: "success",
                message: "Download completed.",
            };

        await updateStoredStatus(file, status.label, status.type, status.message);
        await removeTrackedDownload(delta.id);
    }).catch((error) => {
        console.error("ClassGrab background download tracking failed:", error);
    });
});
