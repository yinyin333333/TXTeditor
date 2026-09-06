// Scroll only the tab strip; scrolling an ancestor can move the editor or toolbar.
export function revealActiveDocumentTab(tabs) {
  const active = tabs?.querySelector("button.active[data-tab]");
  if (!active || !tabs.clientWidth) return;
  const viewport = tabs.getBoundingClientRect();
  const tab = active.getBoundingClientRect();
  // Keep a small inset for borders and fractional scroll rounding at browser zoom.
  const inset = Math.min(6, tabs.clientWidth / 4);
  const left = viewport.left + tabs.clientLeft + inset;
  const right = viewport.left + tabs.clientLeft + tabs.clientWidth - inset;
  if (tab.left < left || tab.width > right - left) {
    tabs.scrollLeft += Math.floor(tab.left - left);
  } else if (tab.right > right) {
    tabs.scrollLeft += Math.ceil(tab.right - right);
  }
}
