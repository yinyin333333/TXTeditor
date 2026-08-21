export { isTauriRuntime } from "./platform/tauri-api.js";
export { decodeBuffer, encodeText } from "./platform/text-codec.js";
export {
  listenForNativeOpenPaths,
  listSiblingTextFilesNative,
  listWorkspaceNative,
  openFilesNative,
  pickOpenFilePathsNative,
  pickSaveFilePathNative,
  openNativePaths,
  openNativePathsBulk,
  openWorkspaceNative,
  readFileAsDocument,
  readTextFilesNative,
  saveDocumentNative,
  saveTextNative,
  startupOpenPathsNative,
  takePendingOpenPathsNative,
  writeMergeOutputNative
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
  lspFieldMetadata,
  lspGetDiagnostics,
  lspGetDiagnosticsBatch,
  lspHover,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspReadyListen,
  lspReserveGeneration,
  lspStart,
  lspStop,
  lspStoppedListen,
  lspUpdateFile,
  lspUpdateFileIncremental,
  lspWatchedFilesListen
} from "./platform/lsp-client.js";
export { downloadText } from "./platform/download.js";
