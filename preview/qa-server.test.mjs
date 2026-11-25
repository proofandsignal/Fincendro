import test from "node:test";
import assert from "node:assert/strict";
import { createQaServer } from "./qa-server.mjs";

const credentials = { user: "owner", password: "test-only-preview-password-24-chars!" };

test("anonymous requests cannot retrieve the synthetic demo, JS or assets", async t => {
  const server = createQaServer(credentials);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = "Basic " + Buffer.from(credentials.user + ":" + credentials.password).toString("base64");
  for (const path of ["/", "/index.html", "/demo/index.html", "/scripts.js"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 401, path);
    assert.match(res.headers.get("www-authenticate") || "", /Basic realm=/);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(res.headers.get("cache-control") || "", /no-store/);
    assert.equal(await res.text(), "Authentication required");
  }
  const health = await fetch(base + "/__health");
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "OK");

  const correct = await fetch(base + "/", { headers: { Authorization: auth } });
  assert.equal(correct.status, 200);
  const body = await correct.text();
  assert.match(body, /Fincendro/);
  assert.match(body, /Synthetic demo/);
  assert.match(correct.headers.get("content-security-policy") || "", /script-src 'sha256-/);
  assert.match(correct.headers.get("content-security-policy") || "", /connect-src 'none'/);
  assert.doesNotMatch(correct.headers.get("content-security-policy") || "", /unsafe-inline.*script-src/);
  const head = await fetch(base + "/index.html", {
    method: "HEAD", headers: { Authorization: auth }
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const path of ["/.env", "/README.md", "/preview/qa-server.mjs", "/anything"]) {
    assert.equal((await fetch(base + path, { headers: { Authorization: auth } })).status, 404, path);
  }
  assert.equal((await fetch(base + "/", { method: "POST", headers: { Authorization: auth } })).status, 405);
  assert.equal((await fetch(base + "/", { headers: { Authorization: "Basic invalid" } })).status, 401);
});

test("deployment refuses missing or weak credentials", () => {
  assert.throws(() => createQaServer({ user: "", password: credentials.password }), /Strong QA_USER/);
  assert.throws(() => createQaServer({ user: "owner", password: "short" }), /24/);
  assert.throws(() => createQaServer({ user: "bad:user", password: credentials.password }), /Strong QA_USER/);
});