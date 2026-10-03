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

function getCurrentDetailRoot(route, postIds, courseIds) {
    if (!["a", "m", "p"].includes(route.kind)) return null;
    const usesPostShell = ["m", "p"].includes(route.kind);
    const selector = 'main, [role="main"], .Iwp0Ue.xWw7yd' + (usesPostShell ? ", .EE538" : "");
    const candidates = Array.from(document.querySelectorAll(selector))
        .filter((node) => isVisiblePostElement(node) && node.getClientRects().length > 0)
        .filter((node) => belongsToCurrentPost(node, postIds, courseIds))
        .filter((node) => {
            // Material and announcement details can put the file cards beside
            // empty post controls in this shell. Require a visible current-post
            // marker inside it; never infer a post from a file alone.
            if (usesPostShell && node.matches(".EE538")) {
                return Array.from(node.querySelectorAll("[data-stream-item-id]"))
                    .some((post) => postIds.has(post.getAttribute("data-stream-item-id"))
                        && belongsToCurrentPost(post, postIds, courseIds)
                        && isVisiblePostElement(post) && post.getClientRects().length > 0);
            }
            return Array.from(node.querySelectorAll("h1")).filter(isVisiblePostElement).length === 1;
        })
        .filter((node) => !Array.from(node.querySelectorAll("[data-stream-item-id]"))
            .some((post) => isVisiblePostElement(post) && !belongsToCurrentPost(post, postIds, courseIds)));
    // Prefer the smallest detail surface when a main contains a detail shell.
    const roots = candidates.filter((node) => !candidates.some((other) => node !== other && node.contains(other)));
    return roots.length === 1 ? roots[0] : null;
}

function rememberCurrentDetailContent(root, route, postIds, courseIds) {
    const identity = `${route.courseId}/${route.kind}/${route.postId}`;
    const headings = Array.from(root.querySelectorAll("h1")).filter(isVisiblePostElement);
    // Classroom does not consistently put data-drive-id/data-item-id on its
    // detail cards. The verified post boundary scopes the scan; supported URLs
    // identify its files. Track the actual links so unmarked cards also retain
    // their ownership while Classroom switches posts.
    const links = Array.from(root.querySelectorAll("a[href]"))
        .filter((anchor) => parseGoogleAttachmentUrl(anchor.href))
        .filter((anchor) => belongsToCurrentPost(anchor, postIds, courseIds)
            && isVisiblePostElement(anchor) && anchor.getClientRects().length > 0);
    const signatures = new Map([...headings, ...links].map((node) => [node,
        `${node.textContent}|${node.getAttribute("href") || ""}`,
    ]));
    const isUnchangedOldNode = (node) => {
        const owner = detailOwners.get(node);
        return owner && owner.identity !== identity && owner.signature === signatures.get(node);
    };
    // Google may update a heading/link in place. Changed content can acquire a
    // new owner; unchanged links from the old post must wait for rendering.
    if (links.some(isUnchangedOldNode) || (signatures.size > 0 && [...signatures.keys()].every(isUnchangedOldNode))) return false;
    signatures.forEach((signature, node) => detailOwners.set(node, { identity, signature }));
    return true;
}

function collectCurrentPostAttachments(request = {}) {
    if (request.selectionToken || request.postId) {
        return collectSelectedStreamAttachments(request);
    }
    const pageUrl = location.href;
    const route = getCurrentPostRoute(pageUrl);
    const response = { files: [], pageUrl, postId: route?.postId || null, scope: "not-post" };

    if (!route) {
        return response;
    }

    const postIds = classroomIdVariants(route.postId);
    const courseIds = classroomIdVariants(route.courseId);
    let roots = Array.from(document.querySelectorAll("[data-stream-item-id]"))
        .filter((node) => node.tagName !== "BODY" && node.tagName !== "HTML")
        .filter((node) => postIds.has(node.getAttribute("data-stream-item-id")))
        .filter((node) => belongsToCurrentPost(node, postIds, courseIds) && isVisiblePostElement(node));

    // Details can put the current post ID on menu/toolbar elements beside the
    // attachments. Prefer the verified detail surface over those partial roots.
    const detailRoot = getCurrentDetailRoot(route, postIds, courseIds);
    if (detailRoot) {
        if (!rememberCurrentDetailContent(detailRoot, route, postIds, courseIds)) {
            response.scope = "unavailable";
            return response;
        }
        roots = [detailRoot];
    }
    if (roots.length === 0) {
        response.scope = "unavailable";
        return response;
    }

    const filesById = new Map();
    for (const root of roots) {
        for (const anchor of root.querySelectorAll("a[href]")) {
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
        sendResponse(collectCurrentPostAttachments(request));
    }
});

function getCurrentStreamRoute(pageUrl) {
    try {
        const url = new URL(pageUrl);
        if (url.origin !== "https://classroom.google.com") return null;
        const match = url.pathname.match(/^\/(?:u\/\d+\/)?c\/([A-Za-z0-9_-]+)\/?$/);
        return match ? { courseId: match[1] } : null;
    } catch (error) {
        return null;
    }
}

function canonicalClassroomId(id) {
    const variants = classroomIdVariants(id);
    return [...variants].find((value) => /^\d+$/.test(value)) || id;
}

function isRenderedPostElement(element) {
    return isVisiblePostElement(element) && element.getClientRects().length > 0;
}

// A Stream marker can live on an empty menu beside the attachments. Use the
// card boundary observed in Classroom, never a common ancestor of the feed.
function describeStreamCard(root, route) {
    if (!root.isConnected || !isRenderedPostElement(root)) return null;
    if (Array.from(root.querySelectorAll(".n4xnA")).some(isRenderedPostElement)) return null;
    const markers = Array.from(root.querySelectorAll("[data-stream-item-id]"));
    if (root.hasAttribute("data-stream-item-id")) markers.push(root);
    const visibleMarkers = markers.filter(isRenderedPostElement);
    const ids = new Set(visibleMarkers.map((node) => canonicalClassroomId(node.getAttribute("data-stream-item-id"))));
    if (ids.size !== 1) return null;
    const postId = [...ids][0];
    if (!/^[A-Za-z0-9_-]+$/.test(postId)) return null;
    const postIds = classroomIdVariants(postId);
    // Include both representations if the card happens to mix encoded and
    // decimal markers; every marker must still name this one post and course.
    visibleMarkers.forEach((node) => postIds.add(node.getAttribute("data-stream-item-id")));
    const courseIds = classroomIdVariants(route.courseId);
    if (![root, ...visibleMarkers].every((node) => belongsToCurrentPost(node, postIds, courseIds))) return null;
    const filesById = new Map();
    for (const anchor of root.querySelectorAll("a[href]")) {
        if (!isRenderedPostElement(anchor) || !belongsToCurrentPost(anchor, postIds, courseIds)) continue;
        const file = buildAttachment(anchor);
        if (file && !filesById.has(file.id)) filesById.set(file.id, file);
    }
    return { root, postId, files: [...filesById.values()] };
}

function findStreamCards(route) {
    const cards = Array.from(document.querySelectorAll(".n4xnA"))
        .map((root) => describeStreamCard(root, route)).filter(Boolean);
    const counts = new Map();
    cards.forEach(({ postId }) => counts.set(postId, (counts.get(postId) || 0) + 1));
    // If Classroom renders two visible copies, require the user to open the
    // details rather than guessing which copy is the current attachment list.
    return cards.filter(({ postId }) => counts.get(postId) === 1);
}

const streamControls = new Map();
const STREAM_SELECTION_TTL_MS = 5 * 60 * 1000;
let selectedStreamPost = null;

function getSelectedStreamCard(request) {
    const route = getCurrentStreamRoute(location.href);
    const selection = selectedStreamPost;
    if (!route || !selection || Date.now() >= selection.expiresAt
        || selection.pageUrl !== location.href || selection.token !== request.selectionToken
        || selection.postId !== request.postId) return null;
    return findStreamCards(route).find((card) => card.root === selection.root && card.postId === selection.postId) || null;
}

function collectSelectedStreamAttachments(request) {
    const card = getSelectedStreamCard(request);
    return {
        files: card?.files || [], pageUrl: location.href,
        postId: card?.postId || null, scope: card ? "post" : "unavailable",
    };
}

function streamMessage(key, fallback, substitutions) {
    try {
        return chrome.i18n.getMessage(key, substitutions) || fallback;
    } catch (error) {
        return fallback;
    }
}

function renderStreamControls() {
    const route = getCurrentStreamRoute(location.href);
    const cards = route ? findStreamCards(route).filter((card) => card.files.length > 0) : [];
    const byRoot = new Map(cards.map((card) => [card.root, card]));
    for (const [root, control] of streamControls) {
        if (!byRoot.has(root) || !root.contains(control.row)) {
            control.row.remove();
            streamControls.delete(root);
        }
    }
    if (selectedStreamPost && !getSelectedStreamCard({
        postId: selectedStreamPost.postId, selectionToken: selectedStreamPost.token,
    })) selectedStreamPost = null;

    for (const card of cards) {
        let control = streamControls.get(card.root);
        if (!control) {
            const row = document.createElement("div");
            row.className = "classgrab-stream-controls";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "classgrab-stream-download";
            const status = document.createElement("span");
            status.className = "classgrab-stream-status";
            status.setAttribute("role", "status");
            status.setAttribute("aria-live", "polite");
            row.appendChild(button);
            row.appendChild(status);
            card.root.appendChild(row);
            control = { row, button, status };
            streamControls.set(card.root, control);
            button.addEventListener("click", async (event) => {
                // Scripts running in Classroom cannot turn a synthetic click
                // into a download. The selection token stays in this world.
                if (!event.isTrusted || button.disabled) return;
                event.preventDefault();
                event.stopPropagation();
                const currentRoute = getCurrentStreamRoute(location.href);
                const current = currentRoute && findStreamCards(currentRoute).find((item) => item.root === card.root);
                if (!current || current.files.length === 0) {
                    status.textContent = streamMessage("postChanged", "The current post changed. Review its files before downloading.");
                    renderStreamControls();
                    return;
                }
                const selection = {
                    root: current.root, postId: current.postId, pageUrl: location.href,
                    token: crypto.randomUUID(), expiresAt: Date.now() + STREAM_SELECTION_TTL_MS,
                };
                selectedStreamPost = selection;
                button.disabled = true;
                status.textContent = streamMessage("streamOpening", "Opening ClassGrab…");
                try {
                    const result = await chrome.runtime.sendMessage({
                        action: "openPostDownloads", token: selection.token,
                        postId: selection.postId, pageUrl: selection.pageUrl,
                    });
                    if (!result?.ok) throw new Error("popup unavailable");
                    status.textContent = "";
                } catch (error) {
                    if (selectedStreamPost === selection) selectedStreamPost = null;
                    status.textContent = streamMessage("streamOpenError", "ClassGrab could not open. Refresh Classroom and try again, or open this post’s details and use the extension icon.");
                } finally {
                    button.disabled = false;
                }
            });
        }
        const label = streamMessage("streamDownload", "ClassGrab · Download attachments");
        if (control.button.textContent !== label) control.button.textContent = label;
        const description = streamMessage("streamDownloadLabel", `Download ${card.files.length} attachment(s) from this post with ClassGrab`, [String(card.files.length)]);
        if (control.button.getAttribute("aria-label") !== description) control.button.setAttribute("aria-label", description);
    }
}

function rememberRenderedDetails() {
    const route = getCurrentPostRoute(location.href);
    if (!route) return;
    const postIds = classroomIdVariants(route.postId);
    const courseIds = classroomIdVariants(route.courseId);
    const root = getCurrentDetailRoot(route, postIds, courseIds);
    if (root) rememberCurrentDetailContent(root, route, postIds, courseIds);
}

// Remember ownership while Classroom renders, including visits where the
// popup was never opened. This prevents the first scan after Back/new-post
// navigation from assigning still-mounted old detail cards to the new URL.
function refreshClassroomView() {
    rememberRenderedDetails();
    renderStreamControls();
}

refreshClassroomView();
if (typeof MutationObserver === "function") {
    let pending = false;
    new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            refreshClassroomView();
        });
    }).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ["href", "hidden", "aria-hidden", "inert", "class", "style", "data-drive-id", "data-item-id", "data-stream-item-id", "data-course-id"],
    });
}
// Back/Forward can update the route before Classroom mutates its retained DOM.
if (typeof window !== "undefined") window.addEventListener("popstate", refreshClassroomView);
