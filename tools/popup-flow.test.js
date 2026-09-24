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
        Set, Promise, console,
        files: [file("new"), file("old")],
        loadedPageUrl: postUrl,
        downloadRequestActive: false,
        authuser: null,
        window: { close: () => state.closes++ },
        t: (key, count) => `${key}${count === undefined ? "" : `:${count}`}`,
        setControlsDisabled: (value) => state.controls.push(value),
        setStatus: (message) => state.messages.push(message),
        renderEmptyState: (message) => { state.empty.push(message); sandbox.files = []; },
        renderFiles: (files) => { state.rendered.push(files); sandbox.files = files; },
        renderUnsupportedPage() {},
        extractAuthUser: () => "0",
        chrome: { tabs: {
            query: async () => [{ id: 1, url: postUrl }],
            get: async () => ({ id: 1, url: postUrl }),
            sendMessage: async () => ({ scope: "post", pageUrl: postUrl, files: [file("new"), file("old")] }),
        } },
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
        sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: nextUrl, files: [file("other")] });
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
    sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: postUrl, files: [file("new")] });
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
    sandbox.chrome.tabs.sendMessage = async () => ({ scope: "post", pageUrl: postUrl, files: [] });
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
