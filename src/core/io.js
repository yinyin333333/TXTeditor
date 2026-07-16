export { isTauriRuntime } from "./platform/tauri-api.js";
export { decodeBuffer, encodeText } from "./platform/text-codec.js";
export {
  listenForNativeDrops,
  listSiblingTextFilesNative,
  listWorkspaceNative,
  openFilesNative,
  pickOpenFilePathsNative,
  openNativePaths,
  openNativePathsBulk,
  openWorkspaceNative,
  readFileAsDocument,
  readTextFilesNative,
  saveDocumentNative,
  saveTextNative,
  startupOpenPathsNative
} from "./platform/file-io.js";
export {
  closeWindow,
  getConfig,
  loadLintReferenceDataset,
  pickFilePath,
  pickFolderPath,
  saveConfig
} from "./platform/config.js";
export {
  lspCloseFile,
  lspDefinition,
  lspGetDiagnostics,
  lspGetDiagnosticsBatch,
  lspHover,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspReadyListen,
  lspStart,
  lspStoppedListen,
  lspUpdateFile,
  lspUpdateFileIncremental,
  lspWatchedFilesListen
} from "./platform/lsp-client.js";
export { downloadText } from "./platform/download.js";
