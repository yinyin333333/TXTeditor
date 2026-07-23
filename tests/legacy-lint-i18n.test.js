import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import {
  LEGACY_LINT_LOCALES,
  legacyLintCatalogs,
  legacyMessage,
  legacyMessageText,
  legacyRuleMetadata,
  legacyTerm,
  resolveLegacyMessage,
  validateLegacyLintCatalogs
} from "../src/core/legacy-lint-i18n.js";
import { TableDocument } from "../src/core/table-model.js";

const LINT_SOURCES = [
  "src/core/lint-basic-rules.js",
  "src/core/lint-cube-rules.js",
  "src/core/lint-item-rules.js",
  "src/core/lint-level-rules.js",
  "src/core/lint-misc-rules.js",
  "src/core/lint-treasure-rules.js"
];

function tokens(template) {
  return [...String(template).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

test("Legacy lint catalogs have complete locale and named-argument parity", () => {
  const validation = validateLegacyLintCatalogs();
  assert.equal(validation.locales, LEGACY_LINT_LOCALES.length);
  for (const locale of LEGACY_LINT_LOCALES) {
    assert.deepEqual(Object.keys(legacyLintCatalogs[locale]).sort(), Object.keys(legacyLintCatalogs.enUS).sort(), locale);
    for (const [key, english] of Object.entries(legacyLintCatalogs.enUS)) {
      assert.deepEqual(tokens(legacyLintCatalogs[locale][key]), tokens(english), `${locale}:${key}`);
      if (locale !== "enUS") assert.notEqual(legacyLintCatalogs[locale][key], english, `${locale}:${key}`);
    }
    const metadata = legacyRuleMetadata("Cube/ValidInputs", locale);
    assert.ok(metadata.label);
    assert.ok(metadata.note);
  }
});

test("Legacy lint message rendering preserves values, escapes only on request, and keeps identities locale-invariant", () => {
  const descriptor = legacyMessage("basic.duplicate", { column: "id", value: "<mod>&", previousRow: 2 });
  assert.match(resolveLegacyMessage(descriptor, "koKR"), /<mod>&/);
  assert.match(resolveLegacyMessage(descriptor, "koKR", { escape: true }), /&lt;mod&gt;&amp;/);

  const document = TableDocument.fromText("monai.txt", "AI\n<mod>&\n<mod>&");
  const settings = createDefaultLintSettings();
  const english = runLint([document], settings, { locale: "enUS" });
  const korean = runLint([document], settings, { locale: "koKR" });
  assert.equal(korean.length, english.length);
  assert.deepEqual(korean.map(({ id, messageKey, messageArgs }) => ({ id, messageKey, messageArgs })), english.map(({ id, messageKey, messageArgs }) => ({ id, messageKey, messageArgs })));
  assert.notEqual(korean[0].message, english[0].message);
});

test("Korean Legacy Lint catalog has complete native copy without mechanical particles", () => {
  const korean = legacyLintCatalogs.koKR;
  assert.equal(Object.keys(korean).length, 86);
  for (const [key, template] of Object.entries(korean)) {
    assert.equal(template.includes("(은)"), false, key);
    assert.equal(template.includes("(는)"), false, key);
    assert.equal(template.includes("(이)"), false, key);
    assert.equal(template.includes("(가)"), false, key);
    assert.equal(template.includes("(을)"), false, key);
    assert.equal(template.includes("(를)"), false, key);
    assert.equal(["}은", "}는", "}이", "}가", "}을", "}를", "\"은", "\"는", "\"이", "\"가", "\"을", "\"를"].some((suffix) => template.includes(suffix)), false, key);
  }
  assert.match(korean["items.chargeCap"], /최대 충전 횟수/);
  assert.match(korean["basic.unknownSummode"], /summode/);
  assert.match(korean["cube.stopsAfterModifier"], /기본 아이템/);
  assert.match(legacyRuleMetadata("TC/ValidNegativePicks", "koKR").label, /음수 Picks/);
});

test("High-risk Legacy Lint translations preserve identifiers and game semantics", () => {
  const sentinels = {
    zhTW: { range: "超出", charge: "最大充能次數", socket: "限制有效插槽數" },
    deDE: { range: "außerhalb", charge: "Ladungen", socket: "begrenzt" },
    esES: { range: "fuera", charge: "cargas máximas", socket: "limita" },
    frFR: { range: "hors", charge: "nombre maximal de charges", socket: "limite" },
    itIT: { range: "fuori", charge: "numero massimo di cariche", socket: "limita" },
    koKR: { range: "벗어났습니다", storage: "벗어나", charge: "최대 충전 횟수", socket: "상한으로 제한" },
    plPL: { range: "poza", charge: "liczba ładunków", socket: "ogranicza" },
    esMX: { range: "fuera", charge: "cargas máximas", socket: "limita" },
    jaJP: { range: "範囲外", charge: "最大チャージ数", socket: "制限" },
    ptBR: { range: "fora", charge: "máximo de cargas", socket: "limita" },
    ruRU: { range: "вне диапазона", charge: "число зарядов", socket: "ограничивает" },
    zhCN: { range: "超出", charge: "最大充能次数", socket: "限制有效插槽数" }
  };
  for (const [locale, expected] of Object.entries(sentinels)) {
    const catalog = legacyLintCatalogs[locale];
    assert.match(catalog["basic.integerBacktick"], /`/, `${locale}:backtick`);
    assert.match(catalog["basic.missileRangeInteger"], /missiles\.range/, `${locale}:missiles.range`);
    assert.match(catalog["basic.unknownSummode"], /summode/, `${locale}:summode`);
    assert.match(catalog["cube.inputQtyRange"], new RegExp(expected.range, "i"), `${locale}:outside-range`);
    assert.match(catalog["cube.storageRange"], new RegExp(expected.storage ?? expected.range, "i"), `${locale}:storage-range`);
    assert.match(catalog["cube.stopsAfterModifier"], /\{stoppedAt\}/, `${locale}:stops-after`);
    assert.match(catalog["cube.stopsAfterModifierConditional"], /\{suffixLabel\}/, `${locale}:conditional-stops-after`);
    assert.match(catalog["items.chargeCap"], new RegExp(expected.charge, "i"), `${locale}:charges`);
    assert.match(catalog["items.typeSocketCap"], new RegExp(expected.socket, "i"), `${locale}:socket-clamp`);
    assert.match(catalog["items.inventorySocketCap"], new RegExp(expected.socket, "i"), `${locale}:inventory-socket-clamp`);
  }
  for (const locale of ["zhTW", "zhCN"]) {
    assert.match(legacyLintCatalogs[locale]["cube.outputModifierRange"], /Cube/, `${locale}:cube-identifier`);
    assert.doesNotMatch(legacyLintCatalogs[locale]["cube.outputModifierRange"], /多維資料集|多维数据集/, `${locale}:not-data-cube`);
  }
});

test("Dynamic Legacy Lint terms resolve in the selected locale instead of injecting English", () => {
  const maximum = legacyMessage("items.valueMaximum", {
    column: "max",
    label: legacyTerm("chargedSkillLevel"),
    value: 80,
    maximum: 63
  });
  assert.match(resolveLegacyMessage(maximum, "koKR"), /충전 스킬 레벨/);
  assert.doesNotMatch(resolveLegacyMessage(maximum, "koKR"), /charged-skill level/);

  const cycle = legacyMessage("misc.chainCycle", {
    id: "A",
    hop: 2,
    hopLabel: legacyTerm("hops"),
    chain: "A -> A"
  });
  assert.match(resolveLegacyMessage(cycle, "koKR"), /2단계/);
  assert.doesNotMatch(resolveLegacyMessage(cycle, "koKR"), /hops/);

  const treasure = legacyMessageText("treasure.unknownReference", {
    className: legacyTerm("treasureClass"),
    value: "bad"
  }, "koKR");
  assert.match(treasure, /보물 등급/);
  assert.doesNotMatch(treasure, /Treasure Class/);

  const fixed4 = legacyMessage("basic.fixed4Unknown", {
    value: "abc␠",
    effective: "abc␠",
    legend: legacyTerm("spaceLegend")
  });
  assert.match(resolveLegacyMessage(fixed4, "koKR"), /공백/);
  assert.doesNotMatch(resolveLegacyMessage(fixed4, "koKR"), /space/);
});

test("Legacy lint rule sources use message descriptors instead of inline user-facing messages", () => {
  for (const path of LINT_SOURCES) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /ctx\.add\([^,\n]+,[^,\n]+,[^,\n]+,\s*(?:`|\")/);
    assert.doesNotMatch(source, /rule\([^\n]*,\s*(?:`|\")[A-Z][^\n]*(?:`|\")/);
  }
});
