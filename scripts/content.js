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

function getCurrentPostRoute(pageUrl) {
    let url;

    try {
        url = new URL(pageUrl);
    } catch (error) {
        return null;
    }

    if (url.origin !== "https://classroom.google.com") {
        return null;
    }

    // A class Stream/Classwork view is not a post. In particular, do not fall
    // back to scanning the page when going Back leaves old detail views mounted.
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?c\/([A-Za-z0-9_-]+)\/(a|m|p)\/([A-Za-z0-9_-]+)(?:\/details)?\/?$/);
    return match ? { courseId: match[1], kind: match[2], postId: match[3] } : null;
}

function classroomIdVariants(id) {
    const variants = new Set([id]);

    try {
        // Classroom URLs encode IDs while data-stream-item-id and data-course-id
        // usually contain the decimal form. Only accept a decimal decoded ID.
        const decoded = atob(id.replace(/-/g, "+").replace(/_/g, "/"));
        if (/^\d+$/.test(decoded)) {
            variants.add(decoded);
        }
    } catch (error) {
        // The literal ID still works if this is not a base64-encoded route.
    }

    return variants;
}

function isVisiblePostElement(element) {
    for (let node = element; node; node = node.parentElement) {
        if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") {
            return false;
        }

        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
            return false;
        }
    }

    return true;
}

function belongsToCurrentPost(element, postIds, courseIds) {
    for (let node = element; node; node = node.parentElement) {
        const postId = node.getAttribute("data-stream-item-id");
        const courseId = node.getAttribute("data-course-id");
        if ((postId && !postIds.has(postId)) || (courseId && !courseIds.has(courseId))) {
            return false;
        }
    }

    return true;
}

// Details views can omit data-stream-item-id. Remember previously scanned
// unkeyed DOM nodes so a route change cannot relabel that same old content.
const detailOwners = new WeakMap();
const DETAIL_ATTACHMENT_SELECTOR = "[data-drive-id], [data-id][data-item-id]";

function getCurrentDetailRoot(route, postIds, courseIds) {
    if (route.kind !== "a" && route.kind !== "m") return null;
    const candidates = Array.from(document.querySelectorAll('main, [role="main"], .Iwp0Ue.xWw7yd'))
        .filter((node) => isVisiblePostElement(node) && node.getClientRects().length > 0)
        .filter((node) => belongsToCurrentPost(node, postIds, courseIds))
        .filter((node) => Array.from(node.querySelectorAll("h1")).filter(isVisiblePostElement).length === 1)
        .filter((node) => !Array.from(node.querySelectorAll("[data-stream-item-id]"))
            .some((post) => isVisiblePostElement(post)));
    // Prefer the smallest detail surface when a main contains a detail shell.
    const roots = candidates.filter((node) => !candidates.some((other) => node !== other && node.contains(other)));
    if (roots.length !== 1) return null;
    const root = roots[0];
    const identity = `${route.courseId}/${route.kind}/${route.postId}`;
    const headings = Array.from(root.querySelectorAll("h1")).filter(isVisiblePostElement);
    const cards = Array.from(root.querySelectorAll(DETAIL_ATTACHMENT_SELECTOR)).filter(isVisiblePostElement);
    const signatures = new Map([...headings, ...cards].map((node) => [node,
        `${node.textContent}|${Array.from(node.querySelectorAll("a[href]")).map((anchor) => anchor.href).join("|")}`,
    ]));
    const isUnchangedOldNode = (node) => {
        const owner = detailOwners.get(node);
        return owner && owner.identity !== identity && owner.signature === signatures.get(node);
    };
    // Google may update a heading/card in place. Changed content can acquire a
    // new owner; unchanged cards from the old post must wait for rendering.
    if (cards.some(isUnchangedOldNode) || [...signatures.keys()].every(isUnchangedOldNode)) return null;
    signatures.forEach((signature, node) => detailOwners.set(node, { identity, signature }));
    return root;
}

function collectCurrentPostAttachments() {
    const pageUrl = location.href;
    const route = getCurrentPostRoute(pageUrl);
    const response = { files: [], pageUrl, postId: route?.postId || null, scope: "not-post" };

    if (!route) {
        return response;
    }

    const postIds = classroomIdVariants(route.postId);
    const courseIds = classroomIdVariants(route.courseId);
    const roots = Array.from(document.querySelectorAll("[data-stream-item-id]"))
        .filter((node) => node.tagName !== "BODY" && node.tagName !== "HTML")
        .filter((node) => postIds.has(node.getAttribute("data-stream-item-id")))
        .filter((node) => belongsToCurrentPost(node, postIds, courseIds) && isVisiblePostElement(node));

    let detailRoot = null;
    if (roots.length === 0) {
        detailRoot = getCurrentDetailRoot(route, postIds, courseIds);
        if (!detailRoot) {
            response.scope = "unavailable";
            return response;
        }
        roots.push(detailRoot);
    }

    const filesById = new Map();
    for (const root of roots) {
        for (const anchor of root.querySelectorAll("a[href]")) {
            // On unkeyed detail views use actual attachment cards, never links
            // in comments, navigation, instructions, or the retained stream.
            if (root === detailRoot && !anchor.closest(DETAIL_ATTACHMENT_SELECTOR)) continue;
            if (!belongsToCurrentPost(anchor, postIds, courseIds) || !isVisiblePostElement(anchor) || anchor.getClientRects().length === 0) {
                continue;
            }

            const file = buildAttachment(anchor);
            if (file && !filesById.has(file.id)) {
                filesById.set(file.id, file);
            }
        }
    }

    response.scope = "post";
    response.files = Array.from(filesById.values());
    return response;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getDriveLinks") {
        sendResponse(collectCurrentPostAttachments());
    }
});

function rememberRenderedDetails() {
    const route = getCurrentPostRoute(location.href);
    if (route) getCurrentDetailRoot(route, classroomIdVariants(route.postId), classroomIdVariants(route.courseId));
}

// Remember ownership while Classroom renders, including visits where the
// popup was never opened. This prevents the first scan after Back/new-post
// navigation from assigning still-mounted old detail cards to the new URL.
rememberRenderedDetails();
if (typeof MutationObserver === "function") {
    let pending = false;
    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            rememberRenderedDetails();
        });
    }).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ["href", "hidden", "aria-hidden", "inert", "class", "style", "data-drive-id", "data-item-id"],
    });
}
