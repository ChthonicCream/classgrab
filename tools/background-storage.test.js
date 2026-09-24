const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(repoRoot, "scripts", "background.js"), "utf8");
const DOWNLOADS_KEY = "classgrabTrackedDownloads";
const STATUSES_KEY = "classgrabDownloadStatuses";

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createHarness(initialStorage = {}, initialItems = []) {
    const stored = clone(initialStorage);
    const items = new Map(initialItems.map((item) => [item.id, item]));
    const downloadCalls = [];
    let messageListener;
    let downloadChangeListener;
    let nextId = 1;
    let nextDownloadError = null;
    let nextItem = null;
    let failTrackingWrite = false;

    const chrome = {
        runtime: {
            onMessage: {
                addListener(listener) {
                    messageListener = listener;
                },
            },
        },
        storage: {
            local: {
                async get(keys) {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    return Object.fromEntries(
                        keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, clone(stored[key])]),
                    );
                },
                async set(values) {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    if (failTrackingWrite && downloadCalls.length) {
                        failTrackingWrite = false;
                        throw new Error("Synthetic storage write failure");
                    }
                    Object.assign(stored, clone(values));
                },
            },
        },
        downloads: {
            onChanged: {
                addListener(listener) {
                    downloadChangeListener = listener;
                },
            },
            async download(options) {
                downloadCalls.push(clone(options));
                if (nextDownloadError) {
                    const error = nextDownloadError;
                    nextDownloadError = null;
                    throw new Error(error);
                }
                const id = nextId++;
                const item = { id, filename: options.filename, mime: "application/pdf", state: "in_progress", ...nextItem };
                nextItem = null;
                items.set(id, item);
                // Emulate completion before the download() promise has even resolved.
                if (item.state === "complete") {
                    downloadChangeListener({ id, state: { current: "complete" } });
                }
                return id;
            },
            async search({ id }) {
                return items.has(id) ? [clone(items.get(id))] : [];
            },
        },
    };

    vm.runInNewContext(backgroundSource, { chrome, console, URL, Object, Date, Promise, String, Number, Set });
    assert.equal(typeof messageListener, "function");
    assert.equal(typeof downloadChangeListener, "function");

    return {
        stored,
        items,
        downloadCalls,
        setNextItem(item) {
            nextItem = item;
        },
        failNextDownload(error = "NETWORK_FAILED") {
            nextDownloadError = error;
        },
        failTrackingWrite() { failTrackingWrite = true; },
        change(id, updates) {
            Object.assign(items.get(id), updates);
            downloadChangeListener({
                id,
                ...(updates.state ? { state: { current: updates.state } } : {}),
                ...(updates.error ? { error: { current: updates.error } } : {}),
            });
        },
        send(request) {
            return new Promise((resolve, reject) => {
                let responded = false;
                const keepChannelOpen = messageListener(request, {}, (response) => {
                    responded = true;
                    resolve(clone(response));
                });
                if (!responded && keepChannelOpen !== true) {
                    reject(new Error("Async messages must keep the response channel open."));
                }
            });
        },
    };
}

function startRequest(id, allowDuplicate = false) {
    return {
        action: "startDownload",
        file: { id, name: "Synthetic_Worksheet.pdf" },
        url: "https://drive.google.com/uc?export=download&id=synthetic-file",
        allowDuplicate,
    };
}

async function verifyStorageConcurrency() {
    const harness = createHarness();
    const requests = Array.from({ length: 4 }, (_, index) => ({
        action: "trackDownload",
        downloadId: index + 1,
        file: { id: `attachment-${index + 1}` },
    }));
    requests.forEach(({ downloadId }) => {
        harness.items.set(downloadId, { id: downloadId, state: "in_progress", mime: "application/pdf" });
    });
    const responses = await Promise.all(requests.map((request) => harness.send(request)));
    assert.ok(responses.every((response) => response.ok));

    assert.deepEqual(Object.keys(harness.stored[DOWNLOADS_KEY]).sort(), ["1", "2", "3", "4"],
        "concurrent tracking messages must retain every download ID");
    assert.deepEqual(Object.keys(harness.stored[STATUSES_KEY]).sort(),
        ["attachment-1", "attachment-2", "attachment-3", "attachment-4"]);

    requests.forEach(({ downloadId }) => harness.change(downloadId, { state: "complete" }));
    const response = await harness.send({ action: "getDownloadStatuses" });
    assert.deepEqual(harness.stored[DOWNLOADS_KEY], {});
    assert.ok(Object.values(response.statuses).every((status) => status.label === "complete"),
        "concurrent completion events must preserve every final status");
}

async function verifyDuplicateGuard() {
    const harness = createHarness();
    const request = startRequest("drive:synthetic-one");
    const [first, concurrent] = await Promise.all([harness.send(request), harness.send(request)]);
    assert.equal(first.ok, true);
    assert.equal(first.downloadId, 1);
    assert.equal(harness.stored[DOWNLOADS_KEY]["1"].id, request.file.id,
        "tracking must be persisted before the popup receives success");
    assert.equal(concurrent.duplicate, true);
    assert.equal(concurrent.inProgress, true);
    assert.equal(harness.downloadCalls.length, 1, "concurrent popups must start exactly one download");

    const activeOverride = await harness.send(startRequest(request.file.id, true));
    assert.equal(activeOverride.duplicate, true, "confirmation cannot duplicate an active download");
    assert.equal(activeOverride.inProgress, true);

    // No onChanged event: the next request must still reconcile browser history.
    harness.items.get(first.downloadId).state = "complete";
    const completeDuplicate = await harness.send(request);
    assert.equal(completeDuplicate.duplicate, true);
    assert.equal(completeDuplicate.status.label, "complete");
    assert.equal(completeDuplicate.inProgress, false);

    const override = await harness.send(startRequest(request.file.id, true));
    assert.equal(override.downloadId, 2, "explicit confirmation permits a completed download again");
    assert.equal(harness.downloadCalls.length, 2);
    harness.change(override.downloadId, { state: "interrupted", error: "NETWORK_FAILED" });
    const afterFailure = await harness.send({ action: "getDownloadStatuses" });
    assert.equal(afterFailure.statuses[request.file.id].label, "complete",
        "a failed retry must preserve earlier successful completion");
    assert.equal(afterFailure.statuses[request.file.id].lastAttempt.label, "failed");
    assert.equal((await harness.send(request)).duplicate, true);

    const serialized = JSON.stringify(harness.stored);
    assert.ok(!serialized.includes("Synthetic_Worksheet"), "filenames must not be persisted");
    assert.ok(!serialized.includes("https:"), "download URLs must not be persisted");
}

async function verifyRetryAndImmediateCompletion() {
    const harness = createHarness();
    const first = await harness.send(startRequest("drive:synthetic-failure"));
    harness.change(first.downloadId, { state: "interrupted", error: "NETWORK_FAILED" });
    const failed = await harness.send({ action: "getDownloadStatuses" });
    assert.equal(failed.statuses["drive:synthetic-failure"].label, "failed");
    assert.equal((await harness.send(startRequest("drive:synthetic-failure"))).downloadId, 2,
        "a failed download is retryable without duplicate confirmation");

    harness.setNextItem({ state: "complete", mime: "text/html", filename: "Synthetic_Confirmation.html" });
    const html = await harness.send(startRequest("drive:synthetic-html"));
    assert.equal(html.status.label, "html warning");
    assert.ok(!harness.stored[DOWNLOADS_KEY][String(html.downloadId)]);
    assert.ok((await harness.send(startRequest("drive:synthetic-html"))).downloadId,
        "HTML confirmation pages must never block the real download");

    harness.setNextItem({ state: "complete" });
    const fast = await harness.send(startRequest("drive:synthetic-fast"));
    assert.equal(fast.status.label, "complete", "completion before tracking must be recovered immediately");
    assert.equal((await harness.send(startRequest("drive:synthetic-fast"))).duplicate, true);

    harness.failNextDownload();
    const failedStart = await harness.send(startRequest("drive:synthetic-start-error"));
    assert.equal(failedStart.ok, false);
    assert.ok(!harness.stored[STATUSES_KEY]["drive:synthetic-start-error"]);
    assert.ok((await harness.send(startRequest("drive:synthetic-start-error"))).downloadId,
        "a rejected start must not poison the queue or block retries");

    harness.failNextDownload();
    assert.equal((await harness.send(startRequest("drive:synthetic-fast", true))).ok, false);
    assert.equal(harness.stored[STATUSES_KEY]["drive:synthetic-fast"].label, "complete");
}

async function verifyRestartAndMissingHistory() {
    const seed = {
        [DOWNLOADS_KEY]: { "91": { id: "drive:synthetic-restarted" } },
        [STATUSES_KEY]: { "drive:synthetic-restarted": { label: "started", type: "success", updatedAt: Date.now() } },
    };
    const restarted = createHarness(seed, [{ id: 91, state: "complete", mime: "application/pdf" }]);
    const response = await restarted.send({ action: "getDownloadStatuses" });
    assert.equal(response.statuses["drive:synthetic-restarted"].label, "complete");
    assert.equal((await restarted.send(startRequest("drive:synthetic-restarted"))).duplicate, true);
    assert.equal(restarted.downloadCalls.length, 0);

    const missing = createHarness(seed);
    const missingResponse = await missing.send({ action: "getDownloadStatuses" });
    assert.equal(missingResponse.statuses["drive:synthetic-restarted"].label, "failed",
        "missing browser history must never be classified as a successful download");
    assert.deepEqual(missing.stored[DOWNLOADS_KEY], {});
    assert.ok((await missing.send(startRequest("drive:synthetic-restarted"))).downloadId);
}

async function verifyRetentionAndValidation() {
    const now = Date.now();
    const statuses = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [
        `synthetic-${index}`, { label: "complete", type: "success", updatedAt: now - index },
    ]));
    statuses.expired = { label: "complete", type: "success", updatedAt: now - 8 * 24 * 60 * 60 * 1000 };
    const harness = createHarness({ [STATUSES_KEY]: statuses });
    const response = await harness.send({ action: "getDownloadStatuses" });
    assert.equal(Object.keys(response.statuses).length, 100);
    assert.ok(!response.statuses.expired);
    assert.ok(!response.statuses["synthetic-109"]);

    for (const url of [
        "http://drive.google.com/file",
        "https://drive.google.com.evil.example/file",
        "https://example.com/file",
        "https://user:password" + "@" + "drive.google.com/file",
        "https://drive.google.com:444/file",
        "javascript:alert(1)",
    ]) {
        assert.equal((await harness.send({ ...startRequest("invalid"), url })).ok, false, url);
    }
    for (const file of [
        { id: "", name: "file.pdf" },
        { id: "synthetic", name: "../file.pdf" },
        { id: "synthetic", name: "subdirectory\\file.pdf" },
        { id: "synthetic", name: "" },
        { id: "synthetic" },
    ]) {
        assert.equal((await harness.send({ ...startRequest("invalid"), file })).ok, false);
    }
    assert.equal(harness.downloadCalls.length, 0);
    for (const host of ["drive.google.com", "drive.usercontent.google.com", "docs.google.com"]) {
        assert.ok((await harness.send({ ...startRequest(`synthetic:${host}`), url: `https://${host}/download` })).downloadId);
    }
}

async function verifyTrackingWriteFailure() {
    const harness = createHarness();
    harness.failTrackingWrite();
    const request = startRequest("drive:storage-failure");
    const result = await harness.send(request);
    assert.equal(result.ok, true, "accepted download must not be reported as a failed start");
    assert.equal(result.trackingWarning, true, "popup must stay open when tracking could not be saved");
    assert.equal(result.downloadId, 1);
    const duplicate = await harness.send(request);
    assert.equal(duplicate.duplicate, true, "in-memory tracking must guard retries while storage recovers");
    assert.equal(harness.downloadCalls.length, 1);
    assert.equal(harness.stored[DOWNLOADS_KEY]["1"].id, request.file.id);
}

(async () => {
    await verifyStorageConcurrency();
    await verifyDuplicateGuard();
    await verifyRetryAndImmediateCompletion();
    await verifyRestartAndMissingHistory();
    await verifyRetentionAndValidation();
    await verifyTrackingWriteFailure();
    console.log("Background storage, duplicate guard, recovery, and download validation tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
