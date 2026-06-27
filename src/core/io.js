export { isTauriRuntime } from "./platform/tauri-api.js";
export { decodeBuffer, encodeText } from "./platform/text-codec.js";
export {
  encodedDocumentBytes,
  listenForNativeDrops,
  openFilesNative,
  openNativePaths,
  openNativePathsBulk,
  openWorkspaceNative,
  readFileAsDocument,
  saveDocumentNative,
  saveTextNative
} from "./platform/file-io.js";
export {
  closeWindow,
  getConfig,
  pickFilePath,
  pickFolderPath,
  saveConfig
} from "./platform/config.js";
export {
  lspCloseFile,
  lspDefinition,
  lspGetDiagnostics,
  lspHover,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspStart,
  lspUpdateFile,
  lspUpdateFileIncremental
} from "./platform/lsp-client.js";
export { downloadBytes, downloadText } from "./platform/download.js";
