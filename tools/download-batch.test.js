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
        startDownload: async () => {},
        openManualDownload() {},
        restoreStoredStatuses() {},
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

(async () => {
    await testBulkPreparationUsesBoundedConcurrency();
    await testOneFailureDoesNotStopTheBatch();
    await testManualFallbackFinishesBeforeTheBatch();
    await testManualFallbackFailureIsReported();
    console.log("Download batch concurrency tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
