const fileList = document.getElementById("fileList");
const selectAll = document.getElementById("selectAll");
const downloadSelectedButton = document.getElementById("downloadSelected");
const downloadAllButton = document.getElementById("downloadAll");
const statusPanel = document.getElementById("statusPanel");
const darkModeButton = document.getElementById("darkModeButton");
const body = document.getElementById("body");
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_BATCH_WORKERS = 4;
const fallbackMessages = {
    extensionName: "ClassGrab",
    availableFiles: "Available Files",
    selectAll: "Select All",
    downloadSelected: "Download Selected",
    downloadAll: "Download All",
    toggleTheme: "Toggle dark/light mode",
    viewSource: "View source code on GitHub",
    fileListLabel: "List of downloadable files",
    switchToLightMode: "Switch to Light Mode",
    switchToDarkMode: "Switch to Dark Mode",
    requestFailed: "Request failed.",
    precheckFallbackNote: "ClassGrab could not pre-check this Drive file, so it started the normal download flow.",
    driveConfirmationResolvedNote: "Google Drive required a confirmation step; ClassGrab resolved it automatically.",
    driveConfirmationManualNote: "Google Drive returned a confirmation page that ClassGrab could not resolve automatically.",
    downloadTrackingSaveWarning: "$1 started, but status tracking could not be saved.",
    manualConfirmationOpenError: "Could not open manual confirmation for $1: $2",
    selectAtLeastOneFile: "Select at least one file to download.",
    preparingFiles: "Preparing $1 file(s)...",
    summaryStarted: "$1 started",
    summaryManual: "$1 opened for manual confirmation",
    summaryFailed: "$1 failed",
    summaryDriveHandling: "$1 needed extra Drive handling",
    noDownloadsStarted: "No downloads were started.",
    notGoogleClassroom: "Not Google Classroom",
    classroomOnly: "This extension only works on Google Classroom pages.",
    openClassroom: "Open Classroom",
    activeTabReadError: "ClassGrab could not read the active tab. Try reopening the popup.",
    classroomConnectError: "ClassGrab could not connect to this Classroom tab. Refresh the Classroom page, then open ClassGrab again.",
    unexpectedClassroomResponse: "ClassGrab received an unexpected response from the Classroom tab.",
    refreshClassroomRetry: "Refresh the Classroom page and try again.",
    noSupportedFiles: "No supported Classroom attachment files found.",
    openClassPost: "Open a class post, assignment, or refresh the page.",
    fileFailed: "$1 failed: $2",
    downloadVerificationWarning: "$1 finished, but ClassGrab could not verify the downloaded file type.",
    htmlDownloadWarning: "$1 downloaded as an HTML page. Open the original Drive file and use Download anyway.",
    statusReady: "ready",
    statusPreparing: "preparing",
    statusStarted: "started",
    statusComplete: "complete",
    statusFailed: "failed",
    statusManual: "manual",
    statusTrackingWarning: "tracking warning",
    statusUnknown: "status unknown",
    statusHtmlWarning: "html warning",
};
const statusMessageKeys = {
    ready: "statusReady",
    preparing: "statusPreparing",
    started: "statusStarted",
    complete: "statusComplete",
    failed: "statusFailed",
    manual: "statusManual",
    "tracking warning": "statusTrackingWarning",
    "status unknown": "statusUnknown",
    "html warning": "statusHtmlWarning",
};

let authuser = null;
let files = [];
const fileStatusElements = new Map();
const pendingDownloads = new Map();

function t(messageName, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    const i18n =
        typeof chrome !== "undefined" &&
        chrome.i18n &&
        typeof chrome.i18n.getMessage === "function"
            ? chrome.i18n
            : null;
    const message = i18n
        ? (values.length > 0 ? i18n.getMessage(messageName, values) : i18n.getMessage(messageName))
        : "";

    if (message) {
        return message;
    }

    let fallback = fallbackMessages[messageName] || "";
    values.forEach((value, index) => {
        fallback = fallback.split(`$${index + 1}`).join(String(value));
    });
    return fallback || messageName;
}

function applyLocalizedText() {
    if (
        typeof chrome !== "undefined" &&
        chrome.i18n &&
        typeof chrome.i18n.getUILanguage === "function"
    ) {
        const uiLanguage = chrome.i18n.getUILanguage();
        if (uiLanguage) {
            document.documentElement.lang = uiLanguage.replace("_", "-");
        }
    }

    document.title = t("extensionName");

    document.querySelectorAll("[data-i18n]").forEach((element) => {
        element.textContent = t(element.dataset.i18n);
    });

    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
        element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
}

function localizedStatusLabel(label) {
    const messageKey = statusMessageKeys[label];
    return messageKey ? t(messageKey) : label;
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tagName);

    Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
    });

    return element;
}

function appendSvgElement(parent, tagName, attributes = {}) {
    const element = createSvgElement(tagName, attributes);
    parent.appendChild(element);
    return element;
}

function createThemeIcon(isDark) {
    const svg = createSvgElement("svg", {
        xmlns: SVG_NS,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        class: "svg-icon",
    });

    if (isDark) {
        appendSvgElement(svg, "circle", { cx: "12", cy: "12", r: "4" });
        appendSvgElement(svg, "path", { d: "M12 2v2" });
        appendSvgElement(svg, "path", { d: "M12 20v2" });
        appendSvgElement(svg, "path", { d: "M4.93 4.93l1.41 1.41" });
        appendSvgElement(svg, "path", { d: "M17.66 17.66l1.41 1.41" });
        appendSvgElement(svg, "path", { d: "M2 12h2" });
        appendSvgElement(svg, "path", { d: "M20 12h2" });
        appendSvgElement(svg, "path", { d: "M6.34 17.66l-1.41 1.41" });
        appendSvgElement(svg, "path", { d: "M19.07 4.93l-1.41 1.41" });
    } else {
        appendSvgElement(svg, "path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" });
    }

    return svg;
}

function setQueryParam(rawUrl, key, value) {
    try {
        const url = new URL(rawUrl);
        url.searchParams.set(key, value);
        return url.toString();
    } catch (error) {
        return rawUrl;
    }
}

function withAuthUser(rawUrl) {
    if (authuser === null) {
        return rawUrl;
    }

    return setQueryParam(rawUrl, "authuser", authuser);
}

function extractAuthUser(currentUrl) {
    try {
        const url = new URL(currentUrl);
        const authuserParam = url.searchParams.get("authuser");

        if (/^\d+$/.test(authuserParam || "")) {
            return authuserParam;
        }
    } catch (error) {
        // Fall back to the Classroom path parser below.
    }

    const authuserMatch = currentUrl.match(/\/u\/(\d+)\//);
    return authuserMatch ? authuserMatch[1] : null;
}

function setStatus(message, type = "info") {
    statusPanel.textContent = message;
    statusPanel.className = `status-panel status-${type}`;
    statusPanel.hidden = false;
}

function clearStatus() {
    statusPanel.hidden = true;
    statusPanel.textContent = "";
    statusPanel.className = "status-panel";
}

function setControlsDisabled(disabled) {
    selectAll.disabled = disabled || files.length === 0;
    downloadSelectedButton.disabled = disabled || files.length === 0;
    downloadAllButton.disabled = disabled || files.length === 0;
}

function updateFileStatus(fileId, label, type = "muted") {
    const statusElement = fileStatusElements.get(fileId);

    if (!statusElement) {
        return;
    }

    statusElement.textContent = localizedStatusLabel(label);
    statusElement.className = `file-status file-status-${type}`;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (response && response.ok === false) {
                reject(new Error(response.error || t("requestFailed")));
                return;
            }

            resolve(response);
        });
    });
}

function getSelectedFiles() {
    return Array.from(fileList.querySelectorAll(".file-checkbox"))
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => files.find((file) => file.id === checkbox.value))
        .filter(Boolean);
}

function extractDriveConfirmationUrl(html, baseUrl, fileId) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const candidates = [];
    let resourceKey = null;

    try {
        resourceKey = new URL(baseUrl).searchParams.get("resourcekey");
    } catch (error) {
        resourceKey = null;
    }

    document.querySelectorAll("a[href]").forEach((anchor) => {
        candidates.push(anchor.getAttribute("href"));
    });

    document.querySelectorAll("form[action]").forEach((form) => {
        try {
            const url = new URL(form.getAttribute("action"), baseUrl);
            form.querySelectorAll("input[name]").forEach((input) => {
                url.searchParams.set(input.getAttribute("name"), input.getAttribute("value") || "");
            });
            candidates.push(url.toString());
        } catch (error) {
            // Ignore malformed Drive form actions.
        }
    });

    for (const candidate of candidates) {
        try {
            const url = new URL(candidate.replace(/&amp;/g, "&"), baseUrl);
            const isDriveDownload =
                (url.hostname === "drive.google.com" && url.pathname.includes("/uc")) ||
                (url.hostname === "drive.usercontent.google.com" && url.pathname.includes("/download"));
            const hasConfirmation = url.searchParams.has("confirm");
            const idMatches = !fileId || !url.searchParams.has("id") || url.searchParams.get("id") === fileId;

            if (isDriveDownload && hasConfirmation && idMatches) {
                if (fileId && !url.searchParams.has("id")) {
                    url.searchParams.set("id", fileId);
                }

                if (resourceKey && !url.searchParams.has("resourcekey")) {
                    url.searchParams.set("resourcekey", resourceKey);
                }

                return url.toString();
            }
        } catch (error) {
            // Ignore malformed candidate URLs.
        }
    }

    const fallbackMatch = html.match(/confirm=([0-9A-Za-z_\-]+).*?[?&]id=([0-9A-Za-z_\-]+)/);
    if (fallbackMatch && (!fileId || fallbackMatch[2] === fileId)) {
        const url = new URL("https://drive.google.com/uc");
        url.searchParams.set("export", "download");
        url.searchParams.set("confirm", fallbackMatch[1]);
        url.searchParams.set("id", fallbackMatch[2]);
        if (resourceKey) {
            url.searchParams.set("resourcekey", resourceKey);
        }
        return url.toString();
    }

    return null;
}

async function prepareDownloadUrl(file) {
    const downloadUrl = withAuthUser(file.link);

    if (!downloadUrl.startsWith("https://drive.google.com/uc")) {
        return {
            url: downloadUrl,
            note: null,
        };
    }

    let response;

    try {
        response = await fetch(downloadUrl, {
            credentials: "include",
            redirect: "follow",
        });
    } catch (error) {
        return {
            url: downloadUrl,
            note: t("precheckFallbackNote"),
        };
    }

    const contentType = response.headers.get("content-type") || "";
    const contentDisposition = response.headers.get("content-disposition") || "";
    const finalUrl = withAuthUser(response.url || downloadUrl);
    const looksLikeHtml = contentType.toLowerCase().includes("text/html");

    if (!looksLikeHtml || contentDisposition.toLowerCase().includes("attachment")) {
        if (response.body) {
            await response.body.cancel();
        }

        return {
            url: finalUrl,
            note: null,
        };
    }

    const html = await response.text();
    const confirmedUrl = extractDriveConfirmationUrl(html, finalUrl, file.fileId);

    if (confirmedUrl) {
        return {
            url: withAuthUser(confirmedUrl),
            note: t("driveConfirmationResolvedNote"),
        };
    }

    return {
        manualUrl: file.viewUrl || file.originalUrl || finalUrl,
        note: t("driveConfirmationManualNote"),
    };
}

function startDownload(file, url) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download(
            {
                url,
                filename: file.name,
                saveAs: false,
                conflictAction: "uniquify",
            },
            (downloadId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (typeof downloadId !== "number") {
                    reject(new Error("Chrome did not return a download id."));
                    return;
                }

                pendingDownloads.set(downloadId, file);
                trackDownload(downloadId, file).catch((error) => {
                    updateFileStatus(file.id, "tracking warning", "warning");
                    setStatus(t("downloadTrackingSaveWarning", file.name), "warning");
                    console.error("ClassGrab download tracking failed:", error);
                });
                resolve(downloadId);
            },
        );
    });
}

function trackDownload(downloadId, file) {
    return sendRuntimeMessage({
        action: "trackDownload",
        downloadId,
        file: {
            id: file.id,
        },
    });
}

function restoreStoredStatuses() {
    chrome.runtime.sendMessage({ action: "getDownloadStatuses" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.statuses) {
            console.error("ClassGrab could not restore download statuses:", chrome.runtime.lastError);
            return;
        }

        files.forEach((file) => {
            const status = response.statuses[file.id];

            if (!status) {
                return;
            }

            updateFileStatus(file.id, status.label, status.type);
        });
    });
}

function openManualDownload(file, url) {
    updateFileStatus(file.id, "manual", "warning");
    return new Promise((resolve, reject) => {
        chrome.tabs.create({ url: withAuthUser(url) }, () => {
            if (chrome.runtime.lastError) {
                updateFileStatus(file.id, "failed", "error");
                reject(new Error(t("manualConfirmationOpenError", [file.name, chrome.runtime.lastError.message])));
                return;
            }

            resolve();
        });
    });
}

async function downloadBatch(targetFiles) {
    if (targetFiles.length === 0) {
        setStatus(t("selectAtLeastOneFile"), "warning");
        return;
    }

    setControlsDisabled(true);
    setStatus(t("preparingFiles", String(targetFiles.length)), "info");

    let started = 0;
    let manual = 0;
    let failed = 0;
    let notes = 0;
    let nextFileIndex = 0;
    let firstFailureMessage = null;

    async function downloadNextFiles() {
        while (nextFileIndex < targetFiles.length) {
            const file = targetFiles[nextFileIndex];
            nextFileIndex += 1;
            updateFileStatus(file.id, "preparing", "info");

            try {
                const prepared = await prepareDownloadUrl(file);

                if (prepared.note) {
                    notes += 1;
                }

                if (prepared.manualUrl) {
                    await openManualDownload(file, prepared.manualUrl);
                    manual += 1;
                    continue;
                }

                await startDownload(file, prepared.url);
                started += 1;
                updateFileStatus(file.id, "started", "success");
            } catch (error) {
                failed += 1;
                if (!firstFailureMessage) {
                    firstFailureMessage = error && error.message ? error.message : t("requestFailed");
                }
                updateFileStatus(file.id, "failed", "error");
                console.error("ClassGrab download failed:", file.name, error);
            }
        }
    }

    const workerCount = Math.min(MAX_BATCH_WORKERS, targetFiles.length);
    await Promise.all(Array.from({ length: workerCount }, () => downloadNextFiles()));

    const summary = [];
    if (started) summary.push(t("summaryStarted", String(started)));
    if (manual) summary.push(t("summaryManual", String(manual)));
    if (failed) summary.push(t("summaryFailed", String(failed)));
    if (notes) summary.push(t("summaryDriveHandling", String(notes)));

    const summaryMessage = summary.length ? summary.join(", ") : t("noDownloadsStarted");
    const statusMessage = firstFailureMessage ? `${summaryMessage}: ${firstFailureMessage}` : summaryMessage;
    setStatus(statusMessage, failed ? "error" : manual ? "warning" : "success");
    setControlsDisabled(false);
    restoreStoredStatuses();
}

function renderUnsupportedPage() {
    const container = document.createElement("div");
    container.className = "unsupported-container";

    const icon = document.createElement("div");
    icon.className = "unsupported-icon";
    icon.textContent = "!";

    const heading = document.createElement("h2");
    heading.textContent = t("notGoogleClassroom");

    const copy = document.createElement("p");
    copy.textContent = t("classroomOnly");

    const link = document.createElement("a");
    link.href = "https://classroom.google.com";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "primary-btn accent-btn center-btn";
    link.textContent = t("openClassroom");

    container.appendChild(icon);
    container.appendChild(heading);
    container.appendChild(copy);
    container.appendChild(link);

    document.querySelector(".main-content").replaceChildren(container);
}

function renderEmptyState(message, detail = null) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.appendChild(document.createTextNode(message));

    if (detail) {
        emptyState.appendChild(document.createElement("br"));
        emptyState.appendChild(document.createTextNode(detail));
    }

    fileList.replaceChildren(emptyState);
    setControlsDisabled(true);
}

function renderFiles(nextFiles) {
    files = nextFiles;
    fileStatusElements.clear();
    fileList.replaceChildren();
    clearStatus();

    files.forEach((file) => {
        const li = document.createElement("li");
        li.className = "file-item";

        const checkboxWrapper = document.createElement("label");
        checkboxWrapper.className = "checkbox-container";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "file-checkbox";
        checkbox.value = file.id;

        const checkmark = document.createElement("span");
        checkmark.className = "checkmark";

        checkboxWrapper.appendChild(checkbox);
        checkboxWrapper.appendChild(checkmark);

        const nameParts = file.name.split(".");
        const ext = nameParts.length > 1 ? nameParts.pop().toLowerCase() : "file";

        const iconWrapper = document.createElement("div");
        const knownExts = ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "zip", "rar", "jpg", "jpeg", "png", "gif", "py"];
        iconWrapper.className = knownExts.includes(ext)
            ? `file-icon-wrapper ext-${ext}`
            : "file-icon-wrapper file-icon-default";

        const iconText = document.createElement("span");
        iconText.className = "file-icon-text";
        iconText.textContent = ext.substring(0, 3).toUpperCase();
        iconWrapper.appendChild(iconText);

        const textWrapper = document.createElement("div");
        textWrapper.className = "file-text";

        const text = document.createElement("span");
        text.className = "file-name";
        text.textContent = file.name;

        const meta = document.createElement("span");
        meta.className = file.warning ? "file-meta file-meta-warning" : "file-meta";
        meta.textContent = file.warning || file.kind;
        meta.title = file.warning || file.kind;

        textWrapper.appendChild(text);
        textWrapper.appendChild(meta);

        const status = document.createElement("span");
        status.className = "file-status file-status-muted";
        status.textContent = localizedStatusLabel("ready");
        fileStatusElements.set(file.id, status);

        li.appendChild(checkboxWrapper);
        li.appendChild(iconWrapper);
        li.appendChild(textWrapper);
        li.appendChild(status);
        fileList.appendChild(li);

        li.addEventListener("click", (event) => {
            if (event.target !== checkbox && !checkboxWrapper.contains(event.target)) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            }
        });

        checkbox.addEventListener("change", () => {
            const checkboxes = Array.from(fileList.querySelectorAll(".file-checkbox"));
            selectAll.checked = checkboxes.length > 0 && checkboxes.every((cb) => cb.checked);
        });
    });

    setControlsDisabled(false);
}

function updateThemeUI(isDark) {
    darkModeButton.replaceChildren(createThemeIcon(isDark));
    darkModeButton.setAttribute("title", t(isDark ? "switchToLightMode" : "switchToDarkMode"));
}

function initializeTheme() {
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedTheme === "dark" || (!savedTheme && systemPrefersDark);

    body.classList.toggle("dm", shouldBeDark);
    updateThemeUI(shouldBeDark);
}

function loadFilesFromActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            renderEmptyState(t("activeTabReadError"));
            setStatus(chrome.runtime.lastError.message, "error");
            return;
        }

        const currentTab = tabs && tabs[0];
        const currentUrl = currentTab && currentTab.url;

        if (!currentUrl || !currentUrl.startsWith("https://classroom.google.com/")) {
            renderUnsupportedPage();
            return;
        }

        authuser = extractAuthUser(currentUrl);

        chrome.tabs.sendMessage(currentTab.id, { action: "getDriveLinks" }, (response) => {
            if (chrome.runtime.lastError) {
                renderEmptyState(t("classroomConnectError"));
                setStatus(chrome.runtime.lastError.message, "error");
                return;
            }

            if (!response || !Array.isArray(response.files)) {
                renderEmptyState(t("unexpectedClassroomResponse"));
                setStatus(t("refreshClassroomRetry"), "error");
                return;
            }

            if (response.files.length === 0) {
                renderEmptyState(t("noSupportedFiles"), t("openClassPost"));
                return;
            }

            renderFiles(response.files);
        });
    });
}

selectAll.addEventListener("change", () => {
    Array.from(fileList.querySelectorAll(".file-checkbox")).forEach((checkbox) => {
        checkbox.checked = selectAll.checked;
    });
});

downloadSelectedButton.addEventListener("click", () => {
    downloadBatch(getSelectedFiles());
});

downloadAllButton.addEventListener("click", () => {
    downloadBatch(files);
});

darkModeButton.addEventListener("click", () => {
    const isDark = body.classList.toggle("dm");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateThemeUI(isDark);
});

chrome.downloads.onChanged.addListener((delta) => {
    if (!pendingDownloads.has(delta.id)) {
        return;
    }

    const file = pendingDownloads.get(delta.id);

    if (delta.error) {
        updateFileStatus(file.id, "failed", "error");
        setStatus(t("fileFailed", [file.name, delta.error.current]), "error");
        pendingDownloads.delete(delta.id);
        return;
    }

    if (!delta.state || delta.state.current !== "complete") {
        return;
    }

    chrome.downloads.search({ id: delta.id }, (items) => {
        if (chrome.runtime.lastError) {
            updateFileStatus(file.id, "status unknown", "warning");
            setStatus(t("downloadVerificationWarning", file.name), "warning");
            console.error("ClassGrab download verification failed:", chrome.runtime.lastError);
            pendingDownloads.delete(delta.id);
            return;
        }

        const item = items && items[0];
        const downloadedName = item && item.filename ? item.filename.toLowerCase() : "";
        const mime = item && item.mime ? item.mime.toLowerCase() : "";
        const isHtmlDownload = downloadedName.endsWith(".htm") || downloadedName.endsWith(".html") || mime.includes("text/html");

        if (isHtmlDownload) {
            updateFileStatus(file.id, "html warning", "warning");
            setStatus(t("htmlDownloadWarning", file.name), "warning");
        } else {
            updateFileStatus(file.id, "complete", "success");
        }

        pendingDownloads.delete(delta.id);
    });
});

applyLocalizedText();
initializeTheme();
loadFilesFromActiveTab();
