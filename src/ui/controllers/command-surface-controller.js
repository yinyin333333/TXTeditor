import {
  columnCommandItems,
  fillCommandItems,
  mathCommandItems,
  rowCommandItems
} from "../command-registry.js";
import {
  contextMenuActiveGroupId,
  contextMenuGroupIsActive,
  contextMenuHiddenState,
  contextMenuOpenTransition
} from "../context-menu-policy.js";

export function createCommandSurfaceController({
  state,
  els,
  grid,
  commandLabels,
  runCommand,
  activeDoc,
  rowsForContextOperation,
  cellHasReference,
  clearVisibleLspHover,
  showError,
  escapeHtml
}) {
  function showPalette() {
    hideContextMenu();
    els.palette.classList.remove("hidden");
    els.paletteInput.value = "";
    renderPalette();
    els.paletteInput.focus();
  }

  function renderPalette() {
    const q = els.paletteInput.value.toLowerCase();
    const labels = commandLabels.filter(([, label]) => label.toLowerCase().includes(q));
    els.paletteResults.innerHTML = labels.map(([id, label]) => `<button data-run="${id}">${label}</button>`).join("");
    for (const button of els.paletteResults.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        Promise.resolve(runCommand(button.dataset.run)).catch(showError);
        els.palette.classList.add("hidden");
      });
    }
  }

  function showContextMenu({ x, y, hit }) {
    state.contextHit = hit;
    state.contextMenuActiveGroup = "";
    setContextMenuOpen(true);
    const canUnhide = activeDoc().hiddenRows.size > 0 || activeDoc().hiddenColumns.size > 0;
    const focusRow = hit?.row ?? state.selection.focus.row;
    const focusCol = hit?.column ?? state.selection.focus.column;
    const entries = [
      { type: "submenu", label: "Column Operations", items: columnCommandItems() },
      { type: "submenu", label: "Row Operations", items: rowItems() },
      { id: "resize-fit", label: "Resize To Fit" },
      { id: "resize-selected-fit", label: "Resize Selected To Fit" },
      { id: "unhide-all", label: "Unhide All", disabled: !canUnhide },
      { type: "submenu", label: "Fill", items: fillCommandItems() },
      { type: "submenu", label: "Math", items: mathCommandItems() },
      { id: "go-to-definition", label: "Go To Definition", disabled: !cellHasReference(focusRow, focusCol) },
      { id: "cut", label: "Cut", shortcut: "Ctrl+X" },
      { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
      { id: "paste", label: "Paste", shortcut: "Ctrl+V" }
    ];
    els.contextMenu.innerHTML = entries.map(menuEntry).join("");
    for (const button of els.contextMenu.querySelectorAll("button[data-run]")) {
      button.addEventListener("click", () => {
        Promise.resolve(runCommand(button.dataset.run)).catch(showError);
        hideContextMenu();
      });
    }
    for (const group of els.contextMenu.querySelectorAll(".menu-group")) {
      const activate = () => openContextSubmenu(group);
      group.addEventListener("mouseenter", activate);
      group.querySelector(".submenu-label")?.addEventListener("focus", activate);
      group.querySelector(".submenu-label")?.addEventListener("click", (event) => {
        event.preventDefault();
        activate();
      });
    }
    els.contextMenu.classList.remove("hidden");
    els.contextMenu.dataset.x = String(x);
    els.contextMenu.dataset.y = String(y);
    positionContextMenu();
  }

  function positionContextMenu() {
    if (els.contextMenu.classList.contains("hidden")) return;
    const requestedX = Number(els.contextMenu.dataset.x);
    const requestedY = Number(els.contextMenu.dataset.y);
    const rect = els.contextMenu.getBoundingClientRect();
    const margin = 8;
    const left = requestedX + rect.width + margin > window.innerWidth ? requestedX - rect.width : requestedX;
    const top = requestedY + rect.height + margin > window.innerHeight ? requestedY - rect.height : requestedY;
    els.contextMenu.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
    els.contextMenu.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
    for (const group of els.contextMenu.querySelectorAll(".menu-group.active")) positionSubmenu(group);
  }

  function openContextSubmenu(group) {
    if (!group) return;
    state.contextMenuActiveGroup = contextMenuActiveGroupId(group);
    for (const candidate of els.contextMenu.querySelectorAll(".menu-group")) {
      candidate.classList.toggle("active", contextMenuGroupIsActive(candidate, group));
    }
    positionSubmenu(group);
  }

  function positionSubmenu(group) {
    const submenu = group.querySelector(".submenu");
    if (!submenu) return;
    submenu.style.left = "100%";
    submenu.style.right = "auto";
    submenu.style.top = "0px";
    submenu.dataset.side = "right";
    const groupRect = group.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const margin = 8;
    if (groupRect.right + submenuRect.width + margin > window.innerWidth) {
      submenu.style.left = "auto";
      submenu.style.right = "100%";
      submenu.dataset.side = "left";
    }
    const overflowBottom = groupRect.top + submenuRect.height + margin - window.innerHeight;
    const overflowTop = groupRect.top - Math.max(0, overflowBottom);
    if (overflowBottom > 0) submenu.style.top = `${-overflowBottom}px`;
    if (overflowTop < margin) submenu.style.top = `${Number.parseFloat(submenu.style.top) + (margin - overflowTop)}px`;
  }

  function hideContextMenu() {
    els.contextMenu.classList.add("hidden");
    Object.assign(state, contextMenuHiddenState());
    setContextMenuOpen(false);
    for (const group of els.contextMenu.querySelectorAll(".menu-group.active")) group.classList.remove("active");
  }

  function setContextMenuOpen(open) {
    const transition = contextMenuOpenTransition(open);
    state.contextMenuOpen = transition.contextMenuOpen;
    if (transition.clearVisibleHoverReason) clearVisibleLspHover(transition.clearVisibleHoverReason);
    grid.setHoverSuspended(transition.hoverSuspended);
  }

  function menuButton(item) {
    return `<button data-run="${item.id}" ${item.disabled ? "disabled" : ""}><span>${item.checked ? "[x] " : ""}${item.label}</span><span>${item.shortcut ?? ""}</span></button>`;
  }

  function menuEntry(entry) {
    if (entry.type === "submenu") return submenu(entry.label, entry.items);
    return menuButton(entry);
  }

  function submenu(label, items) {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `<div class="menu-group" data-menu-group="${key}"><button class="submenu-label"><span>${escapeHtml(label)}</span><span class="menu-arrow">></span></button><div class="submenu">${items.map(menuButton).join("")}</div></div>`;
  }

  function rowItems() {
    const cloneDisabled = rowsForContextOperation().filter((row) => row > 0 && row < activeDoc().rowCount).length === 0;
    return rowCommandItems({ cloneDisabled });
  }

  return {
    hideContextMenu,
    positionContextMenu,
    renderPalette,
    setContextMenuOpen,
    showContextMenu,
    showPalette
  };
}
