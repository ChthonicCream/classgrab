const GOOGLE_EDITOR_EXPORTS = {
    document: {
        kind: "Google Docs",
        extension: "docx",
        buildDownloadUrl: (fileId) => `https://docs.google.com/document/d/${fileId}/export?format=docx`,
    },
    spreadsheets: {
        kind: "Google Sheets",
        extension: "xlsx",
        buildDownloadUrl: (fileId) => `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`,
    },
    presentation: {
        kind: "Google Slides",
        extension: "pptx",
        buildDownloadUrl: (fileId) => `https://docs.google.com/presentation/d/${fileId}/export/pptx`,
    },
};

function appendQueryParam(rawUrl, key, value) {
    if (!value) {
        return rawUrl;
    }

    const url = new URL(rawUrl);
    url.searchParams.set(key, value);
    return url.toString();
}

function hasFilenameExtension(fileName) {
    return /\.[a-zA-Z][a-zA-Z0-9]{0,7}$/.test(fileName);
}

function hasExpectedExtension(fileName, extension) {
    return fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
}

function parseGoogleAttachmentUrl(rawUrl) {
    let url;

    try {
        url = new URL(rawUrl);
    } catch (error) {
        return null;
    }

    if (url.hostname === "drive.google.com") {
        let fileId = null;
        const filePathMatch = url.pathname.match(/\/file\/d\/([^/]+)/);

        if (filePathMatch) {
            fileId = filePathMatch[1];
        } else if (url.pathname === "/open" || url.pathname === "/uc") {
            fileId = url.searchParams.get("id");
        }

        if (!fileId) {
            return null;
        }

        const resourceKey = url.searchParams.get("resourcekey");
        const downloadUrl = new URL("https://drive.google.com/uc");
        downloadUrl.searchParams.set("export", "download");
        downloadUrl.searchParams.set("id", fileId);

        if (resourceKey) {
            downloadUrl.searchParams.set("resourcekey", resourceKey);
        }

        const viewUrl = appendQueryParam(`https://drive.google.com/file/d/${fileId}/view`, "resourcekey", resourceKey);

        return {
            key: `drive:${fileId}`,
            fileId,
            kind: "Google Drive file",
            defaultExtension: null,
            link: downloadUrl.toString(),
            viewUrl,
        };
    }

    if (url.hostname === "docs.google.com") {
        const editorMatch = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);

        if (!editorMatch) {
            return null;
        }

        const [, editorType, fileId] = editorMatch;
        const exportConfig = GOOGLE_EDITOR_EXPORTS[editorType];
        const resourceKey = url.searchParams.get("resourcekey");

        return {
            key: `${editorType}:${fileId}`,
            fileId,
            kind: exportConfig.kind,
            defaultExtension: exportConfig.extension,
            link: appendQueryParam(exportConfig.buildDownloadUrl(fileId), "resourcekey", resourceKey),
            viewUrl: appendQueryParam(`https://docs.google.com/${editorType}/d/${fileId}/edit`, "resourcekey", resourceKey),
        };
    }

    return null;
}

function cleanFileName(fileName, fallbackExtension = null) {
    if (!fileName) return null;

    let cleaned = fileName.trim();

    cleaned = cleaned.replace(/^(?:(?:Open Attachment|Attachment|PDF|Word Document|Microsoft Word|Microsoft Excel|Microsoft PowerPoint|Google Docs|Google Sheets|Google Slides|Document|Spreadsheet|Presentation)[\s:,\-]+)+/gi, "");
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/\s+/g, "_");
    cleaned = cleaned.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "");
    cleaned = cleaned.replace(/^\.+|\.+$/g, "");

    if (!cleaned) {
        return null;
    }

    if (fallbackExtension && !hasExpectedExtension(cleaned, fallbackExtension)) {
        cleaned = `${cleaned}.${fallbackExtension}`;
    } else if (!hasFilenameExtension(cleaned)) {
        if (!fallbackExtension) {
            return null;
        }

        cleaned = `${cleaned}.${fallbackExtension}`;
    }

    return cleaned;
}

function isGenericLabel(text) {
    const normalized = text.trim().toLowerCase();
    return [
        "attachment",
        "download",
        "drive file",
        "google docs",
        "google drive",
        "google sheets",
        "google slides",
        "open",
        "open attachment",
        "open in new window",
        "preview",
        "view",
    ].includes(normalized);
}

function extractFilenameCandidate(text, allowPlainTitle = false) {
    if (!text) {
        return null;
    }

    const trimmed = text.trim();
    const match = trimmed.match(/([^\\/:"*?<>|\r\n]+?\.[a-zA-Z0-9]{1,8})(?=\s|$|,|\))/);

    if (match) {
        return match[1].trim();
    }

    return allowPlainTitle && trimmed.length > 2 && !isGenericLabel(trimmed) ? trimmed : null;
}

function firstValidCandidate(candidates, fallbackExtension) {
    for (const candidate of candidates) {
        const cleaned = cleanFileName(candidate, fallbackExtension);

        if (cleaned) {
            return candidate;
        }
    }

    return null;
}

function extractFileName(anchor, fallbackExtension = null) {
    const candidates = [];
    const allowPlainTitle = Boolean(fallbackExtension);
    const ariaLabel = anchor.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
        candidates.push(extractFilenameCandidate(ariaLabel, allowPlainTitle));
    }

    const title = anchor.getAttribute("title");
    if (title && title.trim()) {
        candidates.push(extractFilenameCandidate(title, allowPlainTitle));
    }

    const textNodes = Array.from(anchor.querySelectorAll("div, span"));
    for (const node of textNodes) {
        const candidate = extractFilenameCandidate(node.textContent, allowPlainTitle);
        if (candidate) {
            candidates.push(candidate);
        }
    }

    const parent = anchor.closest("[data-item-id]") || anchor.closest('div[role="listitem"]');
    if (parent) {
        const matches = parent.textContent.match(/([^\\/:"*?<>|]+\.[a-zA-Z0-9]{1,8})/g);
        if (matches && matches.length > 0) {
            for (const match of matches) {
                const cleaned = match.trim();
                if (cleaned.length > 3) {
                    candidates.push(cleaned);
                }
            }
        }
    }

    return firstValidCandidate(candidates.filter(Boolean), fallbackExtension);
}

function buildAttachment(anchor) {
    const parsed = parseGoogleAttachmentUrl(anchor.href);

    if (!parsed) {
        return null;
    }

    const extractedName = extractFileName(anchor, parsed.defaultExtension);
    let fileName = cleanFileName(extractedName, parsed.defaultExtension);
    let warning = null;

    if (!fileName) {
        const extension = parsed.defaultExtension || "file";
        fileName = `drive-file-${parsed.fileId.slice(0, 12)}.${extension}`;
        warning = "ClassGrab could not read the original filename, so it generated a fallback name.";
    }

    return {
        id: parsed.key,
        fileId: parsed.fileId,
        name: fileName,
        link: parsed.link,
        originalUrl: anchor.href,
        viewUrl: parsed.viewUrl,
        kind: parsed.kind,
        warning,
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "getDriveLinks") {
        return;
    }

    const filesById = new Map();

    Array.from(document.querySelectorAll("a[href]"))
        .map(buildAttachment)
        .filter(Boolean)
        .forEach((file) => {
            if (!filesById.has(file.id)) {
                filesById.set(file.id, file);
            }
        });

    sendResponse({
        files: Array.from(filesById.values()),
    });
});
