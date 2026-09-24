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
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }

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
    const document = { body, querySelectorAll: (selector) => body.querySelectorAll(selector) };
    let listener;
    const sandbox = {
        URL,
        document,
        location: { href: url },
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        getComputedStyle: (element) => ({ display: "block", visibility: "visible", ...element.style }),
        chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return {
        body,
        navigate(nextUrl) { sandbox.location.href = nextUrl; },
        scan() {
            let response;
            listener({ action: "getDriveLinks" }, {}, (value) => { response = value; });
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

test("dedicated details without a stream marker include only visible attachment cards", () => {
    const view = fixture([
        new Element("div", { hidden: "" }, [post("201", [attachment("stream-file")])]),
        detail([detailCard("old-file")], { hidden: "" }),
        detail([detailCard("current-file"), attachment("instruction-link")]),
    ]);
    assert.deepEqual(view.scan().files.map((file) => file.fileId), ["current-file"]);
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

test("ambiguous details, stream-containing main, and unscoped links fail closed", () => {
    assert.equal(fixture([detail([detailCard("one")]), detail([detailCard("two")])]).scan().scope, "unavailable");
    assert.equal(fixture([detail([post("201", [attachment("stream-file")]), detailCard("other")])]).scan().scope, "unavailable");
    assert.deepEqual(fixture([detail([attachment("unscoped")])]).scan().files, []);
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
