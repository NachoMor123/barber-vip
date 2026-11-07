import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInstagramProfileUrl } from "../../profile-utils.js";

test("normalizes a bare Instagram username", () => {
  assert.equal(normalizeInstagramProfileUrl("nacho.barber"), "https://www.instagram.com/nacho.barber/");
  assert.equal(normalizeInstagramProfileUrl("@nacho_barber"), "https://www.instagram.com/nacho_barber/");
});

test("normalizes pasted Instagram profile links", () => {
  assert.equal(normalizeInstagramProfileUrl("instagram.com/nacho.barber"), "https://www.instagram.com/nacho.barber/");
  assert.equal(normalizeInstagramProfileUrl("https://instagram.com/nacho.barber/?hl=es"), "https://www.instagram.com/nacho.barber/");
  assert.equal(normalizeInstagramProfileUrl("http://www.instagram.com/nacho.barber/"), "https://www.instagram.com/nacho.barber/");
});

test("rejects non-Instagram domains and non-profile paths", () => {
  assert.equal(normalizeInstagramProfileUrl("https://instagram.com.evil.example/nacho"), "");
  assert.equal(normalizeInstagramProfileUrl("https://example.com/nacho"), "");
  assert.equal(normalizeInstagramProfileUrl("https://www.instagram.com/reel/ABC123/"), "");
  assert.equal(normalizeInstagramProfileUrl("https://www.instagram.com/nacho/reels/"), "");
});

test("rejects malformed handles instead of saving broken links", () => {
  assert.equal(normalizeInstagramProfileUrl("@"), "");
  assert.equal(normalizeInstagramProfileUrl("a username"), "");
  assert.equal(normalizeInstagramProfileUrl(".starts-with-dot"), "");
  assert.equal(normalizeInstagramProfileUrl("x".repeat(31)), "");
  assert.equal(normalizeInstagramProfileUrl(""), "");
});
