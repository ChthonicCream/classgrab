const DOWNLOADS_KEY = "classgrabTrackedDownloads";
const STATUSES_KEY = "classgrabDownloadStatuses";
const STATUS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STATUSES = 100;
const DOWNLOAD_HOSTS = new Set(["drive.google.com", "drive.usercontent.google.com", "docs.google.com"]);
let storageOperationQueue = Promise.resolve();
const unsavedDownloads = new Map();

function readStorage(keys) {
    return chrome.storage.local.get(keys);
}

function writeStorage(values) {
    return chrome.storage.local.set(values);
}

// The duplicate check, browser download start, and tracking write share one queue.
// Two open popups therefore cannot both start the same attachment concurrently.
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

function isValidStartRequest(request) {
    if (!isValidTrackedFile(request.file) || typeof request.file.name !== "string"
        || !request.file.name.trim() || request.file.name.length > 1000
        || /[\\/\x00-\x1F]/.test(request.file.name)
        || (request.allowDuplicate !== undefined && typeof request.allowDuplicate !== "boolean")) {
        return false;
    }

    try {
        const url = new URL(request.url);
        return url.protocol === "https:" && DOWNLOAD_HOSTS.has(url.hostname)
            && !url.username && !url.password && (!url.port || url.port === "443");
    } catch {
        return false;
    }
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

function makeStatus(label, type, message) {
    return { label, type, message, updatedAt: Date.now() };
}

function settleStatus(statuses, file, status) {
    // A failed repeat attempt must not erase evidence of an earlier successful one.
    const previous = file.previousComplete;
    statuses[file.id] = status.label !== "complete" && previous
        && previous.updatedAt >= Date.now() - STATUS_RETENTION_MS
        ? { ...previous, lastAttempt: status }
        : status;
}

async function reconcileTrackedDownloads(onlyDownloadId = null, change = null) {
    const current = await readStorage([DOWNLOADS_KEY, STATUSES_KEY]);
    const downloads = { ...(current[DOWNLOADS_KEY] || {}), ...Object.fromEntries(unsavedDownloads) };
    const statuses = pruneStatuses(current[STATUSES_KEY] || {});

    for (const [downloadId, file] of Object.entries(downloads)) {
        if (onlyDownloadId !== null && String(onlyDownloadId) !== downloadId) {
            continue;
        }

        if (!isValidTrackedFile(file)) {
            delete downloads[downloadId];
            continue;
        }

        const items = await chrome.downloads.search({ id: Number(downloadId) });
        const item = items && items[0];
        let status = null;

        if (!item) {
            status = makeStatus("failed", "error", "Download no longer appears in browser history.");
        } else if (item.state === "interrupted" || (change && change.error && change.error.current)) {
            status = makeStatus("failed", "error", item.error || change?.error?.current || "Download interrupted.");
        } else if (item.state === "complete") {
            status = isHtmlDownload(item)
                ? makeStatus("html warning", "warning", "Google Drive returned an HTML confirmation page instead of the file.")
                : makeStatus("complete", "success", "Download completed.");
        }

        if (status) {
            settleStatus(statuses, file, status);
            delete downloads[downloadId];
        } else if (!statuses[file.id] || statuses[file.id].label !== "started") {
            statuses[file.id] = makeStatus("started", "success", "Download started.");
        }
    }

    const prunedStatuses = pruneStatuses(statuses);
    await writeStorage({ [DOWNLOADS_KEY]: downloads, [STATUSES_KEY]: prunedStatuses });
    unsavedDownloads.clear();
    return { downloads, statuses: prunedStatuses };
}

async function startTrackedDownload(request) {
    const { downloads, statuses } = await reconcileTrackedDownloads();
    const previous = statuses[request.file.id];
    const inProgress = Object.values(downloads).some((file) => file.id === request.file.id);

    if (inProgress || (!request.allowDuplicate && previous
        && (previous.label === "started" || previous.label === "complete"))) {
        return { ok: true, duplicate: true, inProgress, status: previous || makeStatus("started", "success", "Download started.") };
    }

    const downloadId = await chrome.downloads.download({
        url: request.url,
        filename: request.file.name,
        saveAs: false,
        conflictAction: "uniquify",
    });

    if (!Number.isInteger(downloadId) || downloadId < 0) {
        throw new Error("Chrome did not return a download id.");
    }

    downloads[String(downloadId)] = {
        id: request.file.id,
        ...(previous && previous.label === "complete" ? { previousComplete: previous } : {}),
    };
    statuses[request.file.id] = makeStatus("started", "success", "Download started.");
    unsavedDownloads.set(String(downloadId), downloads[String(downloadId)]);
    try {
        await writeStorage({ [DOWNLOADS_KEY]: downloads, [STATUSES_KEY]: pruneStatuses(statuses) });
        unsavedDownloads.delete(String(downloadId));
        // A small file can finish before tracking is written or onChanged is delivered.
        const reconciled = await reconcileTrackedDownloads(downloadId);
        return { ok: true, downloadId, status: reconciled.statuses[request.file.id] };
    } catch (error) {
        // The browser accepted the download. Do not misreport this as a failed
        // start and invite a duplicate retry. Keep the popup open with a warning.
        return { ok: true, downloadId, trackingWarning: true, status: statuses[request.file.id] };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== "string") {
        return false;
    }

    if (request.action === "startDownload") {
        if (!isValidStartRequest(request)) {
            sendResponse({ ok: false, error: "Invalid download request." });
            return false;
        }

        queueStorageOperation(() => startTrackedDownload(request))
            .then(sendResponse)
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (request.action === "trackDownload") {
        if (!Number.isInteger(request.downloadId) || request.downloadId < 0 || !isValidTrackedFile(request.file)) {
            sendResponse({ ok: false, error: "Invalid download tracking request." });
            return false;
        }

        queueStorageOperation(async () => {
            const current = await readStorage([DOWNLOADS_KEY, STATUSES_KEY]);
            const downloads = current[DOWNLOADS_KEY] || {};
            const statuses = current[STATUSES_KEY] || {};
            downloads[String(request.downloadId)] = { id: request.file.id };
            statuses[request.file.id] = makeStatus("started", "success", "Download started.");
            await writeStorage({ [DOWNLOADS_KEY]: downloads, [STATUSES_KEY]: pruneStatuses(statuses) });
            await reconcileTrackedDownloads(request.downloadId);
        }).then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));

        return true;
    }

    if (request.action === "getDownloadStatuses") {
        queueStorageOperation(() => reconcileTrackedDownloads())
            .then(({ statuses }) => sendResponse({ statuses }))
            .catch((error) => sendResponse({ statuses: {}, error: error.message }));
        return true;
    }

    return false;
});

chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.error && (!delta.state || !["complete", "interrupted"].includes(delta.state.current))) {
        return;
    }

    queueStorageOperation(() => reconcileTrackedDownloads(delta.id, delta)).catch((error) => {
        console.error("ClassGrab background download tracking failed:", error);
    });
});
