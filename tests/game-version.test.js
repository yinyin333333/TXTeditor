import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalGameVersionConfig,
  legacyGameVersion,
  legacyRuleFamilyForGameVersion,
  vectorGameVersion,
  vectorSchemaForGameVersion
} from "../src/core/game-version.js";

test("one public game version maps atomically to Legacy and Vector variants", () => {
  for (const [version, family, schema] of [
    ["3.3", "RotW", "3.3"],
    ["3.2", "RotW", "3.2"],
    ["3.1", "RotW", "3.1"],
    ["2.4", "2.4", "2.4"],
    ["1.13c", "1.13c", "1.13"]
  ]) {
    assert.equal(legacyRuleFamilyForGameVersion(version), family);
    assert.equal(vectorSchemaForGameVersion(version), schema);
    assert.deepEqual(canonicalGameVersionConfig({}, version), {
      gameVersion: version,
      schemaVersion: schema,
      referenceVersion: version
    });
  }
});

test("legacy and Vector migration normalize mixed old configurations deterministically", () => {
  assert.equal(legacyGameVersion({ referenceVersion: "3.1" }, "RotW"), "3.1");
  assert.equal(legacyGameVersion({ referenceVersion: "2.4" }, "RotW"), "3.3");
  assert.equal(legacyGameVersion({ referenceVersion: "3.1" }, "2.4"), "2.4");
  assert.equal(legacyGameVersion({ referenceVersion: "3.2" }, "1.13c"), "1.13c");
  assert.equal(vectorGameVersion({ schemaVersion: "1.13", referenceVersion: "3.2" }), "1.13c");
  assert.equal(vectorGameVersion({ schemaVersion: "invalid", referenceVersion: "3.1" }), "3.1");
});
