import { isTauriRuntime } from "../../core/io.js";
import { globalShortcutAction, gridScrollShortcutAction } from "../global-shortcut-policy.js";
import { isTextInputTarget } from "../search-policy.js";

export function createAppEventController({
  state,
  els,
  grid,
  commands,
  documentController,
  hasOpenDocument,
  searchController,
  syncDockLayout,
  wirePaneResizers,
  positionContextMenu,
  updateOverviewRuler,
  renderPalette,
  runCommand,
  switchBottomTab,
  showError,
  hideContextMenu,
  closeTab,
  openFile,
  toggleSidebar,
  toggleProblemsPanel,
  resetRowHeights,
  saveAs,
  saveFile,
  redo,
  undo,
  showPalette,
  copySelection,
  cutSelection,
  pasteSelection
}) {
  function wireEvents() {
    document.addEventListener("click", (event) => {
      const command = event.target.closest("[data-command]")?.dataset.command;
      if (command) Promise.resolve(commands[command]?.()).catch(showError);
      const bottomTab = event.target.closest("[data-bottom-tab]")?.dataset.bottomTab;
      if (bottomTab) switchBottomTab(bottomTab);
      if (!event.target.closest(".context-menu")) hideContextMenu();
    });
    els.closeDialog.addEventListener("click", (event) => {
      documentController.handleCloseDialogClick(event);
    });
    els.tabs.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const tab = event.target.closest("[data-tab]");
      if (tab) closeTab(Number(tab.dataset.tab)).catch(showError);
    });
    document.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener("resize", () => {
      syncDockLayout();
      grid.layout();
      positionContextMenu();
      updateOverviewRuler();
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      if (isTauriRuntime()) return;
      await documentController.openBrowserFiles(event.dataTransfer?.files ?? []);
    });
    els.fileInput.addEventListener("change", async () => {
      await documentController.openBrowserFiles(els.fileInput.files ?? []);
      els.fileInput.value = "";
    });
    wirePaneResizers();
    searchController.wireEvents();
    els.paletteInput.addEventListener("input", renderPalette);
    els.paletteInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = els.paletteResults.querySelector("[data-run]");
        if (first) Promise.resolve(runCommand(first.dataset.run)).catch(showError);
        els.palette.classList.add("hidden");
      }
      if (event.key === "Escape") els.palette.classList.add("hidden");
    });
  }

  function handleGlobalKeydown(event) {
    if (event.defaultPrevented) return;
    const editingCell = els.editor.classList.contains("active");
    if (event.key === "Escape" && !els.contextMenu.classList.contains("hidden")) {
      event.preventDefault();
      hideContextMenu();
      return;
    }
    if (event.key === "Escape" && !els.searchPanel.classList.contains("hidden")) {
      event.preventDefault();
      searchController.closeSearch();
      return;
    }
    if (event.key === "Escape" && !els.palette.classList.contains("hidden")) {
      event.preventDefault();
      els.palette.classList.add("hidden");
      els.host.focus();
      return;
    }
    if (!editingCell && !isGridScrollShortcutBlocked(event.target)) {
      const scrollAction = gridScrollShortcutAction(event);
      if (scrollAction && hasOpenDocument?.()) return runGridScrollShortcutAction(event, scrollAction);
    }
    const shortcutAction = globalShortcutAction(event, { editingCell });
    if (editingCell && !shortcutAction) return;
    if (!editingCell && isTextInputTarget(event.target)) return;
    if (shortcutAction) return runGlobalShortcutAction(event, shortcutAction);
  }

  function isGridScrollShortcutBlocked(target) {
    if (isTextInputTarget(target)) return true;
    const ElementCtor = globalThis.Element;
    if (!ElementCtor || !(target instanceof ElementCtor)) return false;
    return Boolean(target.closest(".modal, .modal-backdrop, .palette"));
  }

  function runGridScrollShortcutAction(event, action) {
    if (action === "scroll-top") return prevent(event, () => grid.scrollToTop());
    if (action === "scroll-bottom") return prevent(event, () => grid.scrollToBottom());
    if (action === "scroll-left") return prevent(event, () => grid.scrollToLeft());
    if (action === "scroll-right") return prevent(event, () => grid.scrollToRight());
    if (action === "scroll-page-up") return prevent(event, () => grid.scrollPageUp());
    if (action === "scroll-page-down") return prevent(event, () => grid.scrollPageDown());
    return undefined;
  }

  function runGlobalShortcutAction(event, action) {
    if (action === "zoom-in") return prevent(event, () => runCommand("zoom-in"));
    if (action === "zoom-out") return prevent(event, () => runCommand("zoom-out"));
    if (action === "zoom-reset") return prevent(event, () => runCommand("zoom-reset"));
    if (action === "open-file") return prevent(event, openFile);
    if (action === "toggle-sidebar") return prevent(event, toggleSidebar);
    if (action === "toggle-problems") return prevent(event, toggleProblemsPanel);
    if (action === "reset-row-heights") return prevent(event, resetRowHeights);
    if (action === "save-as") return prevent(event, saveAs);
    if (action === "save-file") return prevent(event, saveFile);
    if (action === "search") return prevent(event, searchController.showSearch);
    if (action === "redo") return prevent(event, redo);
    if (action === "undo") return prevent(event, undo);
    if (action === "show-palette") return prevent(event, showPalette);
    if (action === "close-tab") return prevent(event, () => closeTab(state.active));
    if (action === "copy") return prevent(event, copySelection);
    if (action === "cut") return prevent(event, cutSelection);
    if (action === "paste") return prevent(event, pasteSelection);
    if (action === "clear-selection") return prevent(event, () => runCommand("clear-selection"));
    return undefined;
  }

  function prevent(event, fn) {
    event.preventDefault();
    Promise.resolve(fn()).catch(showError);
  }

  return { wireEvents };
}
