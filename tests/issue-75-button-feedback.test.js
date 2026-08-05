import assert from "node:assert/strict";
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
