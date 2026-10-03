const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scripts/popup.js"), "utf8");
const flow = source.slice(source.indexOf("async function readCurrentPost()"), source.indexOf('selectAll.addEventListener("change"'));
const file = (id) => ({ id, name: `${id}.pdf` });
const postUrl = "https://classroom.google.com/c/mock/a/mock-post/details";

function setup(overrides = {}) {
    const state = { batches: [], controls: [], messages: [], closes: 0, empty: [], rendered: [] };
    const sandbox = {
        Set, Promise, console, URLSearchParams,
        files: [file("new"), file("old")],
        loadedPageUrl: postUrl,
        loadedPostId: "mock-post",
        postLaunch: null,
        launchConsumptionStarted: false,
        downloadRequestActive: false,
        authuser: null,
        window: { close: () => state.closes++, location: { search: "" } },
        t: (key, count) => `${key}${count === undefined ? "" : `:${count}`}`,
        setControlsDisabled: (value) => state.controls.push(value),
        setStatus: (message) => state.messages.push(message),
        renderEmptyState: (message) => { state.empty.push(message); sandbox.files = []; },
        renderFiles: (files) => { state.rendered.push(files); sandbox.files = files; },
        renderUnsupportedPage() {},
        extractAuthUser: () => "0",
        chrome: { tabs: {
            query: async () => [{ id: 1, windowId: 7, active: true, url: postUrl }],
            get: async () => ({ id: 1, windowId: 7, active: true, url: postUrl }),
            sendMessage: async () => ({ scope: "post", pageUrl: postUrl, postId: "mock-post", files: [file("new"), file("old")] }),
        }, windows: { get: async (id) => ({ id, focused: true }) } },
        sendRuntimeMessage: async () => ({ statuses: {} }),
        downloadBatch: async (files, allowDuplicate) => {
            state.batches.push({ ids: files.map((item) => item.id), allowDuplicate });
            return { started: files.length, failed: 0, manual: 0, skipped: 0, trackingWarnings: 0 };
        },
        ...overrides,
    };
    vm.createContext(sandbox);
    vm.runInContext(flow, sandbox);
    sandbox.chooseDuplicateAction = async () => "skip";
    return { sandbox, state };
}

test("fresh batch closes popup only after all download starts have been acknowledged", async () => {
    let finish;
    const { sandbox, state } = setup({ downloadBatch: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = sandbox.requestDownload([file("new")]);
    await new Promise(setImmediate);
    assert.equal(state.closes, 0);
    finish({ started: 1 });
    await pending;
    assert.equal(state.closes, 1);
    assert.equal(sandbox.downloadRequestActive, false);
});

test("default skip downloads only fresh IDs and does not authorize duplicates", async () => {
    const { sandbox, state } = setup({ sendRuntimeMessage: async () => ({ statuses: { old: { label: "complete" } } }) });
    await sandbox.requestDownload([file("new"), file("old")]);
    assert.deepEqual(JSON.parse(JSON.stringify(state.batches)), [{ ids: ["new"], allowDuplicate: false }]);
});

test("explicit download again passes authorization, cancellation starts nothing", async () => {
    const { sandbox, state } = setup({ sendRuntimeMessage: async () => ({ statuses: { old: { label: "complete" } } }) });
    sandbox.chooseDuplicateAction = async () => "cancel";
    await sandbox.requestDownload([file("old")]);
    assert.equal(state.batches.length, 0);
    sandbox.chooseDuplicateAction = async () => "again";
    await sandbox.requestDownload([file("old")]);
    assert.equal(state.batches[0].allowDuplicate, true);
});

test("download again skips active duplicates before preparation or manual confirmation", async () => {
    const { sandbox, state } = setup({
        sendRuntimeMessage: async () => ({ statuses: {
            old: { label: "started" }, done: { label: "complete" },
        } }),
    });
    sandbox.chooseDuplicateAction = async () => "again";
    sandbox.chrome.tabs.sendMessage = async () => ({
        scope: "post", pageUrl: postUrl, postId: "mock-post", files: [file("old"), file("done"), file("new")],
    });
    let preparedIds;
    let skippedCount;
    sandbox.downloadBatch = async (files, allowDuplicate, skipped) => {
        preparedIds = files.map((item) => item.id);
        skippedCount = skipped;
        assert.equal(allowDuplicate, true);
        return { started: files.length, skipped };
    };
    await sandbox.requestDownload([file("old"), file("done"), file("new")]);
    assert.deepEqual(Array.from(preparedIds), ["done", "new"]);
    assert.equal(skippedCount, 1);
    assert.equal(state.closes, 0, "skipped active files must leave their result visible");

    preparedIds = null;
    await sandbox.requestDownload([file("old")]);
    assert.equal(preparedIds, null, "an active-only batch must never enter preparation");
});

test("double clicks while waiting on duplicate choice cannot submit another batch", async () => {
    let choose;
    const { sandbox, state } = setup({ sendRuntimeMessage: async () => ({ statuses: { old: { label: "started" } } }) });
    sandbox.chooseDuplicateAction = () => new Promise((resolve) => { choose = resolve; });
    const first = sandbox.requestDownload([file("old")]);
    await new Promise(setImmediate);
    await sandbox.requestDownload([file("new")]);
    assert.equal(state.batches.length, 0);
    choose("cancel");
    await first;
});

test("navigation during duplicate confirmation replaces list and blocks stale download", async () => {
    const { sandbox, state } = setup({ sendRuntimeMessage: async () => ({ statuses: { old: { label: "complete" } } }) });
    sandbox.chooseDuplicateAction = async () => {
        const nextUrl = postUrl.replace("mock-post", "mock-next");
        sandbox.chrome.tabs.query = async () => [{ id: 1, url: nextUrl }];
        sandbox.chrome.tabs.get = async () => ({ url: nextUrl });
        sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: nextUrl, postId: "mock-next", files: [file("other")] });
        return "again";
    };
    await sandbox.requestDownload([file("old")]);
    assert.equal(state.batches.length, 0);
    assert.equal(sandbox.files[0].id, "other");
    assert.equal(state.messages.at(-1), "postChanged");
});

test("feed and empty scans clear old files; unavailable history blocks downloads", async () => {
    const { sandbox, state } = setup();
    sandbox.chrome.tabs.sendMessage = async () => ({ scope: "not-post", pageUrl: postUrl, files: [] });
    await sandbox.loadFilesFromActiveTab();
    assert.equal(sandbox.files.length, 0);
    sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: postUrl, postId: "mock-post", files: [file("new")] });
    sandbox.loadedPageUrl = postUrl;
    sandbox.loadedPostId = "mock-post";
    sandbox.sendRuntimeMessage = async () => ({ statuses: {}, error: "storage failure" });
    await sandbox.requestDownload([file("new")]);
    assert.equal(state.batches.length, 0);
    assert.equal(state.messages.at(-1), "historyUnavailable");
});

test("late response from prior route and attachment removed from same post cannot download", async () => {
    const { sandbox, state } = setup();
    sandbox.chrome.tabs.get = async () => ({ url: postUrl + "?changed" });
    await sandbox.requestDownload([file("new")]);
    assert.equal(state.batches.length, 0);
    sandbox.chrome.tabs.get = async () => ({ url: postUrl });
    sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: postUrl, postId: "mock-post", files: [] });
    await sandbox.requestDownload([file("new")]);
    assert.equal(sandbox.files.length, 0);
    assert.equal(state.batches.length, 0);
});

test("failed, manual, skipped and untracked batches keep the popup visible", async () => {
    for (const warning of ["failed", "manual", "skipped", "trackingWarnings"]) {
        const { sandbox, state } = setup({ downloadBatch: async () => ({ started: 1, [warning]: 1 }) });
        await sandbox.requestDownload([file("new")]);
        assert.equal(state.closes, 0, warning);
    }
});

test("empty selection does not prepare any files", async () => {
    const { sandbox, state } = setup();
    await sandbox.requestDownload([]);
    assert.equal(state.batches.length, 0);
    assert.equal(state.messages.at(-1), "selectAtLeastOneFile");
});

function launchedSetup() {
    const launch = {
        token: "synthetic-popup-launch-token-000001", postId: "stream-post",
        pageUrl: "https://classroom.google.com/u/0/c/mock",
        tabId: 1, windowId: 7, documentId: "synthetic-document",
    };
    const harness = setup();
    const { sandbox, state } = harness;
    state.scans = [];
    state.consumes = 0;
    sandbox.window.location.search = "?launch=" + launch.token;
    sandbox.chrome.tabs.query = async () => [{ id: 1, windowId: 7, active: true }];
    sandbox.chrome.tabs.get = async () => ({ id: 1, windowId: 7, active: true });
    sandbox.chrome.tabs.sendMessage = async (id, message, options) => {
        state.scans.push({ id, message, options });
        return { scope: "post", pageUrl: launch.pageUrl, postId: launch.postId, files: [file("new")] };
    };
    sandbox.sendRuntimeMessage = async (request) => {
        if (request.action === "consumePostLaunch") {
            state.consumes++;
            return { ok: true, launch };
        }
        return { statuses: {} };
    };
    return { ...harness, launch };
}

test("Stream launch scans its pinned document and auto-starts once without activeTab URL access", async () => {
    const { sandbox, state, launch } = launchedSetup();
    await Promise.all([sandbox.loadFilesFromActiveTab(), sandbox.loadFilesFromActiveTab()]);
    assert.equal(state.consumes, 1);
    assert.equal(state.batches.length, 1);
    assert.deepEqual(state.batches[0].ids, ["new"]);
    assert.equal(state.closes, 1);
    assert.equal(sandbox.loadedPostId, launch.postId);
    assert.ok(state.scans.length >= 3, "initial, pre-history and pre-download scans all run");
    for (const scan of state.scans) {
        assert.deepEqual(JSON.parse(JSON.stringify(scan)), {
            id: 1, message: { action: "getDriveLinks", postId: launch.postId, selectionToken: launch.token },
            options: { documentId: launch.documentId },
        });
    }
});

test("normal toolbar initialization shows files without consuming a launch or auto-downloading", async () => {
    const { sandbox, state } = setup();
    sandbox.sendRuntimeMessage = async () => { throw new Error("must not consume"); };
    await sandbox.loadFilesFromActiveTab();
    assert.equal(state.batches.length, 0);
    assert.equal(sandbox.files.length, 2);
});

test("invalid, expired or replayed launch never falls back to the active page", async () => {
    const { sandbox, state } = launchedSetup();
    sandbox.sendRuntimeMessage = async () => ({ ok: false });
    await sandbox.loadFilesFromActiveTab();
    assert.equal(state.scans.length, 0);
    assert.equal(state.batches.length, 0);
    assert.equal(sandbox.files.length, 0);
});

test("same Stream URL and shared attachment ID cannot substitute a different post", async () => {
    const { sandbox, state, launch } = launchedSetup();
    sandbox.sendRuntimeMessage = async (request) => request.action === "consumePostLaunch"
        ? { ok: true, launch } : { statuses: { new: { label: "complete" } } };
    sandbox.chooseDuplicateAction = async () => {
        sandbox.chrome.tabs.sendMessage = async () => ({
            scope: "post", pageUrl: launch.pageUrl, postId: "different-post", files: [file("new")],
        });
        return "again";
    };
    await sandbox.loadFilesFromActiveTab();
    assert.equal(state.batches.length, 0);
    assert.equal(sandbox.files.length, 0);
    assert.equal(state.messages.at(-1), "postChanged");
});

test("Stream selection removal, tab/window changes and document replacement stop pending downloads", async () => {
    const mutations = [
        (s, l) => { s.chrome.tabs.sendMessage = async () => ({ scope: "unavailable", pageUrl: l.pageUrl, postId: l.postId, files: [] }); },
        (s) => { s.chrome.tabs.get = async () => ({ id: 1, windowId: 8, active: true }); },
        (s) => { s.chrome.tabs.query = async () => [{ id: 2, windowId: 7, active: true }]; },
        (s) => { s.chrome.tabs.get = async () => ({ id: 1, windowId: 7, active: false }); },
        (s) => { s.chrome.tabs.get = async () => ({ id: 1, windowId: 7, active: true, url: postUrl }); },
        (s) => { s.chrome.tabs.get = async () => { throw new Error("Source tab closed"); }; },
        (s) => { s.chrome.tabs.sendMessage = async () => { throw new Error("No matching document"); }; },
        (s) => { s.chrome.windows.get = async (id) => ({ id, focused: false }); },
    ];
    for (const mutate of mutations) {
        const { sandbox, state, launch } = launchedSetup();
        sandbox.sendRuntimeMessage = async (request) => request.action === "consumePostLaunch"
            ? { ok: true, launch } : { statuses: { new: { label: "complete" } } };
        sandbox.chooseDuplicateAction = async () => { mutate(sandbox, launch); return "again"; };
        await sandbox.loadFilesFromActiveTab();
        assert.equal(state.batches.length, 0);
        assert.equal(sandbox.files.length, 0);
    }
});

test("Stream auto-download still requires duplicate confirmation and cancellation starts nothing", async () => {
    const { sandbox, state, launch } = launchedSetup();
    sandbox.sendRuntimeMessage = async (request) => request.action === "consumePostLaunch"
        ? { ok: true, launch } : { statuses: { new: { label: "complete" } } };
    let warned = 0;
    sandbox.chooseDuplicateAction = async () => { warned++; return "cancel"; };
    await sandbox.loadFilesFromActiveTab();
    assert.equal(warned, 1);
    assert.equal(state.batches.length, 0);
    assert.equal(state.closes, 0);
});

test("a launch without document IDs still restricts scanning to the top frame", async () => {
    const { sandbox, state, launch } = launchedSetup();
    delete launch.documentId;
    await sandbox.loadFilesFromActiveTab();
    assert.equal(state.batches.length, 1);
    assert.ok(state.scans.every((scan) => scan.options.frameId === 0));
});

test("empty or malformed launch records never scan or auto-start", async () => {
    for (const mutate of [
        (s) => { s.window.location.search = "?launch="; },
        (s, l) => { l.token = "wrong-token"; },
        (s, l) => { l.tabId = -1; },
        (s, l) => { l.windowId = -1; },
        (s, l) => { l.postId = "bad/post"; },
        (s, l) => { l.documentId = ""; },
        (s, l) => { l.pageUrl = postUrl; },
    ]) {
        const { sandbox, state, launch } = launchedSetup();
        mutate(sandbox, launch);
        await sandbox.loadFilesFromActiveTab();
        assert.equal(state.scans.length, 0);
        assert.equal(state.batches.length, 0);
        assert.equal(sandbox.files.length, 0);
    }
});

test("rejected launch messages show the localized post-changed recovery hint", async () => {
    const { sandbox, state } = launchedSetup();
    sandbox.sendRuntimeMessage = async () => { throw new Error("Internal launch failure"); };
    await sandbox.loadFilesFromActiveTab();
    assert.equal(state.scans.length, 0);
    assert.equal(state.batches.length, 0);
    assert.equal(state.empty.at(-1), "postChanged");
});
