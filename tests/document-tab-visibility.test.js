import assert from "node:assert/strict";
import test from "node:test";
import { revealActiveDocumentTab } from "../src/ui/document-tab-visibility.js";

function strip({ left, width = 150, viewportWidth = 400, scrollLeft = 0 }) {
  return {
    clientWidth: viewportWidth,
    clientLeft: 0,
    scrollLeft,
    getBoundingClientRect: () => ({ left: 250 }),
    querySelector: () => ({
      getBoundingClientRect: () => ({ left, right: left + width, width })
    })
  };
}

test("offscreen active tabs are revealed in both directions with minimal scrolling", () => {
  const tabs = strip({ left: 750 });
  revealActiveDocumentTab(tabs);
  assert.equal(tabs.scrollLeft, 256);
  const previous = strip({ left: 100, scrollLeft: 900 });
  revealActiveDocumentTab(previous);
  assert.equal(previous.scrollLeft, 744);
});

test("visible tabs preserve the user's scroll position", () => {
  const tabs = strip({ left: 300, scrollLeft: 700 });
  revealActiveDocumentTab(tabs);
  assert.equal(tabs.scrollLeft, 700);
});

test("fractional browser coordinates round outward so tab borders stay visible", () => {
  const tabs = strip({ left: 500.35 });
  revealActiveDocumentTab(tabs);
  assert.equal(tabs.scrollLeft, 7);
  const previous = strip({ left: 249.65, scrollLeft: 100 });
  revealActiveDocumentTab(previous);
  assert.equal(previous.scrollLeft, 93);
});

test("narrow strips align oversized tabs to the start without oscillating", () => {
  const tabs = strip({ left: 320, viewportWidth: 100 });
  revealActiveDocumentTab(tabs);
  assert.equal(tabs.scrollLeft, 64);
  const aligned = strip({ left: 256, viewportWidth: 100, scrollLeft: 64 });
  revealActiveDocumentTab(aligned);
  assert.equal(aligned.scrollLeft, 64);
});

test("empty and hidden tab strips do not scroll", () => {
  const empty = { scrollLeft: 0, querySelector: () => null };
  revealActiveDocumentTab(empty);
  assert.equal(empty.scrollLeft, 0);
  const hidden = strip({ left: 1000, viewportWidth: 0 });
  revealActiveDocumentTab(hidden);
  assert.equal(hidden.scrollLeft, 0);
});
