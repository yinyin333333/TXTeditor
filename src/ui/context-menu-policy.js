export function contextMenuActiveGroupId(group) {
  return group?.dataset?.menuGroup ?? "";
}

export function contextMenuGroupIsActive(candidate, activeGroup) {
  return candidate === activeGroup;
}

export function contextMenuHiddenState() {
  return { contextMenuActiveGroup: "", contextMenuOpen: false };
}

export function contextMenuOpenTransition(open) {
  const contextMenuOpen = Boolean(open);
  return {
    contextMenuOpen,
    hoverSuspended: contextMenuOpen,
    clearVisibleHoverReason: contextMenuOpen ? "context-menu-open" : null
  };
}

export function visibleHoverClearEvent({ reason = "hover-cleared", inFlight = 0 } = {}) {
  return { reason, visibleClear: true, inFlight };
}

export function visibleHoverClearKeepsPendingRequests() {
  return true;
}
