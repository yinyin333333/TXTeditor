let modulePromise = null;

export function loadJsonEditorModule(importer = defaultImporter) {
  if (!modulePromise) modulePromise = Promise.resolve().then(importer);
  return modulePromise;
}

export function resetJsonEditorModuleLoaderForTests() {
  modulePromise = null;
}

function defaultImporter() {
  return import("../../generated/codemirror-json-editor.js");
}
