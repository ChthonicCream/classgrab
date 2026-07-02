const DOWNLOADS_KEY = "classgrabTrackedDownloads";
const STATUSES_KEY = "classgrabDownloadStatuses";

function readStorage(keys) {
    return chrome.storage.local.get(keys);
}

function writeStorage(values) {
    return chrome.storage.local.set(values);
}

function isHtmlDownload(item) {
    const downloadedName = item && item.filename ? item.filename.toLowerCase() : "";
    const mime = item && item.mime ? item.mime.toLowerCase() : "";

    return downloadedName.endsWith(".htm") || downloadedName.endsWith(".html") || mime.includes("text/html");
}

async function updateStoredStatus(file, label, type, message) {
    const current = await readStorage([STATUSES_KEY]);
    const statuses = current[STATUSES_KEY] || {};

    statuses[file.id] = {
        label,
        type,
        message,
        updatedAt: Date.now(),
    };

    await writeStorage({ [STATUSES_KEY]: statuses });
}

async function removeTrackedDownload(downloadId) {
    const current = await readStorage([DOWNLOADS_KEY]);
    const downloads = current[DOWNLOADS_KEY] || {};

    delete downloads[String(downloadId)];
    await writeStorage({ [DOWNLOADS_KEY]: downloads });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "trackDownload") {
        readStorage([DOWNLOADS_KEY]).then((current) => {
            const downloads = current[DOWNLOADS_KEY] || {};
            downloads[String(request.downloadId)] = request.file;
            return writeStorage({ [DOWNLOADS_KEY]: downloads });
        }).then(() => {
            return updateStoredStatus(request.file, "started", "success", "Download started.");
        }).then(() => {
            sendResponse({ ok: true });
        }).catch((error) => {
            sendResponse({ ok: false, error: error.message });
        });

        return true;
    }

    if (request.action === "getDownloadStatuses") {
        readStorage([STATUSES_KEY]).then((current) => {
            sendResponse({ statuses: current[STATUSES_KEY] || {} });
        }).catch((error) => {
            sendResponse({ statuses: {}, error: error.message });
        });

        return true;
    }

    return false;
});

chrome.downloads.onChanged.addListener((delta) => {
    readStorage([DOWNLOADS_KEY]).then((current) => {
        const downloads = current[DOWNLOADS_KEY] || {};
        const file = downloads[String(delta.id)];

        if (!file) {
            return null;
        }

        if (delta.error) {
            return updateStoredStatus(file, "failed", "error", delta.error.current)
                .then(() => removeTrackedDownload(delta.id));
        }

        if (!delta.state || delta.state.current !== "complete") {
            return null;
        }

        return chrome.downloads.search({ id: delta.id }).then((items) => {
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

            return updateStoredStatus(file, status.label, status.type, status.message)
                .then(() => removeTrackedDownload(delta.id));
        });
    }).catch((error) => {
        console.error("ClassGrab background download tracking failed:", error);
    });
});
