import assert from "node:assert/strict";
import test from "node:test";
import {
  FREEZE_STATE_KEY,
  freezeStateFromStorage,
  persistFreezeState
} from "../src/ui/freeze-state-policy.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test("freeze state loads all row/column combinations independently", () => {
  for (const [row, column] of [[false, false], [true, false], [false, true], [true, true]]) {
    const storage = memoryStorage({ [FREEZE_STATE_KEY]: JSON.stringify({ row, column }) });
    assert.deepEqual(freezeStateFromStorage(storage), { row, column });
  }
});

test("invalid or unavailable storage falls back without breaking startup", () => {
  assert.deepEqual(freezeStateFromStorage(memoryStorage({ [FREEZE_STATE_KEY]: "{" })), { row: false, column: false });
  assert.deepEqual(freezeStateFromStorage({ getItem() { throw new Error("blocked"); } }), { row: false, column: false });
});

test("freeze state persistence stores booleans and tolerates write failures", () => {
  const storage = memoryStorage();
  assert.deepEqual(persistFreezeState({ freezeRow: 1, freezeColumn: 0 }, storage), { row: true, column: false });
  assert.deepEqual(JSON.parse(storage.getItem(FREEZE_STATE_KEY)), { row: true, column: false });
  assert.doesNotThrow(() => persistFreezeState({ freezeRow: true, freezeColumn: true }, {
    setItem() { throw new Error("blocked"); }
  }));
});
