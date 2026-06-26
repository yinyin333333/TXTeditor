export function syncDockChildren(dock, children) {
  const nextChildren = Array.from(children ?? []);
  const current = Array.from(dock.children ?? []);
  if (current.length === nextChildren.length && current.every((child, index) => child === nextChildren[index])) {
    return false;
  }
  dock.replaceChildren(...nextChildren);
  return true;
}
