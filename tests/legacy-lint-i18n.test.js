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
  assert.equal(Object.keys(korean).length, 87);
  for (const [key, template] of Object.entries(korean)) {
    assert.equal(template.includes("(은)"), false, key);
    assert.equal(template.includes("(는)"), false, key);
    assert.equal(template.includes("(이)"), false, key);
    assert.equal(template.includes("(가)"), false, key);
    assert.equal(template.includes("(을)"), false, key);
    assert.equal(template.includes("(를)"), false, key);
    if (!new Set(["basic.booleanRawByte", "basic.booleanStandard"]).has(key)) {
      assert.equal(["}은", "}는", "}이", "}가", "}을", "}를", "\"은", "\"는", "\"이", "\"가", "\"을", "\"를"].some((suffix) => template.includes(suffix)), false, key);
    }
  }
  assert.match(korean["items.chargeCap"], /최대 충전 횟수/);
  assert.match(korean["basic.unknownSummode"], /summode/);
  assert.match(korean["basic.booleanRawByte"], /숫자 형식.*끄려면 0.*켜려면 1/);
  assert.match(korean["cube.stopsAfterModifier"], /기본 아이템/);
  assert.match(legacyRuleMetadata("TC/ValidNegativePicks", "koKR").label, /음수 Picks/);
});

test("BooleanFields translations give friendly integer corrections without implementation details", () => {
  const numberFormatTerms = {
    enUS: /number format/,
    zhTW: /數字格式/,
    deDE: /Zahlenformat/,
    esES: /formato numérico/,
    frFR: /format numérique/,
    itIT: /formato numerico/,
    koKR: /숫자 형식/,
    plPL: /formatu liczbowego/,
    esMX: /formato numérico/,
    jaJP: /数値形式/,
    ptBR: /formato numérico/,
    ruRU: /формат числа/,
    zhCN: /数字格式/
  };
  const semanticTerms = {
    enUS: { integer: /signed decimal integer/, correction: /0.*off.*1.*on/, otherValid: /other signed decimal integers remain valid/ },
    zhTW: { integer: /帶符號十進位整數/, correction: /關閉.*0.*開啟.*1/, otherValid: /其他帶符號十進位整數也有效/ },
    deDE: { integer: /vorzeichenbehaftete Dezimal-Ganzzahl/, correction: /0.*Ausschalten.*1.*Einschalten/, otherValid: /andere vorzeichenbehaftete Dezimal-Ganzzahlen bleiben gültig/ },
    esES: { integer: /enteros? decimal(?:es)? con signo/, correction: /0.*desactivar.*1.*activar/, otherValid: /demás enteros decimales con signo siguen siendo válidos/ },
    frFR: { integer: /entiers? décim(?:al|aux) signés?/, correction: /0.*désactiver.*1.*activer/, otherValid: /autres entiers décimaux signés restent valides/ },
    itIT: { integer: /inter[io] decimal[ei] con segno/, correction: /0.*disattivare.*1.*attivare/, otherValid: /altri interi decimali con segno restano validi/ },
    koKR: { integer: /부호 있는 10진 정수/, correction: /끄려면 0.*켜려면 1/, otherValid: /다른 부호 있는 10진 정수도 유효/ },
    plPL: { integer: /dziesiętn(?:ej|ych) liczb(?:y)? całkowit(?:ej|ych) ze znakiem/, correction: /0.*wyłączyć.*1.*włączyć/, otherValid: /inne dziesiętne liczby całkowite ze znakiem pozostają prawidłowe/ },
    esMX: { integer: /enteros? decimal(?:es)? con signo/, correction: /0.*desactivar.*1.*activar/, otherValid: /demás enteros decimales con signo siguen siendo válidos/ },
    jaJP: { integer: /符号付き10進整数/, correction: /オフ.*0.*オン.*1/, otherValid: /ほかの符号付き10進整数も有効/ },
    ptBR: { integer: /inteiros? decima(?:l|is) com sinal/, correction: /0.*desativar.*1.*ativar/, otherValid: /outros inteiros decimais com sinal continuam válidos/i },
    ruRU: { integer: /знакового десятичного целого числа|знаковых десятичных целых чисел/, correction: /0.*выключить.*1.*включить/, otherValid: /другие знаковые десятичные целые числа также допустимы/ },
    zhCN: { integer: /有符号十进制整数/, correction: /关闭.*0.*开启.*1/, otherValid: /其他有符号十进制整数也有效/ }
  };

  assert.equal(legacyLintCatalogs.enUS["basic.booleanRawByte"], "'{value}' is not a number format accepted in this field. Enter 0 to turn it off or 1 to turn it on.");
  assert.equal(legacyLintCatalogs.koKR["basic.booleanRawByte"], "'{value}'는 이 칸에서 사용할 수 있는 숫자 형식이 아닙니다. 끄려면 0, 켜려면 1을 입력하세요.");
  const forbidden = /type-29|raw[- ]byte|low byte|least-significant byte|\bu32\b|bitfield|serializ|storage layout/i;

  for (const locale of LEGACY_LINT_LOCALES) {
    const terms = semanticTerms[locale];
    const general = legacyLintCatalogs[locale]["basic.booleanType29"];
    const rawByte = legacyLintCatalogs[locale]["basic.booleanRawByte"];
    const metadata = legacyRuleMetadata("Basic/BooleanFields", locale).note;

    assert.match(general, numberFormatTerms[locale], `${locale}:general-number-format`);
    assert.match(rawByte, numberFormatTerms[locale], `${locale}:stored-number-format`);
    assert.match(general, terms.correction, `${locale}:general-correction`);
    assert.match(rawByte, terms.correction, `${locale}:stored-correction`);
    assert.match(metadata, terms.integer, `${locale}:integer-metadata`);
    assert.match(metadata, terms.otherValid, `${locale}:other-integers-remain-valid`);
    assert.doesNotMatch(`${general}\n${rawByte}\n${metadata}`, forbidden, `${locale}:implementation-details`);
    assert.doesNotMatch(metadata, /SuperUniques\.Replaceable/i, `${locale}:replaceable-excluded`);
    if (locale !== "enUS") {
      assert.notEqual(general, legacyLintCatalogs.enUS["basic.booleanType29"], `${locale}:translated-general`);
      assert.notEqual(rawByte, legacyLintCatalogs.enUS["basic.booleanRawByte"], `${locale}:translated-raw-byte`);
      assert.notEqual(metadata, legacyRuleMetadata("Basic/BooleanFields", "enUS").note, `${locale}:translated-metadata`);
    }
  }
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
