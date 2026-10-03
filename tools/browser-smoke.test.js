// Optional real-Chromium integration check. Requires Playwright and a full
// Chromium executable; neither dependency nor a user browser profile is used
// by the normal release gate. All fixture identifiers are synthetic.
// Usage: node tools/browser-smoke.test.js --playwright <module> --browser <exe>
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const repository = path.resolve(__dirname, "..");
const fixtureUrl = "https://classroom.google.com/u/0/c/MTAx";
const fixtureHtml = fs.readFileSync(path.join(__dirname, "fixtures/stream.html"), "utf8");
const materialUrl = `${fixtureUrl}/m/MjAy/details`;
const materialHtml = fs.readFileSync(path.join(__dirname, "fixtures/material.html"), "utf8");
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
    argumentsByName.set(process.argv[index], process.argv[index + 1]);
}
const playwrightModule = argumentsByName.get("--playwright") || process.env.CLASSGRAB_PLAYWRIGHT_MODULE;
const executable = argumentsByName.get("--browser") || process.env.CLASSGRAB_CHROMIUM_EXECUTABLE;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function until(predicate, message, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await predicate();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(message);
}

// Action popups begin as Chrome "other" targets. Attach before their scripts
// run so their network is intercepted and their actual DOM can be checked.
// Ordinary Playwright page routing does not cover that initial target type.
class ChromeProtocol extends EventEmitter {
    constructor(endpoint) {
        super();
        this.socket = new WebSocket(endpoint);
        this.sequence = 0;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        this.socket.addEventListener("message", ({ data }) => {
            const message = JSON.parse(data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
            } else {
                this.emit(message.method, message.params, message.sessionId);
            }
        });
    }

    async send(method, params = {}, sessionId) {
        await this.ready;
        const id = ++this.sequence;
        const result = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Chrome protocol timed out: ${method}`));
            }, 10000);
            this.pending.set(id, { resolve, reject, timer });
        });
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return result;
    }

    async evaluate(popup, expression) {
        await popup.ready;
        const response = await this.send("Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: true,
        }, popup.sessionId);
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
        return response.result.value;
    }

    close() {
        this.socket.close();
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Synthetic browser closed."));
        }
        this.pending.clear();
    }
}

async function clickPopup(protocol, popup, selector) {
    const box = await protocol.evaluate(popup,
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
    await protocol.send("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 }, popup.sessionId);
    await protocol.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 }, popup.sessionId);
}

async function closePopup(protocol, popup) {
    // Let the extension widget close normally. Closing only its renderer via
    // Target.closeTarget can leave a widget that swallows the next page click.
    await protocol.evaluate(popup, "window.close()").catch((error) => {
        if (!popup.closed && !/Session with given id not found/.test(error.message)) throw error;
    });
    await until(() => popup.closed, "The action popup did not close.");
}

test("installed ClassGrab Stream buttons, material details, real action popup and duplicate guard", { timeout: 90000 }, async (t) => {
    assert.ok(playwrightModule && executable,
        "This opt-in check needs --playwright <module path> and --browser <full Chromium executable>.");
    assert.ok(fs.existsSync(executable), "The specified Chromium executable must exist.");
    const { chromium } = require(path.resolve(playwrightModule));
    const gitPath = path.join(repository, ".git");
    const gitDirectory = fs.statSync(gitPath).isDirectory() ? gitPath
        : path.resolve(repository, fs.readFileSync(gitPath, "utf8").replace(/^gitdir:\s*/i, "").trim());
    // Normal checkouts have a .git directory; managed worktrees have a pointer.
    // The caller never supplies or reuses a profile outside this ignored area.
    const artifactRoot = path.join(gitDirectory, "release-audit", "stream-1.2.0");
    fs.mkdirSync(artifactRoot, { recursive: true });
    const profile = fs.mkdtempSync(path.join(artifactRoot, "profile-"));
    const errors = [];
    const popups = [];
    const fetchRequests = [];
    let fetchGate = deferred();
    let releaseFetches = false;
    let browser;
    let protocol;
    const processHandle = spawn(executable, [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
        "--window-size=1280,800", `--disable-extensions-except=${repository}`, `--load-extension=${repository}`,
        "--no-first-run", "--no-default-browser-check", "--lang=en-US", "--disable-background-networking", "--disable-component-update",
        // Protect targets not managed by Playwright from making a real request.
        "--host-resolver-rules=MAP * 127.0.0.1",
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    try {
        const endpoint = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Chromium did not expose its isolated debugging endpoint.")), 20000);
            let output = "";
            processHandle.stderr.on("data", (buffer) => {
                output += String(buffer);
                const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
            });
            processHandle.once("error", (error) => { clearTimeout(timer); reject(error); });
            processHandle.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Synthetic Chromium exited: ${code}`)); });
        });
        browser = await chromium.connectOverCDP(endpoint);
        const context = browser.contexts()[0];
        protocol = new ChromeProtocol(endpoint);
        protocol.on("Runtime.exceptionThrown", (details) => {
            errors.push(details.exceptionDetails.exception?.description || details.exceptionDetails.text);
        });
        protocol.on("Target.targetDestroyed", ({ targetId }) => {
            const popup = popups.find((item) => item.targetId === targetId);
            if (popup) popup.closed = true;
        });
        protocol.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
            const popup = { sessionId, targetId: targetInfo.targetId, closed: false };
            popups.push(popup);
            popup.ready = (async () => {
                await protocol.send("Runtime.enable", {}, sessionId);
                await protocol.send("Page.enable", {}, sessionId);
                await protocol.send("Fetch.enable", { patterns: [{ urlPattern: "https://*", requestStage: "Request" }] }, sessionId);
                await protocol.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
            })();
            popup.ready.catch((error) => errors.push(error.message));
        });
        protocol.on("Fetch.requestPaused", (request, sessionId) => {
            (async () => {
                const url = new URL(request.request.url);
                fetchRequests.push(url.toString());
                if (url.hostname !== "drive.google.com" || url.pathname !== "/uc"
                    || !["mockA", "mockC"].includes(url.searchParams.get("id"))) {
                    errors.push("Unexpected synthetic popup request: " + url.origin + url.pathname);
                    await protocol.send("Fetch.failRequest", { requestId: request.requestId, errorReason: "BlockedByClient" }, sessionId);
                    return;
                }
                if (!releaseFetches) await fetchGate.promise;
                await protocol.send("Fetch.fulfillRequest", {
                    requestId: request.requestId, responseCode: 200,
                    responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }],
                    body: Buffer.from("Synthetic attachment bytes.").toString("base64"),
                }, sessionId);
            })().catch((error) => errors.push(error.message));
        });
        await protocol.send("Target.setAutoAttach", {
            autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
            filter: [{ type: "other" }, { exclude: true }],
        });
        await protocol.send("Target.setDiscoverTargets", { discover: true });
        await context.route("**/*", async (route) => {
            const url = route.request().url();
            if (url === fixtureUrl) return route.fulfill({ contentType: "text/html", body: fixtureHtml });
            if (url === materialUrl) return route.fulfill({ contentType: "text/html", body: materialHtml });
            if (url.startsWith("chrome-extension://")) return route.continue();
            return route.abort();
        });
        const worker = await until(async () => context.serviceWorkers().find((item) => item.url().endsWith("/scripts/background.js")),
            "ClassGrab did not load its service worker.");
        worker.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        const extensionUrl = new URL(worker.url());
        const extensionOrigin = extensionUrl.protocol + "//" + extensionUrl.hostname;
        // Keep the genuine runtime, storage, source-tab/document checks and
        // action APIs. Stub only browser download acceptance/history so this
        // fixture cannot send a Drive download request outside interception.
        await worker.evaluate(() => {
            globalThis.classgrabSyntheticStarts = [];
            globalThis.classgrabSyntheticItems = [];
            chrome.downloads.download = (options, callback) => {
                const id = 1000 + classgrabSyntheticStarts.length;
                classgrabSyntheticStarts.push(options);
                classgrabSyntheticItems.push({ id, filename: options.filename, mime: "application/octet-stream", state: "complete" });
                if (callback) callback(id);
                return Promise.resolve(id);
            };
            chrome.downloads.search = (query, callback) => {
                const items = classgrabSyntheticItems.filter((item) => query.id === undefined || item.id === query.id);
                if (callback) callback(items);
                return Promise.resolve(items);
            };
        });
        const page = context.pages()[0] || await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(fixtureUrl);
        await page.locator("#post-a .classgrab-stream-download").waitFor();
        const starts = () => worker.evaluate(() => classgrabSyntheticStarts);
        const newPopup = async (previousCount) => {
            const popup = await until(() => popups[previousCount], "The trusted Stream click did not open an action popup.");
            await until(async () => (await protocol.evaluate(popup, "location.href")).startsWith(extensionOrigin + "/views/popup.html"),
                "The action popup did not load ClassGrab.");
            return popup;
        };

        await t.test("visible per-post controls are scoped, localized and idempotent; script clicks cannot start", async () => {
            assert.equal(await page.locator(".classgrab-stream-download").count(), 2);
            assert.equal(await page.locator("#post-empty .classgrab-stream-download").count(), 0);
            assert.equal(await page.locator("#post-a .classgrab-stream-download").getAttribute("aria-label"),
                "Download 2 attachment(s) from this post with ClassGrab");
            await page.evaluate(() => {
                document.querySelector("#post-a").classList.add("fixture-rendered");
                document.querySelector("#post-a .classgrab-stream-download").click();
            });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await until(() => page.locator(".classgrab-stream-download").count().then((count) => count === 2), "Controls duplicated after rendering.");
            assert.deepEqual(await starts(), []);
            assert.equal(popups.length, 0);
            await page.screenshot({ path: path.join(artifactRoot, "stream-synthetic-1280x800.png") });
        });

        await t.test("the default action popup never downloads the Stream", async () => {
            const scan = await worker.evaluate(async () => {
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                return chrome.tabs.sendMessage(tab.id, { action: "getDriveLinks" }, { frameId: 0 });
            });
            assert.equal(scan.scope, "not-post");
            assert.deepEqual(scan.files, []);
            const before = popups.length;
            await worker.evaluate(() => chrome.action.openPopup());
            const popup = await newPopup(before);
            // An API-only popup open does not grant activeTab like clicking the
            // toolbar does, so the genuine popup may show its unsupported page.
            await until(async () => await protocol.evaluate(popup,
                "!!document.querySelector('#fileList') || document.body.textContent.includes('Not Google Classroom')"), "The default popup did not render.");
            assert.equal(await protocol.evaluate(popup, "document.querySelectorAll('.file-checkbox').length"), 0);
            assert.deepEqual(await starts(), []);
            await closePopup(protocol, popup);
        });

        await t.test("a trusted Stream click opens the installed popup and starts exactly that post once", async () => {
            const before = popups.length;
            await page.locator("#post-a .classgrab-stream-download").click();
            const popup = await newPopup(before);
            await until(async () => (await protocol.evaluate(popup, "document.querySelectorAll('.file-name').length")) === 2,
                "The selected post's two files did not appear.");
            assert.deepEqual(await protocol.evaluate(popup, "[...document.querySelectorAll('.file-name')].map(e=>e.textContent)"),
                ["Practice.pdf", "Revision_notes.docx"]);
            const image = await protocol.send("Page.captureScreenshot", { format: "png" }, popup.sessionId);
            fs.writeFileSync(path.join(artifactRoot, "popup-synthetic-preparing.png"), Buffer.from(image.data, "base64"));
            releaseFetches = true;
            fetchGate.resolve();
            await until(async () => (await starts()).length === 2 && popup.closed, "The clean batch did not start both files and close its popup.");
            const accepted = await starts();
            assert.deepEqual(accepted.map((item) => item.filename).sort(), ["Practice.pdf", "Revision_notes.docx"]);
            assert.ok(accepted.every((item) => new URL(item.url).searchParams.get("authuser") === "0"));
            const action = await worker.evaluate(async () => {
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                return chrome.action.getPopup({ tabId: tab.id });
            });
            assert.equal(action, extensionOrigin + "/views/popup.html", "The launch query must not survive in the default toolbar popup.");
        });

        await t.test("another post replaces the first selection rather than adding to it", async () => {
            releaseFetches = false;
            fetchGate = deferred();
            const before = popups.length;
            await page.locator("#post-b .classgrab-stream-download").click();
            const popup = await newPopup(before);
            await until(async () => (await protocol.evaluate(popup, "document.querySelectorAll('.file-name').length")) === 1,
                "The second post's sole file did not appear.");
            assert.deepEqual(await protocol.evaluate(popup, "[...document.querySelectorAll('.file-name')].map(e=>e.textContent)"), ["Data.csv"]);
            releaseFetches = true;
            fetchGate.resolve();
            await until(async () => (await starts()).length === 3 && popup.closed, "The second post's clean batch did not finish.");
            assert.deepEqual((await starts()).map((item) => item.filename).sort(), ["Data.csv", "Practice.pdf", "Revision_notes.docx"]);
            assert.equal(fetchRequests.filter((url) => new URL(url).searchParams.get("id") === "mockA").length, 1);
        });

        await t.test("repeating a completed post warns before preparation; Cancel starts nothing", async () => {
            const before = popups.length;
            await page.locator("#post-a .classgrab-stream-download").click();
            const popup = await newPopup(before);
            await until(async () => await protocol.evaluate(popup, "!!document.querySelector('#duplicatePanel:not([hidden])')"), "The repeat did not display a duplicate warning.");
            assert.deepEqual(await protocol.evaluate(popup, "[...document.querySelectorAll('#duplicateFiles li')].map(e=>e.textContent)"), ["Practice.pdf", "Revision_notes.docx"]);
            const image = await protocol.send("Page.captureScreenshot", { format: "png" }, popup.sessionId);
            fs.writeFileSync(path.join(artifactRoot, "popup-synthetic-duplicates.png"), Buffer.from(image.data, "base64"));
            await clickPopup(protocol, popup, 'button[data-choice="cancel"]');
            await until(async () => (await protocol.evaluate(popup, "document.querySelector('#statusPanel').textContent")) === "Download cancelled.", "Cancel was not acknowledged.");
            assert.equal((await starts()).length, 3);
            assert.equal(fetchRequests.length, 2, "Duplicate decisions must happen before new Drive requests.");
            await closePopup(protocol, popup);
        });

        await t.test("changing a selected post while its warning is open prevents a repeat batch", async () => {
            const before = popups.length;
            await page.locator("#post-a .classgrab-stream-download").click();
            const popup = await newPopup(before);
            await until(async () => await protocol.evaluate(popup, "!!document.querySelector('#duplicatePanel:not([hidden])')"), "The repeat warning did not render.");
            await page.evaluate(() => document.querySelector("#post-a .post-marker").setAttribute("data-stream-item-id", "205"));
            await clickPopup(protocol, popup, 'button[data-choice="again"]');
            await until(async () => (await protocol.evaluate(popup, "document.querySelector('#statusPanel').textContent")) === "The current post changed. Review its files before downloading.", "The changed post was not rejected.");
            assert.equal((await starts()).length, 3);
            assert.equal(fetchRequests.length, 2);
            await closePopup(protocol, popup);
        });

        await t.test("DOM updates add/remove controls and leaving the Stream cleans them up", async () => {
            await page.evaluate(() => {
                const card = document.createElement("article");
                card.id = "post-new";
                card.className = "n4xnA";
                const marker = document.createElement("span");
                marker.textContent = "⋮";
                marker.setAttribute("data-stream-item-id", "204");
                const link = document.createElement("a");
                link.href = "https://drive.google.com/file/d/mockD/view";
                link.textContent = "New.txt";
                link.setAttribute("aria-label", "New.txt");
                card.append(marker, link);
                document.querySelector("main").appendChild(card);
                document.querySelector("#post-b").hidden = true;
            });
            await until(() => page.locator("#post-new .classgrab-stream-download").count(), "A newly rendered post did not get a control.");
            await until(async () => (await page.locator("#post-b .classgrab-stream-download").count()) === 0, "A hidden post retained its control.");
            await page.evaluate(() => {
                history.pushState({}, "", "/u/0/c/MTAx/p/MjA0/details");
                window.dispatchEvent(new PopStateEvent("popstate"));
            });
            await until(async () => (await page.locator(".classgrab-stream-download").count()) === 0, "Controls remained after leaving the Stream.");
            assert.equal((await starts()).length, 3);
        });

        await t.test("material shell detects nine sibling files and rejects them during a post change", async () => {
            await page.goto(materialUrl);
            const scanPage = () => worker.evaluate(async () => {
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                return chrome.tabs.sendMessage(tab.id, { action: "getDriveLinks" }, { frameId: 0 });
            });
            const result = await until(async () => {
                const scan = await scanPage().catch(() => null);
                return scan?.pageUrl === materialUrl && scan.files.length === 9 ? scan : null;
            }, "The installed scanner did not detect the material's nine files.");
            assert.equal(result.scope, "post");
            assert.deepEqual(result.files.map((file) => file.fileId),
                ["matA", "matB", "matC", "matD", "matE", "matF", "matG", "matH", "matI"]);
            assert.equal(await page.locator(".classgrab-stream-download").count(), 0);
            await page.evaluate(() => {
                history.pushState({}, "", "/u/0/c/MTAx/m/MjAz/details");
                document.querySelectorAll("#material [data-stream-item-id]").forEach((node) => {
                    node.setAttribute("data-stream-item-id", "203");
                });
                document.querySelector("#material h1").textContent = "Another example material";
                window.dispatchEvent(new PopStateEvent("popstate"));
            });
            const retained = await scanPage();
            assert.equal(retained.scope, "unavailable");
            assert.deepEqual(retained.files, []);
            await page.evaluate(() => {
                document.querySelectorAll("#material .attachments a").forEach((node, index) => {
                    node.href = `https://drive.google.com/file/d/next${index}/view`;
                });
            });
            assert.deepEqual((await scanPage()).files.map((file) => file.fileId),
                Array.from({ length: 9 }, (_, index) => `next${index}`));
            assert.equal((await starts()).length, 3, "A scan must not start material downloads.");
        });
        assert.deepEqual(errors, [], "The genuine content script, popup and worker must not throw exceptions.");
        t.diagnostic(`Chromium ${browser.version()}; genuine installed action popup/runtime/storage; download acceptance/history stubbed; synthetic URL only.`);
        t.diagnostic(`Synthetic screenshots: ${artifactRoot}`);
    } finally {
        fetchGate.resolve();
        if (browser) await browser.close().catch(() => {});
        if (protocol) protocol.close();
        processHandle.kill();
    }
});
