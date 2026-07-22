const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(repoRoot, "scripts", "background.js"), "utf8");
const stored = {};
let messageListener = null;
let downloadChangeListener = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

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
                await new Promise((resolve) => setTimeout(resolve, 5));
                return Object.fromEntries(
                    keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, clone(stored[key])]),
                );
            },
            async set(values) {
                await new Promise((resolve) => setTimeout(resolve, 5));
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
        async search({ id }) {
            return [{ id, filename: `file-${id}.pdf`, mime: "application/pdf" }];
        },
    },
};

vm.runInNewContext(backgroundSource, { chrome, console, Object, Date, Promise, String });
assert.equal(typeof messageListener, "function", "background message listener must be registered");
assert.equal(typeof downloadChangeListener, "function", "download change listener must be registered");

function sendMessage(request) {
    return new Promise((resolve, reject) => {
        const keepChannelOpen = messageListener(request, {}, (response) => {
            if (response && response.ok === false) {
                reject(new Error(response.error));
                return;
            }
            resolve(response);
        });

        assert.equal(keepChannelOpen, true, "async messages must keep the response channel open");
    });
}

(async () => {
    const requests = Array.from({ length: 4 }, (_, index) => ({
        action: "trackDownload",
        downloadId: index + 1,
        file: { id: `attachment-${index + 1}` },
    }));

    await Promise.all(requests.map(sendMessage));

    assert.deepEqual(
        Object.keys(stored.classgrabTrackedDownloads || {}).sort(),
        ["1", "2", "3", "4"],
        "concurrent tracking messages must retain every download ID",
    );
    assert.deepEqual(
        Object.keys(stored.classgrabDownloadStatuses || {}).sort(),
        ["attachment-1", "attachment-2", "attachment-3", "attachment-4"],
        "concurrent tracking messages must retain every attachment status",
    );

    requests.forEach((request) => {
        downloadChangeListener({
            id: request.downloadId,
            state: { current: "complete" },
        });
    });
    const statusResponse = await sendMessage({ action: "getDownloadStatuses" });

    assert.deepEqual(
        Object.keys(stored.classgrabTrackedDownloads || {}),
        [],
        "completed downloads should be removed from transient tracking",
    );
    assert.ok(
        Object.values(statusResponse.statuses).every((status) => status.label === "complete"),
        "concurrent completion events should preserve every final status",
    );
    console.log("Background storage concurrency tests passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
