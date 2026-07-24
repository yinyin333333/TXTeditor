import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUTTON_FEEDBACK_CLASS,
  BUTTON_FEEDBACK_DURATION_MS,
  interactiveButtonFromTarget,
  showButtonClickFeedback
} from "../src/ui/button-feedback-policy.js";

function fakeButton({ disabled = false, ariaDisabled = null } = {}) {
  const classes = new Set();
  const button = {
    disabled,
    getAttribute: (name) => name === "aria-disabled" ? ariaDisabled : null,
    closest: (selector) => selector === "button" ? button : null,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
  return button;
}

test("#75 common click feedback applies briefly without changing button dimensions", () => {
  const button = fakeButton();
  let callback = null;
  let delay = null;
  assert.equal(showButtonClickFeedback(button, {
    nextFrame: (fn) => fn(),
    schedule: (fn, ms) => { callback = fn; delay = ms; return 1; },
    cancel: () => {}
  }), true);
  assert.equal(button.classList.contains(BUTTON_FEEDBACK_CLASS), true);
  assert.equal(delay, BUTTON_FEEDBACK_DURATION_MS);
  callback();
  assert.equal(button.classList.contains(BUTTON_FEEDBACK_CLASS), false);
});

test("#75 disabled and aria-disabled buttons never present interactive feedback", () => {
  for (const button of [fakeButton({ disabled: true }), fakeButton({ ariaDisabled: "true" })]) {
    assert.equal(interactiveButtonFromTarget(button), null);
    assert.equal(showButtonClickFeedback(button, { nextFrame: (fn) => fn(), schedule: () => 1 }), false);
    assert.equal(button.classList.contains(BUTTON_FEEDBACK_CLASS), false);
  }
});

test("#75 stylesheet defines one hover/pressed/focus system with toggle and reduced-motion states", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /button:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
  assert.match(css, /button\.button-click-feedback:not\(:disabled\):not\(\[aria-disabled="true"\]\)/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.toggle-button\.active:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /button\.button-click-feedback[^}]*?(?:width|height|padding|margin):/s);
});
