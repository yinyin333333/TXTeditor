import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  undo
} from "@codemirror/commands";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap
} from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { lintGutter, linter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";

const setDiagnosticHighlight = StateEffect.define();
const diagnosticHighlightField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setDiagnosticHighlight)) continue;
      if (!effect.value) return Decoration.none;
      const { start, end } = effect.value;
      const markEnd = Math.min(transaction.newDoc.length, Math.max(start + 1, end));
      next = markEnd > start
        ? Decoration.set([
            Decoration.mark({ class: "cm-diagnostic-focus" }).range(start, markEnd)
          ])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--json-property)" },
  { tag: tags.string, color: "var(--json-string)" },
  { tag: tags.number, color: "var(--json-number)" },
  { tag: [tags.bool, tags.null], color: "var(--json-literal)" },
  { tag: tags.invalid, color: "var(--danger-text)", textDecoration: "underline wavy" },
  { tag: tags.punctuation, color: "var(--json-punctuation)" }
]);

function jsonPanelFromEvent(view, target) {
  const ElementCtor = view.win.Element;
  if (!ElementCtor || !(target instanceof ElementCtor)) return null;
  const panel = target.closest(".cm-panel");
  return panel && view.dom.contains(panel) ? panel : null;
}

function isJsonSearchPanel(panel) {
  return panel.classList.contains("cm-search");
}

function isJsonGotoLinePanel(panel) {
  return panel.classList.contains("cm-dialog")
    && Boolean(panel.querySelector("input[name='line']"));
}

function isRepeatedJsonPanelShortcut(event, panel) {
  const key = String(event.key ?? "").toLowerCase();
  if (isJsonSearchPanel(panel)) {
    return key === "f"
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && !event.shiftKey;
  }
  return isJsonGotoLinePanel(panel)
    && key === "g"
    && event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.shiftKey;
}

function handleJsonPanelKeydown(view, event) {
  const panel = jsonPanelFromEvent(view, event.target);
  if (!panel || (!isJsonSearchPanel(panel) && !isJsonGotoLinePanel(panel))) return;
  if (event.key !== "Escape" && !isRepeatedJsonPanelShortcut(event, panel)) return;

  if (isJsonSearchPanel(panel)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSearchPanel(view);
    view.focus();
    return;
  }

  const closeButton = panel.querySelector(".cm-dialog-close");
  if (!closeButton) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeButton.click();
  view.focus();
}

const jsonPanelKeyboard = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.handleKeydown = (event) => handleJsonPanelKeydown(view, event);
    view.dom.addEventListener("keydown", this.handleKeydown, true);
  }

  destroy() {
    this.view.dom.removeEventListener("keydown", this.handleKeydown, true);
  }
});

function focusOpenJsonGotoLine(view) {
  const input = view.dom.querySelector(".cm-dialog input[name='line']");
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

function openJsonGotoLine(view) {
  if (focusOpenJsonGotoLine(view)) return true;
  const opened = gotoLine(view);
  focusOpenJsonGotoLine(view);
  return opened;
}

const txteditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text)",
    backgroundColor: "var(--editor-bg, var(--panel))",
    fontFamily: "var(--grid-font)",
    fontSize: "13px"
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-scroller, .cm-content, .cm-gutters": { fontFamily: "var(--grid-font)" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0 40px", lineHeight: "1.55" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    borderRight: "1px solid var(--border)"
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 9%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent) !important"
  },
  ".cm-panels": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    fontFamily: '"Segoe UI", Arial, sans-serif',
    fontSize: "13px"
  },
  ".cm-panel.cm-search, .cm-panel.cm-dialog": {
    padding: "6px 36px 6px 8px",
    lineHeight: "1.5"
  },
  ".cm-panel label": {
    fontSize: "13px"
  },
  ".cm-panel .cm-textfield": {
    boxSizing: "border-box",
    height: "28px",
    padding: "0 8px",
    backgroundColor: "var(--input-bg, var(--surface))",
    color: "var(--text)",
    border: "1px solid var(--button-border)",
    borderRadius: "4px",
    fontFamily: "inherit",
    fontSize: "13px"
  },
  ".cm-panel button": {
    boxSizing: "border-box",
    minHeight: "28px",
    padding: "0 8px",
    backgroundColor: "var(--button-bg)",
    backgroundImage: "none",
    color: "var(--text)",
    border: "1px solid var(--button-border)",
    borderRadius: "4px",
    fontFamily: "inherit",
    fontSize: "13px"
  },
  ".cm-panel button:hover": { backgroundColor: "var(--hover)" },
  ".cm-panel button[name='close'], .cm-panel .cm-dialog-close": {
    width: "28px",
    minWidth: "28px",
    padding: "0",
    backgroundColor: "transparent",
    borderColor: "transparent"
  },
  ".cm-panel button[name='close']:hover, .cm-panel .cm-dialog-close:hover": {
    backgroundColor: "var(--hover)",
    borderColor: "var(--button-border)"
  },
  ".cm-tooltip": { backgroundColor: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" },
  ".cm-diagnostic-focus": {
    backgroundColor: "var(--json-diagnostic-focus)",
    outline: "1px solid var(--json-diagnostic-focus-border)",
    borderRadius: "2px"
  }
});

export function createJsonEditorState({ text = "", lineSeparator = "\n", onChange = () => {} } = {}) {
  const outputLineSeparator = ["\n", "\r\n", "\r"].includes(lineSeparator)
    ? lineSeparator
    : "\n";
  return EditorState.create({
    doc: String(text),
    extensions: [
      EditorState.lineSeparator.of(outputLineSeparator),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      diagnosticHighlightField,
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      syntaxHighlighting(jsonHighlightStyle),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      json(),
      linter(jsonParseLinter()),
      lintGutter(),
      EditorView.lineWrapping,
      jsonPanelKeyboard,
      keymap.of([
        { key: "Ctrl-g", run: openJsonGotoLine },
        { key: "Mod-Alt-g", run: openJsonGotoLine },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString(), update.state, {
            changes: lspChangesFromUpdate(update)
          });
        }
      }),
      txteditorTheme
    ]
  });
}

export function createJsonEditorView({ parent, state }) {
  return new EditorView({ parent, state });
}

export function selectAndReveal(view, { start, end = start } = {}) {
  const max = view.state.doc.length;
  const anchor = Math.max(0, Math.min(max, Number(start) || 0));
  const head = Math.max(anchor, Math.min(max, Number(end) || anchor));
  view.dispatch({
    selection: { anchor, head },
    effects: [
      setDiagnosticHighlight.of({ start: anchor, end: head }),
      EditorView.scrollIntoView(anchor, { y: "center" })
    ]
  });
  view.focus();
}

export function clearDiagnosticHighlight(view) {
  view?.dispatch({ effects: setDiagnosticHighlight.of(null) });
}

export function refreshJsonEditorAppearance(view) {
  view?.requestMeasure();
}

export function focusJsonEditor(view) {
  view?.focus();
}

export function undoJsonEditor(view) {
  return Boolean(view && undo(view));
}

export function redoJsonEditor(view) {
  return Boolean(view && redo(view));
}

export function openJsonSearch(view) {
  return Boolean(view && openSearchPanel(view));
}

export function openJsonReplace(view) {
  if (!view) return false;
  const opened = openSearchPanel(view);
  const replaceInput = view.dom.querySelector(".cm-search input[name='replace']");
  replaceInput?.focus();
  replaceInput?.select();
  return Boolean(opened);
}

export function findNextJson(view) {
  return Boolean(view && findNext(view));
}

export function findPreviousJson(view) {
  return Boolean(view && findPrevious(view));
}

export function selectAllJson(view) {
  return Boolean(view && selectAll(view));
}

function lspChangesFromUpdate(update) {
  const changes = [];
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      range: {
        start: lspPositionAt(update.startState.doc, fromA),
        end: lspPositionAt(update.startState.doc, toA)
      },
      text: inserted.toString()
    });
  });
  return changes;
}

function lspPositionAt(doc, offset) {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}
