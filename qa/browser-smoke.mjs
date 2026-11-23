/**
 * Hermetic Chromium smoke for Fincendro's synthetic Borrow demo.
 * Uses only a preinstalled Chrome/Chromium and Node's CDP WebSocket.
 * It is not deployed HTTPS, Samsung, legal, or owner approval evidence.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function locateChrome() {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error("No preinstalled Chromium/Chrome; abort without downloading");
}

async function eventually(fn, description, attempts = 150) {
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await fn();
      if (value) return value;
      last = String(value);
    } catch (error) {
      last = error.message;
    }
    await pause(100);
  }
  throw new Error("Timed out: " + description + " (" + last + ")");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.requests = [];
    ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params?.exceptionDetails?.text || "JS exception");
      }
      if (message.method === "Network.requestWillBeSent") {
        this.requests.push(message.params?.request?.url || "");
      }
      if (message.id == null) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    const id = ++this.id;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return Promise.race([
      result,
      pause(7000).then(() => { throw new Error("CDP timeout: " + method); }),
    ]);
  }

  async eval(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
}

const html = await readFile(new URL("../demo/index.html", import.meta.url), "utf8");
const server = createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
  response.end(html);
});

let chrome;
let ws;
const profile = await mkdtemp(join(tmpdir(), "fincendro-browser-smoke-"));

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const appUrl = "http://127.0.0.1:" + server.address().port;

  chrome = spawn(locateChrome(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-background-networking", "--disable-extensions", "--no-first-run",
    "--no-default-browser-check", "--remote-allow-origins=*", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let chromeError = "";
  chrome.stderr.on("data", chunk => { chromeError = (chromeError + String(chunk)).slice(-2000); });
  const portFile = join(profile, "DevToolsActivePort");
  const port = await eventually(async () => {
    if (chrome.exitCode !== null) throw new Error("Chrome exited: " + chromeError);
    const data = await readFile(portFile, "utf8");
    return Number(data.split("\n")[0]) || false;
  }, "Chrome DevTools endpoint");

  const page = await eventually(async () => {
    const response = await fetch("http://127.0.0.1:" + port + "/json/list");
    return (await response.json()).find(item => item.type === "page" && item.webSocketDebuggerUrl);
  }, "Chrome page target");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const cdp = new CDP(ws);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Page.navigate", { url: appUrl + "/" });
  await eventually(() => cdp.eval("document.readyState === 'complete' && document.querySelectorAll('.card').length === 3"), "demo render");

  assert.equal(await cdp.eval("document.documentElement.lang"), "en");
  assert.ok((await cdp.eval("document.querySelector('h1').textContent")).includes("Compare crypto-backed loans"));
  assert.ok((await cdp.eval("document.querySelector('#offers').textContent")).includes("Atlas"));
  assert.ok((await cdp.eval("document.querySelector('#offers').textContent")).includes("880.00 USDC"));
  assert.ok((await cdp.eval("document.querySelector('#offers').textContent")).includes("850.00 USDC"));
  assert.ok((await cdp.eval("document.querySelector('#offers').textContent")).includes("Meridian"));
  assert.equal(await cdp.eval("document.querySelector('#simulate').disabled"), true);
  assert.equal(await cdp.eval("document.querySelector('button[type=button]').disabled"), true);

  await cdp.eval("document.querySelector('#market').value='Germany'; document.querySelector('#market').dispatchEvent(new Event('change')); document.querySelector('#comparison').requestSubmit()");
  const germany = await cdp.eval("document.querySelector('#offers').textContent");
  assert.ok(germany.includes("Cedar"));
  assert.ok(germany.includes("Unconfirmed"));
  assert.ok(germany.includes("Only comparable offer"));
  assert.equal(await cdp.eval("document.querySelectorAll('.card.best').length"), 0);
  assert.equal(await cdp.eval("document.querySelectorAll('.gate:checked').length"), 0);

  await cdp.eval("document.querySelectorAll('.gate').forEach(input => { input.click(); });");
  assert.equal(await cdp.eval("document.querySelector('#simulate').disabled"), false);
  await cdp.eval("document.querySelector('#simulate').click()");
  assert.equal(await cdp.eval("document.querySelector('#simulation-result').hidden"), false);
  await cdp.eval("document.querySelector('#market').value='Bulgaria'; document.querySelector('#market').dispatchEvent(new Event('change'))");
  assert.equal(await cdp.eval("document.querySelectorAll('.gate:checked').length"), 0);
  assert.equal(await cdp.eval("document.querySelector('#simulation-result').hidden"), true);

  assert.equal(await cdp.eval("document.querySelector('#amount').tabIndex"), 0);
  assert.equal(await cdp.eval("document.querySelector('#collateral').tabIndex"), 0);
  assert.equal(await cdp.eval("document.querySelector('#market').tabIndex"), 0);
  assert.equal(await cdp.eval("document.querySelector('button[type=submit]').tabIndex"), 0);

  for (const width of [390, 412, 1280]) {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 2, mobile: width < 700 });
    await pause(80);
    const metrics = await cdp.eval("({viewport: innerWidth, scroll: document.documentElement.scrollWidth})");
    assert.equal(metrics.viewport, width);
    assert.ok(metrics.scroll <= width + 2, "horizontal overflow at " + width + "px");
  }

  const external = cdp.requests.filter(url => url && !url.startsWith(appUrl) && !url.startsWith("data:") && !url.startsWith("about:"));
  assert.deepEqual(external, []);
  assert.deepEqual(cdp.exceptions, []);
  process.stdout.write("FINCENDRO CHROMIUM SMOKE PASS: BG/Germany values, unconfirmed terms, referral gates, keyboard order, 390/412/Desktop, zero external requests\n");
} finally {
  if (ws) ws.close();
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, "exit").catch(() => {});
    chrome.kill("SIGTERM");
    await Promise.race([exited, pause(1500)]);
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([exited, pause(1000)]);
    }
  }
  await new Promise(resolve => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 125 });
}
