import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const html = await readFile(new URL("../demo/index.html", import.meta.url), "utf8");

test("Fincendro demo preserves English synthetic boundary", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Synthetic demo/);
  assert.match(html, /Fincendro synthetic example/);
  assert.match(html, /crypto-backed loans/i);
  assert.match(html, /Unconfirmed/);
});

test("demo has no external resource dependency", () => {
  assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]+(?:src|href)=["']https?:\/\//i);
  assert.doesNotMatch(html, /(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test("live referral remains disabled and simulation is gated", () => {
  assert.match(html, /Continue to partner[^<]*<\/button>/);
  assert.match(html, /<button type="button" disabled>Continue to partner/);
  assert.match(html, /Market eligibility/);
  assert.match(html, /Referral authorization/);
  assert.match(html, /Written terms/);
  assert.match(html, /simulation\.disabled = !gates\.every/);
  assert.match(html, /market\.addEventListener\("change"/);
});

test("all three synthetic offer fixtures and expected example values remain present", () => {
  for (const name of ["Atlas", "Cedar", "Meridian"]) assert.match(html, new RegExp('name:"' + name + '"'));
  assert.match(html, /rate:0\.075/);
  assert.match(html, /rate:0\.081/);
  assert.match(html, /fee:0\.013/);
  assert.match(html, /fee:0\.004/);
});
