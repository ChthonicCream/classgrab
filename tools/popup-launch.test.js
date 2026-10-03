const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scripts/background.js"), "utf8");
const streamUrl = "https://classroom.google.com/u/0/c/mock";
const token = "synthetic-launch-token-000000000001";
const extensionBase = "chrome-extension://synthetic-extension/";

function setup() {
    let listener;
    let now = 1000;
    const state = { opens: [], popups: [], active: { id: 11, windowId: 7, active: true }, focused: true };
    const chrome = {
        runtime: { id: "synthetic-extension", getURL: (value) => extensionBase + value,
            onMessage: { addListener: (value) => { listener = value; } } },
        downloads: { onChanged: { addListener() {} } },
        tabs: {
            query: async () => [state.active],
            get: async () => state.active,
        },
        windows: { get: async (id) => ({ id, focused: state.focused }) },
        action: {
            setPopup: async (options) => { state.popups.push(options); },
            openPopup: async (options) => { state.opens.push(options); },
        },
    };
    const sandbox = { chrome, URL, console, Date: { now: () => now } };
    vm.runInNewContext(source, sandbox);
    const sender = {
        id: chrome.runtime.id, frameId: 0, documentId: "synthetic-document",
        url: streamUrl, tab: { id: 11, windowId: 7, active: true },
    };
    const popup = (launchToken = token) => ({
        id: chrome.runtime.id,
        url: extensionBase + "views/popup.html?launch=" + encodeURIComponent(launchToken),
    });
    const send = (request, from = sender) => new Promise((resolve) => {
        let responded = false;
        const asynchronous = listener(request, from, (result) => { responded = true; resolve(result); });
        if (!asynchronous && !responded) resolve(undefined);
    });
    return { state, chrome, sender, popup, send, advance: (milliseconds) => { now += milliseconds; } };
}

const open = (launchToken = token) => ({ action: "openPostDownloads", token: launchToken, postId: "synthetic-post", pageUrl: streamUrl });
const consume = (launchToken = token) => ({ action: "consumePostLaunch", token: launchToken });

test("button launch binds source identity, opens its window and resets the toolbar popup", async () => {
    const harness = setup();
    assert.equal((await harness.send(open())).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.state.opens)), [{ windowId: 7 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.state.popups)), [
        { tabId: 11, popup: "views/popup.html?launch=" + token },
        { tabId: 11, popup: "views/popup.html" },
    ]);
    const result = await harness.send(consume(), harness.popup());
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.launch)), {
        token, postId: "synthetic-post", pageUrl: streamUrl, tabId: 11, windowId: 7,
        documentId: "synthetic-document",
    });
    assert.equal((await harness.send(consume(), harness.popup())).ok, false);
    assert.equal((await harness.send(open())).ok, false, "a consumed token cannot launch a second batch");
});

test("only the exact own popup URL may consume, with no default-toolbar replay", async () => {
    const harness = setup();
    await harness.send(open());
    for (const sender of [
        harness.sender,
        { ...harness.popup(), id: "other-extension" },
        { ...harness.popup(), url: extensionBase + "views/popup.html" },
        { ...harness.popup(), url: harness.popup().url + "&extra=1" },
        { ...harness.popup(), tab: { id: 99 } },
    ]) {
        assert.equal((await harness.send(consume(), sender)).ok, false);
    }
    assert.equal((await harness.send(consume(), harness.popup())).ok, true,
        "invalid callers must not consume the valid popup's launch");
});

test("launch requires a top-frame own content script on the focused current Stream", async () => {
    for (const changes of [
        { id: "other-extension" }, { frameId: 1 },
        { documentId: "" }, { documentId: "x".repeat(201) }, { documentId: 1 },
        { url: "https://example.com/c/synthetic-course" },
        { url: streamUrl + "/a/synthetic-post/details" },
        { tab: { id: 11, windowId: 7, active: false } },
        { tab: { id: 11, windowId: 8, active: true } },
        { tab: { id: -1, windowId: 7, active: true } },
        { tab: { id: 11, windowId: -1, active: true } },
    ]) {
        const harness = setup();
        assert.equal((await harness.send(open(), { ...harness.sender, ...changes })).ok, false);
        assert.equal(harness.state.opens.length, 0);
    }
    for (const mutate of [
        (h) => { h.state.active = { id: 12, windowId: 7, active: true }; },
        (h) => { h.state.active = { id: 11, windowId: 8, active: true }; },
        (h) => { h.state.active.url = streamUrl + "/a/other/details"; },
        (h) => { h.state.focused = false; },
    ]) {
        const harness = setup();
        mutate(harness);
        assert.equal((await harness.send(open())).ok, false);
        assert.equal(harness.state.opens.length, 0);
    }
});

test("launch rejects malformed tokens, post IDs and mismatched source URLs", async () => {
    for (const changes of [
        { token: "" }, { token: "x".repeat(201) }, { token: "bad/token" },
        { postId: "" }, { postId: "bad/post" }, { postId: "x".repeat(201) },
        { pageUrl: streamUrl + "/other" },
    ]) {
        const harness = setup();
        assert.equal((await harness.send({ ...open(), ...changes })).ok, false);
        assert.equal(harness.state.opens.length, 0);
    }
});

test("expired and navigated launches cannot be consumed", async () => {
    for (const mutate of [
        (h) => h.advance(30001),
        (h) => { h.state.active.url = streamUrl + "/a/new/details"; },
        (h) => { h.state.active = { id: 12, windowId: 7, active: true }; },
        (h) => { h.state.active = { id: 11, windowId: 8, active: true }; },
        (h) => { h.state.focused = false; },
    ]) {
        const harness = setup();
        await harness.send(open());
        mutate(harness);
        assert.equal((await harness.send(consume(), harness.popup())).ok, false);
    }
});

test("failed open cleans selection and popup; two clicks cannot overlap in one window", async () => {
    const failed = setup();
    failed.chrome.action.openPopup = async () => { throw new Error("Synthetic open failure"); };
    assert.equal((await failed.send(open())).ok, false);
    assert.equal(failed.state.popups.at(-1).popup, "views/popup.html");
    assert.equal((await failed.send(consume(), failed.popup())).ok, false);

    const harness = setup();
    let finish;
    harness.chrome.action.openPopup = async (options) => {
        harness.state.opens.push(options);
        await new Promise((resolve) => { finish = resolve; });
    };
    const first = harness.send(open());
    await new Promise(setImmediate);
    assert.equal((await harness.send(open("synthetic-launch-token-000000000002"))).ok, false);
    finish();
    assert.equal((await first).ok, true);
    assert.equal(harness.state.opens.length, 1);
});

test("consumption is atomic even when two matching popups race", async () => {
    const harness = setup();
    await harness.send(open());
    const results = await Promise.all([
        harness.send(consume(), harness.popup()), harness.send(consume(), harness.popup()),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
});

test("a consumed or expired token stays blocked for the selection lifetime", async () => {
    for (const consumed of [false, true]) {
        const harness = setup();
        await harness.send(open());
        if (consumed) assert.equal((await harness.send(consume(), harness.popup())).ok, true);
        harness.advance(30001);
        assert.equal((await harness.send(open())).ok, false, "launch expiry cannot remove replay protection");
        assert.equal((await harness.send(open("synthetic-launch-token-000000000002"))).ok, true,
            "a fresh selection may replace the expired pending launch");
    }
});

test("launch replay records are bounded and expire without retaining post history", async () => {
    const harness = setup();
    for (let index = 0; index < 128; index++) {
        const launchToken = `synthetic-launch-token-${String(index).padStart(12, "0")}`;
        assert.equal((await harness.send(open(launchToken))).ok, true);
        assert.equal((await harness.send(consume(launchToken), harness.popup(launchToken))).ok, true);
    }
    const nextToken = "synthetic-launch-token-000000000128";
    assert.equal((await harness.send(open(nextToken))).ok, false, "records must stay bounded");
    harness.advance(5 * 60 * 1000 + 1);
    assert.equal((await harness.send(open(nextToken))).ok, true, "expired replay records must be pruned");
});

test("missing browser popup support reports failure and restores the toolbar popup", async () => {
    const harness = setup();
    delete harness.chrome.action.openPopup;
    assert.equal((await harness.send(open())).ok, false);
    assert.equal(harness.state.popups.at(-1).popup, "views/popup.html");
    assert.equal((await harness.send(consume(), harness.popup())).ok, false);
});
