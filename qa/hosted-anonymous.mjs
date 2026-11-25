// Independent from browser/local Basic-auth tests: probe ONLY unauthenticated hosted routes.
// No reviewer credentials, secrets, transaction endpoints or confidential response bodies.
import assert from "node:assert/strict";

const origin = "https://fincendro-private-owner-qa.onrender.com";
async function probe(path, expected) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(origin + path, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(90000),
        headers: { "Cache-Control": "no-store" }
      });
      assert.equal(res.status, expected, path + " unexpected status");
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
      assert.match(res.headers.get("cache-control") || "", /no-store/);
      if (expected === 401) {
        assert.match(res.headers.get("www-authenticate") || "", /^Basic /);
        assert.match(res.headers.get("content-security-policy") || "", /default-src 'none'/);
        assert.equal(await res.text(), "Authentication required");
      } else {
        assert.equal(await res.text(), "OK");
      }
      console.log(path, expected === 401 ? "ANONYMOUS_DENY_PASS" : "HEALTH_PASS");
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
  throw lastError;
}
await probe("/__health", 200);
await probe("/", 401);
await probe("/index.html", 401);
await probe("/preview/qa-server.mjs", 401);
console.log("Hosted anonymous evidence complete; authenticated 200 and physical Samsung remain separate.");
