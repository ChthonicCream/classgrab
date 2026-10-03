const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../scripts/content.js"), "utf8");
const origin = "https://classroom.google.com";
const encodeId = (value) => Buffer.from(value).toString("base64").replace(/=+$/, "");
const postUrl = (id, type = "a") => `${origin}/u/0/c/${encodeId("101")}/${type}/${encodeId(id)}/details`;

// A small DOM fixture, not a Classroom snapshot. Keep fixtures synthetic so the
// regression suite can be shared without student, course, or Drive identifiers.
class Element {
    constructor(tagName, attrs = {}, children = []) {
        this.tagName = tagName.toUpperCase();
        this.attrs = attrs;
        this.children = children;
        this.parentElement = null;
        this.style = {};
        this.textContent = "";
        for (const child of children) child.parentElement = this;
    }

    get href() { return new URL(this.attrs.href, origin).href; }
    get className() { return this.attrs.class || ""; }
    set className(value) { this.attrs.class = value; }
    get isConnected() { return this.tagName === "HTML" || Boolean(this.parentElement?.isConnected); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
        this.parentElement = null;
    }
    addEventListener(type, handler) { (this.handlers ||= {})[type] = handler; }

    matches(selector) {
        return selector.split(",").some((part) => {
            const simple = part.trim();
            const tag = simple.match(/^[a-z][a-z0-9]*/i)?.[0];
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
            if (!classes.every((name) => (this.attrs.class || "").split(/\s+/).includes(name))) return false;
            return [...simple.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
                this.hasAttribute(name) && (value === undefined || this.attrs[name] === value));
        });
    }

    querySelectorAll(selector) {
        return this.children.flatMap((child) => [
            ...(child.matches(selector) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }

    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (node.matches(selector)) return node;
        }
        return null;
    }

    getClientRects() { return this.noLayout ? [] : [{}]; }
    contains(other) { return this === other || this.children.some((child) => child.contains(other)); }
}

const attachment = (id, attrs = {}) => new Element("a", {
    href: `https://drive.google.com/file/d/${id}/view`,
    "aria-label": `${id}.pdf`,
    ...attrs,
});
const post = (id, children, attrs = {}) => new Element("article", {
    "data-stream-item-id": id,
    "data-course-id": "101",
    ...attrs,
}, children);

function fixture(children, url = postUrl("202")) {
    const body = new Element("body", {}, children);
    const document = {
        body, documentElement: new Element("html", {}, [body]),
        querySelectorAll: (selector) => body.querySelectorAll(selector),
        createElement: (tag) => new Element(tag),
    };
    let listener;
    let now = Date.now();
    let tokenSequence = 0;
    let launchResult = { ok: true };
    const messages = [];
    const sandbox = {
        URL,
        Date: class extends Date { static now() { return now; } },
        crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++tokenSequence).padStart(12, "0")}` },
        document,
        location: { href: url },
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        getComputedStyle: (element) => ({ display: "block", visibility: "visible", ...element.style }),
        chrome: {
            i18n: { getMessage: () => "" },
            runtime: {
                onMessage: { addListener(callback) { listener = callback; } },
                sendMessage: async (request) => { messages.push(request); return launchResult; },
            },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return {
        body,
        messages,
        get buttons() { return body.querySelectorAll(".classgrab-stream-download"); },
        async click(index = 0, isTrusted = true) {
            await this.buttons[index].handlers.click({ isTrusted, preventDefault() {}, stopPropagation() {} });
        },
        advance(milliseconds) { now += milliseconds; },
        failLaunch() { launchResult = { ok: false }; },
        refresh() { sandbox.refreshClassroomView(); },
        navigate(nextUrl) { sandbox.location.href = nextUrl; },
        scan(request = {}) {
            let response;
            listener({ action: "getDriveLinks", ...request }, {}, (value) => { response = value; });
            return JSON.parse(JSON.stringify(response));
        },
    };
}

test("only the open post is extracted when a stream and old posts remain mounted", () => {
    const view = fixture([
        new Element("main", {}, [post("201", [attachment("stream-file")])]),
        post("202", [attachment("current-file")]),
        post("203", [attachment("other-file")]),
    ]);
    const result = view.scan();
    assert.equal(result.scope, "post");
    assert.equal(result.pageUrl, postUrl("202"));
    assert.equal(result.postId, encodeId("202"));
    assert.deepEqual(result.files.map((file) => file.fileId), ["current-file"]);
});

test("SPA back navigation clears the result and another post gets a fresh list", () => {
    const view = fixture([post("202", [attachment("first-file")]), post("203", [attachment("second-file")])]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["first-file"]);
    view.navigate(`${origin}/u/0/c/${encodeId("101")}`);
    assert.equal(view.scan().scope, "not-post");
    assert.deepEqual(view.scan().files, []);
    view.navigate(postUrl("203", "m"));
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["second-file"]);
});

test("hidden, aria-hidden, inert, and CSS-hidden cached nodes are excluded", () => {
    const hiddenDisplay = post("202", [attachment("display-none")]);
    hiddenDisplay.style.display = "none";
    const hiddenVisibility = post("202", [attachment("visibility-hidden")]);
    hiddenVisibility.style.visibility = "hidden";
    const noLayout = attachment("no-layout");
    noLayout.noLayout = true;
    const view = fixture([
        post("202", [attachment("hidden")], { hidden: "" }),
        new Element("div", { "aria-hidden": "true" }, [post("202", [attachment("aria-hidden")])]),
        new Element("div", { inert: "" }, [post("202", [attachment("inert")])]),
        hiddenDisplay,
        hiddenVisibility,
        post("202", [noLayout, attachment("visible")]),
    ]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["visible"]);
});

test("duplicate links and duplicate nested post markers produce one attachment", () => {
    const view = fixture([post("202", [
        attachment("same-file"),
        post(encodeId("202"), [attachment("same-file"), attachment("other-current-file")]),
    ])]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["same-file", "other-current-file"]);
});

test("nested unrelated post and course attachments cannot leak into the active post", () => {
    const view = fixture([post("202", [
        attachment("current-file"),
        post("203", [attachment("wrong-post")]),
        post("202", [attachment("wrong-course")], { "data-course-id": "999" }),
    ])]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["current-file"]);
});

test("an unidentifiable current post fails closed instead of scanning the document or main", () => {
    const view = fixture([
        new Element("main", {}, [attachment("unscoped-file")]),
        post("201", [attachment("old-post-file")]),
    ]);
    assert.equal(view.scan().scope, "unavailable");
    assert.deepEqual(view.scan().files, []);
});

test("a known empty post stays empty without adopting another post's attachments", () => {
    const view = fixture([post("202", []), post("201", [attachment("old-post-file")])]);
    assert.equal(view.scan().scope, "post");
    assert.deepEqual(view.scan().files, []);
});

test("assignments, material details, and announcement routes are supported", () => {
    for (const type of ["a", "m", "p"]) {
        for (const suffix of ["", "/details", "/details/"]) {
            const url = `${origin}/c/${encodeId("101")}/${type}/${encodeId("202")}${suffix}?authuser=0`;
            const view = fixture([post("202", [attachment("current-file")])], url);
            assert.equal(view.scan().scope, "post", url);
        }
    }
});

test("feeds, edit, submissions, and unsupported routes cannot trigger a bulk scan", () => {
    for (const url of [
        `${origin}/h`,
        `${origin}/c/${encodeId("101")}`,
        `${origin}/w/${encodeId("101")}/t/all`,
        `${postUrl("202").replace("/details", "/edit")}`,
        `${postUrl("202").replace("/details", "/submissions/by-status/and-sort-name/all/all")}`,
        `https://example.invalid/c/${encodeId("101")}/a/${encodeId("202")}/details`,
    ]) {
        const view = fixture([post("202", [attachment("file")])], url);
        assert.equal(view.scan().scope, "not-post", url);
        assert.deepEqual(view.scan().files, [], url);
    }
});

const detailCard = (id) => new Element("div", { "data-drive-id": id }, [attachment(id)]);
const detail = (children, attrs = {}) => new Element("main", attrs, [new Element("h1"), ...children]);
const announcement = (children, id = "202", attrs = {}) => new Element("div", { class: "EE538", ...attrs }, [
    new Element("div", { "data-stream-item-id": id }, [
        new Element("div", { "data-stream-item-id": id }),
    ]),
    ...children,
]);

test("current-post markers on detail controls do not hide five sibling attachments", () => {
    const links = Array.from({ length: 5 }, (_, index) => attachment(`detail-file-${index}`));
    // Live diagnostic: one DIV main, one h1, five eligible links, and two
    // visible current-post DIV markers containing zero links each.
    const view = fixture([new Element("div", { role: "main" }, [
        new Element("h1"),
        new Element("div", { "data-stream-item-id": "202" }),
        new Element("div", { "data-stream-item-id": "202" }),
        ...links,
    ]), post("201", [attachment("outside-stream-file")])]);
    assert.equal(view.scan().scope, "post");
    assert.deepEqual(view.scan().files.map((file) => file.fileId),
        links.map((_, index) => `detail-file-${index}`));
});

test("a partial keyed container cannot truncate the dedicated detail file list", () => {
    const view = fixture([detail([
        post("202", [attachment("inside-marker")]),
        attachment("sibling-file"), attachment("inside-marker"),
    ]), post("202", [attachment("outside-detail")])]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["inside-marker", "sibling-file"]);
});

test("announcement detail links are not limited to an empty current-post control", () => {
    const view = fixture([detail([
        post("202", []), attachment("announcement-file"),
    ])], postUrl("202", "p"));
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["announcement-file"]);
});

test("headerless announcement details use the verified container around controls and files", () => {
    // Live layout: no main/h1, two nested empty post controls and one file
    // share a DIV.EE538 ancestor with no foreign post markers.
    const view = fixture([
        announcement([attachment("announcement-file")]),
        announcement([attachment("cached-file")], "201", { hidden: "" }),
        attachment("outside-file"),
    ], postUrl("202", "p"));
    assert.equal(view.scan().scope, "post");
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["announcement-file"]);
});

test("material detail shell includes nine sibling files beside empty post controls", () => {
    // User diagnostic: DIV.EE538, one h1, nine visible supported links, and
    // two nested current-post controls which contain no files. No main exists.
    const shell = announcement([
        new Element("h1"),
        ...Array.from({ length: 9 }, (_, index) => attachment(`sample-${index}`)),
    ]);
    const view = fixture([
        shell,
        announcement([attachment("cached")], "201", { hidden: "" }),
        attachment("outside"),
    ], postUrl("202", "m"));
    const result = view.scan();
    assert.equal(result.scope, "post");
    assert.deepEqual(result.files.map((file) => file.fileId),
        Array.from({ length: 9 }, (_, index) => `sample-${index}`));
});

test("material shells require the current post and reject ambiguous or foreign boundaries", () => {
    for (const children of [
        [announcement([new Element("h1"), attachment("wrong")], "201")],
        [announcement([new Element("h1"), attachment("current"), post("203", [attachment("foreign")])])],
        [announcement([new Element("h1"), attachment("course")], "202", { "data-course-id": "999" })],
        [new Element("div", { class: "EE538" }, [new Element("h1"), attachment("unkeyed")])],
        [announcement([new Element("h1"), attachment("one")]), announcement([new Element("h1"), attachment("two")])],
    ]) {
        assert.deepEqual(fixture(children, postUrl("202", "m")).scan().files, []);
    }
    assert.deepEqual(fixture([announcement([new Element("h1"), attachment("stream")])], streamUrl).scan().files, []);
});

test("material shell navigation cannot relabel retained files and replaces them after rendering", () => {
    const shell = announcement([new Element("h1"), attachment("old")]);
    const view = fixture([shell], postUrl("202", "m"));
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["old"]);
    view.navigate(postUrl("203", "m"));
    shell.children[0].attrs["data-stream-item-id"] = "203";
    shell.children[0].children[0].attrs["data-stream-item-id"] = "203";
    shell.children[1].textContent = "Another material";
    assert.equal(view.scan().scope, "unavailable");
    assert.deepEqual(view.scan().files, []);
    const next = attachment("new");
    next.parentElement = shell;
    shell.children[2] = next;
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["new"]);
});

test("announcement boundaries reject feeds, foreign markers, unkeyed shells and ambiguous details", () => {
    assert.equal(fixture([announcement([attachment("stream-file")])],
        `${origin}/c/${encodeId("101")}`).scan().scope, "not-post");
    for (const children of [
        [announcement([attachment("current"), post("203", [attachment("foreign")])])],
        [new Element("div", { class: "EE538" }, [new Element("h1"), attachment("unkeyed")])],
        [announcement([attachment("one")]), announcement([attachment("two")])],
        [announcement([attachment("unknown-shell")], "202", { class: "unknown" })],
    ]) {
        assert.deepEqual(fixture(children, postUrl("202", "p")).scan().files, []);
    }
});

test("empty headerless announcements stay empty without adopting outside files", () => {
    const view = fixture([announcement([]), attachment("outside-file")], postUrl("202", "p"));
    assert.equal(view.scan().scope, "post");
    assert.deepEqual(view.scan().files, []);
});

test("headerless announcement navigation rejects retained files until new files render", () => {
    const shell = announcement([attachment("old-file")]);
    const view = fixture([shell], postUrl("202", "p"));
    view.navigate(postUrl("203", "p"));
    shell.children[0].attrs["data-stream-item-id"] = "203";
    shell.children[0].children[0].attrs["data-stream-item-id"] = "203";
    assert.equal(view.scan().scope, "unavailable");
    assert.deepEqual(view.scan().files, []);
    const next = attachment("new-file");
    next.parentElement = shell;
    shell.children[1] = next;
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["new-file"]);
});

test("stale detail content cannot bypass ownership through a reused keyed container", () => {
    const container = post("202", [attachment("old-file")]);
    const main = detail([container]);
    const view = fixture([main]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["old-file"]);
    view.navigate(postUrl("203"));
    container.attrs["data-stream-item-id"] = "203";
    main.children[0].textContent = "Next assignment";
    assert.equal(view.scan().scope, "unavailable");
    assert.deepEqual(view.scan().files, []);
    const next = attachment("next-file");
    next.parentElement = container;
    container.children = [next];
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["next-file"]);
    view.navigate(`${origin}/u/0/c/${encodeId("101")}`);
    assert.deepEqual(view.scan().files, []);
});

test("dedicated details include supported links only inside the visible post view", () => {
    const view = fixture([
        new Element("div", { hidden: "" }, [post("201", [attachment("stream-file")])]),
        detail([detailCard("old-file")], { hidden: "" }),
        detail([detailCard("current-file"), attachment("instruction-link")]),
    ]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["current-file", "instruction-link"]);
});

test("unkeyed details do not adopt old content on route changes and replace the list after rendering", () => {
    const oldDetail = detail([detailCard("old-file")]);
    const view = fixture([oldDetail]);
    assert.equal(view.scan().files[0].fileId, "old-file");
    view.navigate(postUrl("203", "m"));
    assert.equal(view.scan().scope, "unavailable");
    const nextDetail = detail([detailCard("next-file")]);
    oldDetail.attrs.hidden = "";
    nextDetail.parentElement = view.body;
    view.body.children.push(nextDetail);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["next-file"]);
});

test("ambiguous details, stream-containing main, and links outside a detail root fail closed", () => {
    assert.equal(fixture([detail([detailCard("one")]), detail([detailCard("two")])]).scan().scope, "unavailable");
    assert.equal(fixture([detail([post("201", [attachment("stream-file")]), detailCard("other")])]).scan().scope, "unavailable");
    assert.deepEqual(fixture([detail([]), attachment("outside")]).scan().files, []);
});

test("in-place heading updates allow a new post once its attachment cards render", () => {
    const main = detail([detailCard("old-file")]);
    main.children[0].textContent = "First post";
    const view = fixture([main]);
    view.scan();
    view.navigate(postUrl("203"));
    main.children[0].textContent = "Second post";
    assert.equal(view.scan().scope, "unavailable", "old cards must not follow a changed heading");
    main.children[1] = detailCard("new-file");
    main.children[1].parentElement = main;
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["new-file"]);
});

test("first popup after navigation rejects old details even if previous popup was never opened", () => {
    const view = fixture([detail([detailCard("old-file")])]);
    view.navigate(postUrl("203"));
    assert.equal(view.scan().scope, "unavailable");
    assert.deepEqual(view.scan().files, []);
});

test("seven visible assignment links without optional card metadata are detected", () => {
    // User diagnostic: 7 visible Drive/Docs links, all 7 inside main, 0 matching
    // [data-drive-id] or [data-id][data-item-id]. Use synthetic IDs and names.
    const links = Array.from({ length: 7 }, (_, index) => attachment(`sample-${index}`));
    const view = fixture([
        detail(links),
        detail([attachment("cached-file")], { hidden: "" }),
        post("201", [attachment("stream-file")]),
    ], postUrl("202").replace("/u/0/", "/u/2/"));
    assert.equal(view.scan().scope, "post");
    assert.deepEqual(view.scan().files.map((file) => file.fileId), links.map((_, index) => `sample-${index}`));
});

test("unmarked links from a previous post cannot follow an in-place heading update", () => {
    const main = detail([attachment("previous-file")]);
    main.children[0].textContent = "First assignment";
    const view = fixture([main]);
    assert.equal(view.scan().files.length, 1);
    view.navigate(postUrl("203"));
    main.children[0].textContent = "Next assignment";
    assert.equal(view.scan().scope, "unavailable");
    const next = attachment("next-file");
    next.parentElement = main;
    main.children[1] = next;
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["next-file"]);
});

test("unmarked hidden links and duplicate anchors stay excluded or deduplicated", () => {
    const view = fixture([detail([
        attachment("current-file"), attachment("current-file"),
        new Element("div", { hidden: "" }, [attachment("hidden-file")]),
        attachment("hidden-anchor", { "aria-hidden": "true" }),
    ])]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["current-file"]);
});

test("a reused unmarked anchor is reassigned when its actual href changes", () => {
    const link = attachment("previous-file");
    const main = detail([link]);
    const view = fixture([main]);
    view.navigate(postUrl("203"));
    main.children[0].textContent = "Next assignment";
    link.attrs.href = "https://drive.google.com/file/d/next/view";
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["next"]);
});

const streamUrl = `${origin}/u/0/c/${encodeId("101")}`;
const streamCard = (id, children, attrs = {}) => new Element("div", { class: "n4xnA JUr7jb", ...attrs }, [
    new Element("div", { "data-stream-item-id": id }),
    new Element("div", { "data-stream-item-id": id }),
    ...children,
]);
const selectedRequest = (view) => ({ postId: view.messages.at(-1).postId, selectionToken: view.messages.at(-1).token });

test("Stream buttons download only the clicked card and replace the previous selection", async () => {
    const view = fixture([new Element("main", {}, [
        streamCard("202", [attachment("first"), attachment("first")]),
        streamCard("203", [attachment("second")]),
    ])], streamUrl);
    assert.equal(view.buttons.length, 2);
    assert.equal(view.scan().scope, "not-post", "toolbar scans must not choose a Stream post automatically");
    await view.click(0);
    const first = selectedRequest(view);
    assert.equal(view.messages[0].action, "openPostDownloads");
    assert.deepEqual(view.scan(first).files.map((item) => item.fileId), ["first"]);
    await view.click(1);
    assert.deepEqual(view.scan(selectedRequest(view)).files.map((item) => item.fileId), ["second"]);
    assert.deepEqual(view.scan(first).files, [], "an older launch cannot acquire the newly selected card");
});

test("Stream selection requires a trusted button click and the private selection token", async () => {
    const view = fixture([streamCard("202", [attachment("first")])], streamUrl);
    assert.deepEqual(view.scan({ postId: "202", selectionToken: "made-up" }).files, []);
    await view.click(0, false);
    assert.equal(view.messages.length, 0);
    await view.click();
    const request = selectedRequest(view);
    assert.equal(view.scan(request).files.length, 1);
    assert.deepEqual(view.scan({ ...request, postId: "203" }).files, []);
    view.advance(5 * 60 * 1000 + 1);
    assert.deepEqual(view.scan(request).files, []);
});

test("Stream buttons exclude hidden, foreign, ambiguous and unsupported cards", () => {
    const view = fixture([
        streamCard("202", [attachment("valid")]),
        streamCard("203", [attachment("hidden")], { hidden: "" }),
        streamCard("204", [attachment("wrong-course")], { "data-course-id": "999" }),
        streamCard("205", [attachment("mixed"), post("206", [])]),
        streamCard("207", [attachment("duplicate-one")]),
        streamCard("207", [attachment("duplicate-two")]),
        streamCard("208", [new Element("a", { href: "https://example.invalid/" })]),
        new Element("div", {}, [post("209", []), attachment("unscoped")]),
    ], streamUrl);
    assert.equal(view.buttons.length, 1);
});

test("a selected Stream card cannot be replaced, relabeled or used after leaving the Stream", async () => {
    for (const change of ["replace", "relabel", "navigate"]) {
        const card = streamCard("202", [attachment("selected")]);
        const view = fixture([card], streamUrl);
        await view.click();
        const request = selectedRequest(view);
        if (change === "replace") {
            card.remove();
            view.body.appendChild(streamCard("202", [attachment("replacement")]));
        } else if (change === "relabel") {
            card.children[0].attrs["data-stream-item-id"] = "203";
            card.children[1].attrs["data-stream-item-id"] = "203";
        } else {
            view.navigate(postUrl("202"));
        }
        assert.deepEqual(view.scan(request).files, [], change);
    }
});

test("Stream button rendering is idempotent and cleans up after navigation", () => {
    const view = fixture([streamCard("202", [attachment("file")])], streamUrl);
    view.refresh();
    view.refresh();
    assert.equal(view.buttons.length, 1);
    view.navigate(postUrl("202"));
    view.refresh();
    assert.equal(view.buttons.length, 0);
});

test("a failed popup launch revokes the Stream selection", async () => {
    const view = fixture([streamCard("202", [attachment("file")])], streamUrl);
    view.failLaunch();
    await view.click();
    assert.deepEqual(view.scan(selectedRequest(view)).files, []);
    assert.equal(view.buttons[0].disabled, false);
    assert.ok(view.body.querySelectorAll(".classgrab-stream-status")[0].textContent);
});
