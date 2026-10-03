const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const popupSource = fs.readFileSync(path.join(repoRoot, "scripts", "popup.js"), "utf8");
const batchStart = popupSource.indexOf("async function downloadBatch");
const batchEnd = popupSource.indexOf("function renderUnsupportedPage", batchStart);
const concurrencyMatch = popupSource.match(/const MAX_BATCH_WORKERS = (\d+);/);

assert.notEqual(batchStart, -1, "downloadBatch must exist in scripts/popup.js");
assert.notEqual(batchEnd, -1, "downloadBatch must end before renderUnsupportedPage");
assert.ok(concurrencyMatch, "MAX_BATCH_WORKERS must be declared in scripts/popup.js");
const maxBatchWorkers = Number(concurrencyMatch[1]);

function loadDownloadBatch(overrides = {}) {
    const sandbox = {
        MAX_BATCH_WORKERS: maxBatchWorkers,
        console,
        setStatus() {},
        t(name, value) {
            return `${name}:${value || ""}`;
        },
        setControlsDisabled() {},
        updateFileStatus() {},
        prepareDownloadUrl: async (file) => ({ url: file.link, note: null }),
        ensureCurrentFiles: async () => true,
        loadedPageUrl: "https://classroom.google.com/c/mock/a/mock-post/details",
        loadedPostId: "mock-post",
        startDownload: async () => {},
        openManualDownload() {},
        sendRuntimeMessage: async () => ({ statuses: {} }),
        restoreStoredStatuses() { return {}; },
        ...overrides,
    };

    vm.createContext(sandbox);
    vm.runInContext(
        `${popupSource.slice(batchStart, batchEnd)}\nthis.downloadBatch = downloadBatch;`,
        sandbox,
    );
    return sandbox;
}

function makeFiles(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: String(index),
        name: `file-${index}.pdf`,
        link: `https://example.invalid/${index}`,
    }));
}

async function testBulkPreparationUsesBoundedConcurrency() {
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const controls = [];
    let restored = 0;
    const sandbox = loadDownloadBatch({
        setControlsDisabled(disabled) {
            controls.push(disabled);
        },
        prepareDownloadUrl: async (file) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            active -= 1;
            return { url: file.link, note: null };
        },
        startDownload: async () => {
            started += 1;
        },
        restoreStoredStatuses() {
            restored += 1;
            return {};
        },
    });

    await sandbox.downloadBatch(makeFiles(10));

    assert.equal(maxBatchWorkers, 4, "the reviewed worker limit should remain four");
    assert.equal(maxActive, maxBatchWorkers, "bulk preparation should use the reviewed worker limit");
    assert.equal(started, 10, "every prepared file should start downloading");
    assert.deepEqual(controls, [true, false], "controls should be restored after the batch");
    assert.equal(restored, 1, "stored statuses should be restored once per batch");
}

async function testOneFailureDoesNotStopTheBatch() {
    const started = [];
    const statuses = [];
    const summaries = [];
    const sandbox = loadDownloadBatch({
        console: {
            error() {},
        },
        setStatus(message, type) {
            summaries.push({ message, type });
        },
        updateFileStatus(fileId, label, type) {
            statuses.push({ fileId, label, type });
        },
        prepareDownloadUrl: async (file) => {
            if (file.id === "1") {
                throw new Error("mock Drive failure");
            }
            return { url: file.link, note: null };
        },
        startDownload: async (file) => {
            started.push(file.id);
        },
    });

    await sandbox.downloadBatch(makeFiles(3));

    assert.deepEqual(started.sort(), ["0", "2"], "other files should continue after one failure");
    assert.ok(
        statuses.some((status) => status.fileId === "1" && status.label === "failed"),
        "the failed file should receive an error status",
    );
    assert.equal(summaries.at(-1).type, "error", "the final batch summary should report the failure");
}

async function testManualFallbackFinishesBeforeTheBatch() {
    let manualOpenFinished = false;
    const sandbox = loadDownloadBatch({
        prepareDownloadUrl: async () => ({
            manualUrl: "https://drive.google.com/file/d/mock/view",
            note: "manual confirmation required",
        }),
        openManualDownload: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            manualOpenFinished = true;
        },
    });

    await sandbox.downloadBatch(makeFiles(1));

    assert.equal(manualOpenFinished, true, "manual fallback tabs must finish opening before the batch completes");
}

async function testManualFallbackFailureIsReported() {
    const statuses = [];
    const summaries = [];
    const sandbox = loadDownloadBatch({
        console: {
            error() {},
        },
        setStatus(message, type) {
            summaries.push({ message, type });
        },
        updateFileStatus(fileId, label, type) {
            statuses.push({ fileId, label, type });
        },
        prepareDownloadUrl: async () => ({
            manualUrl: "https://drive.google.com/file/d/mock/view",
            note: "manual confirmation required",
        }),
        openManualDownload: async () => {
            throw new Error("mock tab failure");
        },
    });

    await sandbox.downloadBatch(makeFiles(1));

    assert.ok(
        statuses.some((status) => status.fileId === "0" && status.label === "failed"),
        "a manual fallback tab failure should mark the file as failed",
    );
    assert.equal(summaries.at(-1).type, "error", "a manual fallback tab failure should fail the batch summary");
    assert.match(
        summaries.at(-1).message,
        /mock tab failure/,
        "a manual fallback tab failure should remain visible in the final summary",
    );
}

async function testFailureDuringPreparationIsPreserved() {
    let firstStarted = false;
    const summaries = [];
    const sandbox = loadDownloadBatch({
        setStatus(message, type) { summaries.push({ message, type }); },
        prepareDownloadUrl: async (file) => {
            if (file.id === "1") await new Promise((resolve) => setTimeout(resolve, 20));
            return { url: file.link };
        },
        startDownload: async (file) => {
            if (file.id === "0") firstStarted = true;
            return { status: { label: "started", type: "success" } };
        },
        restoreStoredStatuses: async () => {
            assert.ok(firstStarted);
            return { "0": { label: "failed", type: "error", message: "NETWORK_FAILED" } };
        },
    });
    const result = await sandbox.downloadBatch(makeFiles(2));
    assert.equal(result.failed, 1, "a failure during preparation must prevent automatic close");
    assert.equal(summaries.at(-1).type, "error", "the final summary must preserve the failure");
}

async function testManualFallbackRechecksDuplicateHistory() {
    for (const scenario of [
        { label: "started", allowDuplicate: false, skipped: 1 },
        { label: "started", allowDuplicate: true, skipped: 1 },
        { label: "complete", allowDuplicate: false, skipped: 1 },
        { label: "complete", allowDuplicate: true, manual: 1 },
        { error: "Synthetic storage failure", failed: 1 },
    ]) {
        let prepared = false;
        let historyChecks = 0;
        let manualOpens = 0;
        const sandbox = loadDownloadBatch({
            console: { error() {} },
            prepareDownloadUrl: async () => {
                prepared = true;
                return { manualUrl: "https://drive.google.com/file/d/mock/view" };
            },
            sendRuntimeMessage: async () => {
                assert.equal(prepared, true, "history must be refreshed after Drive preparation");
                historyChecks++;
                return { statuses: { "0": { label: scenario.label, type: "success" } }, error: scenario.error };
            },
            openManualDownload: async () => { manualOpens++; },
        });
        const result = await sandbox.downloadBatch(makeFiles(1), scenario.allowDuplicate);
        assert.equal(historyChecks, 1);
        assert.equal(manualOpens, scenario.manual || 0);
        assert.equal(result.skipped, scenario.skipped || 0);
        assert.equal(result.failed, scenario.failed || 0);
    }
}

async function testNavigationDuringManualHistoryBlocksTheTab() {
    let current = true;
    let manualOpens = 0;
    const sandbox = loadDownloadBatch({
        console: { error() {} },
        prepareDownloadUrl: async () => ({ manualUrl: "https://drive.google.com/file/d/mock/view" }),
        ensureCurrentFiles: async () => current,
        sendRuntimeMessage: async () => {
            // The post was valid after preparation, but changes while the
            // duplicate-history response is pending.
            await new Promise((resolve) => setTimeout(resolve, 10));
            current = false;
            return { statuses: {} };
        },
        openManualDownload: async () => { manualOpens++; },
    });
    const result = await sandbox.downloadBatch(makeFiles(1));
    assert.equal(manualOpens, 0, "navigation during history lookup must block the manual tab");
    assert.equal(result.failed, 1);
}

async function testNavigationDuringPreparationBlocksBothStartPaths() {
    for (const launched of [false, true]) {
        for (const manual of [false, true]) {
            const originalUrl = launched
                ? "https://classroom.google.com/c/mock"
                : "https://classroom.google.com/c/mock/a/mock-post/details";
            const nextUrl = launched ? originalUrl : originalUrl.replace("mock-post", "mock-next");
            let currentUrl = originalUrl;
            let currentPost = "mock-post";
            let starts = 0;
            let manualOpens = 0;
            const targetFiles = makeFiles(2);
            const sandbox = loadDownloadBatch({
                console: { error() {} },
                Set, Promise,
                loadedPageUrl: originalUrl,
                loadedPostId: "mock-post",
                postLaunch: launched ? {
                    token: "synthetic-batch-launch-token-000001", postId: "mock-post",
                    pageUrl: originalUrl, tabId: 1, windowId: 7, documentId: "synthetic-document",
                } : null,
                files: targetFiles,
                t: (key) => key,
                renderEmptyState() { sandbox.files = []; },
                renderFiles(files) { sandbox.files = files; },
                renderUnsupportedPage() {},
                extractAuthUser: () => "0",
                chrome: {
                    tabs: {
                        query: async () => [{ id: 1, windowId: 7, active: true, url: currentUrl }],
                        get: async () => ({ id: 1, windowId: 7, active: true, url: currentUrl }),
                        sendMessage: async () => ({
                            scope: "post", pageUrl: currentUrl, postId: currentPost, files: targetFiles,
                        }),
                    },
                    windows: { get: async (id) => ({ id, focused: true }) },
                },
                prepareDownloadUrl: async (file) => {
                    // Both posts contain the same attachment IDs. The first
                    // failed check can refresh the list, but must not rebind
                    // the remaining preparation workers to the new post.
                    await new Promise((resolve) => setTimeout(resolve, Number(file.id) * 10));
                    currentUrl = nextUrl;
                    currentPost = "mock-next";
                    return manual ? { manualUrl: file.link } : { url: file.link };
                },
                startDownload: async () => { starts++; },
                openManualDownload: async () => { manualOpens++; },
            });
            const flowStart = popupSource.indexOf("async function readCurrentPost()");
            const flowEnd = popupSource.indexOf('selectAll.addEventListener("change"', flowStart);
            vm.runInContext(popupSource.slice(flowStart, flowEnd), sandbox);
            const result = await sandbox.downloadBatch(targetFiles);
            assert.equal(starts, 0, "navigation during preparation must block automatic starts");
            assert.equal(manualOpens, 0, "navigation during preparation must block manual tabs");
            assert.equal(result.failed, 2, "all original workers must retain the original post boundary");
        }
    }
}

(async () => {
    await testBulkPreparationUsesBoundedConcurrency();
    await testOneFailureDoesNotStopTheBatch();
    await testManualFallbackFinishesBeforeTheBatch();
    await testManualFallbackFailureIsReported();
    await testFailureDuringPreparationIsPreserved();
    await testManualFallbackRechecksDuplicateHistory();
    await testNavigationDuringManualHistoryBlocksTheTab();
    await testNavigationDuringPreparationBlocksBothStartPaths();
    console.log("Download batch concurrency tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
