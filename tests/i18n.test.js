import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  catalogs,
  catalogValidation,
  normalizeLocale,
  readLocale,
  saveLocale,
  setLocale,
  t,
  tText,
  localizedMessage,
  resolveLocalizedMessage,
  validateCatalogs
} from "../src/core/i18n.js";
import { createLocaleController } from "../src/ui/controllers/locale-controller.js";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test("i18n supports the complete locale contract and falls back to enUS", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["enUS", "zhTW", "deDE", "esES", "frFR", "itIT", "koKR", "plPL", "esMX", "jaJP", "ptBR", "ruRU", "zhCN"]);
  assert.equal(DEFAULT_LOCALE, "enUS");
  assert.equal(normalizeLocale("ko-KR"), "koKR");
  assert.equal(normalizeLocale("not-a-locale"), "enUS");
  assert.deepEqual(catalogValidation, { keys: Object.keys(catalogs.enUS).length, locales: 13 });
  assert.doesNotThrow(() => validateCatalogs());
  assert.notDeepEqual(catalogs.koKR, catalogs.enUS);
  assert.notDeepEqual(catalogs.zhCN, catalogs.enUS);
});

test("i18n persists locale and escapes named parameters without changing source values", () => {
  const memory = storage({ [LOCALE_STORAGE_KEY]: "bad" });
  assert.equal(readLocale(memory), "enUS");
  assert.equal(saveLocale("zhCN", memory), "zhCN");
  assert.equal(readLocale(memory), "zhCN");
  assert.equal(t("lint.lintingProfile", { profile: "<calc&itemtype>" }, "koKR"), "&lt;calc&amp;itemtype&gt; 검사 중...");
  assert.equal(t("lint.lintingProfile", { profile: "gem" }, "zhCN").includes("gem"), true);
});

test("command, prompt, search, and shortcut catalogs do not silently copy English UI text", () => {
  const productKeys = Object.keys(catalogs.enUS).filter((key) => /^(command|prompt|search|shortcut)\./.test(key)
    && key !== "search.cellStatus");
  for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "enUS")) {
    for (const key of productKeys) {
      assert.notEqual(catalogs[locale][key], catalogs.enUS[key], `${locale}:${key} must be localized`);
    }
  }
});

test("locale catalogs only retain deliberate product, protocol, or universal UI tokens", () => {
  const allowedEnglishCopies = new Set([
    "app.title",
    "settings.vectorEngine",
    "search.cellStatus",
    "common.ok"
  ]);
  for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "enUS")) {
    for (const [key, english] of Object.entries(catalogs.enUS)) {
      if (allowedEnglishCopies.has(key)) continue;
      assert.notEqual(catalogs[locale][key], english, `${locale}:${key} must not duplicate English`);
    }
  }
});

test("locale changes re-run Legacy lint and force a Vector-LSP restart without editing documents", async () => {
  const memory = storage();
  const ownerDocument = { documentElement: {}, querySelectorAll: () => [], querySelector: () => null };
  const calls = [];
  const state = {
    locale: "enUS",
    lsp: { started: true, workspacePath: "E:\\Workspace", contextMode: "workspace", referenceRootPath: "", includeSubfolders: true }
  };
  const controller = createLocaleController({
    state,
    storage: memory,
    ownerDocument,
    legacyActive: () => false,
    scheduleLegacyLintFull: (...args) => calls.push(["legacy", ...args]),
    lspController: {
      invalidateHover: (...args) => calls.push(["hover", ...args]),
      startWorkspace: async (...args) => calls.push(["start", ...args]),
      ensureStandaloneSession: async (...args) => calls.push(["standalone", ...args])
    },
    activeDoc: () => ({ name: "items.txt" }),
    setLintDiagnostics: (diagnostics) => calls.push(["diagnostics", diagnostics]),
    updateGridDiagnostics: () => calls.push(["grid"]),
    renderChrome: () => calls.push(["render"]),
    refreshJsonEditorLocale: () => calls.push(["json-editor-locale"])
  });

  await controller.setLocale("zhCN");
  assert.equal(state.locale, "zhCN");
  assert.equal(ownerDocument.documentElement.lang, "zh-CN");
  assert.equal(readLocale(memory), "zhCN");
  assert.deepEqual(calls.find(([kind]) => kind === "start"), ["start", "E:\\Workspace", {
    forceRestart: true,
    contextMode: "workspace",
    referenceRootPath: "",
    includeSubfolders: true
  }]);
  assert.equal(calls.some(([kind]) => kind === "legacy"), false);
  assert.equal(calls.some(([kind]) => kind === "json-editor-locale"), true);

  const legacyCalls = [];
  const legacy = createLocaleController({
    state: { locale: "enUS", lsp: {} }, storage: memory, ownerDocument,
    legacyActive: () => true,
    scheduleLegacyLintFull: (...args) => legacyCalls.push(args),
    lspController: {}, activeDoc: () => null,
    setLintDiagnostics: () => {}, updateGridDiagnostics: () => {}, renderChrome: () => {}
  });
  await legacy.setLocale("koKR");
  assert.deepEqual(legacyCalls, [["locale-changed", 0]]);
  setLocale("enUS", { storage: memory });
});

test("Legacy lint messages use stable keys while keeping original column names intact", () => {
  const params = { column: "unexpected<calc>" };
  assert.equal(tText("legacy.nonStandardColumn", params, "koKR"), "비표준 열 \"unexpected<calc>\"을(를) 찾았습니다.");
  assert.equal(tText("legacy.nonStandardColumn", params, "zhCN"), "发现非标准列 \"unexpected<calc>\"。");
  assert.equal(t("legacy.nonStandardColumn", params, "koKR").includes("unexpected&lt;calc&gt;"), true);
});

test("localized diagnostic descriptors keep stable keys and named source values", () => {
  const descriptor = localizedMessage("legacy.referenceNotFound", {
    field: "calc",
    value: "<itemtype>",
    label: "rune"
  });
  assert.equal(descriptor.key, "legacy.referenceNotFound");
  assert.deepEqual(descriptor.params, { field: "calc", value: "<itemtype>", label: "rune" });
  assert.equal(resolveLocalizedMessage(descriptor, "koKR").includes("<itemtype>"), true);
  assert.equal(t("legacy.referenceNotFound", descriptor.params, "koKR").includes("&lt;itemtype&gt;"), true);
});
