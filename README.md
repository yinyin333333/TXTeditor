# TXTeditor

TXTeditor 0.4.3 is a Windows-focused desktop editor for Diablo II / Diablo II: Resurrected style tab-separated `.txt` data files. It is built as a Tauri v2 desktop app with a canvas-rendered virtual grid for editing large tables.

TXTeditor is a personal project. I am not an experienced programmer, and most of the implementation was built with the help of OpenAI Codex. The app may contain bugs, incomplete behavior, or rough edges, but I am sharing it in case it is useful to others.

TXTeditor is not affiliated with, endorsed by, or connected to Blizzard Entertainment.

## Features

- Open single `.txt` files.
- Open a D2R `data/global/excel` style folder or workspace.
- Edit tab-separated data in a grid interface.
- Canvas virtualization for large files.
- Frozen first row and first column.
- Zoom, search, undo, and redo.
- Copy, cut, paste, fill, and simple arithmetic operations on selections.
- Hide and unhide rows or columns.
- D2R-aware linting in the live Problems panel.
- Select either Vector-LSP or Legacy Lint as the active lint engine.
- Click a diagnostic to jump to the matching file, row, column, and cell.
- RotW and 2.4 lint profile toggle.

## Lint Profiles

TXTeditor includes RotW and 2.4 lint profiles. These rules are based on the behavior of [d2rlint](https://github.com/eezstreet/d2rlint), the original D2R linting tool made by eezstreet, and are integrated into TXTeditor's live Problems panel.

The RotW-oriented lint behavior has been checked against the project's current d2rlint-compatible fixture/oracle workflow. Other data sets, mod variants, or future rule changes may still expose bugs or differences.

## Lint Engines

Version 0.4.1 adds a lint engine selector in Settings.

Vector-LSP is the default engine for first-time runs and keeps the 0.4 behavior: bundled Vector-LSP diagnostics, Vector-LSP hover, Lint Options, and Problems panel integration.

Legacy Lint restores the earlier built-in lint path from TXTeditor 0.33. In Legacy Lint mode, the Problems panel shows the RotW / 2.4 profile selector and Rules panel, and diagnostics are produced by TXTeditor's built-in legacy lint engine instead of Vector-LSP.

You can switch between Vector-LSP and Legacy Lint while TXTeditor is running. Only the selected engine updates the active diagnostics, cell markers, overview-ruler marks, and Problems panel. Switching back to Vector-LSP resyncs open files with Vector-LSP and restores the stored Vector-LSP Hover preference.

Version 0.4.1 integrates [vector-lsp](https://github.com/eezstreet/vector-lsp) created by eezstreet while allowing users to choose Vector-LSP or Legacy Lint as the active lint engine.

## Build

Requirements:

- Node.js and npm.
- Rust.
- The normal Tauri prerequisites for your platform.

Install dependencies:

```bash
npm install
```

Build the desktop app:

```bash
npm run tauri -- build
```

Useful development commands:

```bash
npm run dev
npm run tauri -- dev
npm test
```

## Shortcuts

- `Ctrl+O`: open file
- `Ctrl+S`: save
- `Ctrl+Shift+S`: save as
- `Ctrl+F`: search
- `Ctrl+B`: toggle Explorer panel
- `Ctrl+L`: toggle Problems panel
- `Ctrl+H`: reset all row heights to default
- `Ctrl+Z`: undo
- `Ctrl+Y` / `Ctrl+Shift+Z`: redo
- `Ctrl+C`: copy selection
- `Ctrl+X`: cut selection
- `Ctrl+V`: paste tabular data
- `Ctrl+A`: select all
- `Ctrl+P` / `Ctrl+Shift+P`: command palette
- `Ctrl+W`: close current tab
- `Ctrl+Plus`: zoom in
- `Ctrl+Minus`: zoom out
- `Ctrl+0`: reset zoom
- `Enter` / `F2`: edit cell
- `Escape`: cancel edit
- `Tab` / `Shift+Tab`: move horizontally after edit

## Acknowledgements

AFJSheet: I used AFJSheet for a long time and learned a lot from its workflow as a Diablo II table editor. TXTeditor is a separate personal project, but AFJSheet strongly influenced what I wanted from a practical TXT editing tool.

D2ExcelPlus: I also used D2ExcelPlus and found it to be an excellent and very stable tool. I personally ported and used it in my own workflow, and that experience was one of the reasons I wanted to make a small editor of my own with OpenAI Codex. Some context-menu and editing UX ideas in TXTeditor were inspired by the experience of using tools such as D2ExcelPlus and AFJSheet.

[d2rlint](https://github.com/eezstreet/d2rlint) by eezstreet: d2rlint is the original D2R linting tool made by eezstreet. TXTeditor's D2R lint behavior is based on d2rlint's behavior, and portions of the lint logic have been ported or adapted for TXTeditor's live editor diagnostics.

OpenAI Codex: Most implementation work was done through collaboration with OpenAI Codex.

## License

TXTeditor is distributed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

This project uses and adapts lint behavior from [d2rlint](https://github.com/eezstreet/d2rlint), the original D2R linting tool made by eezstreet and licensed under GNU GPLv3. The GPL license is included to respect those terms and to keep TXTeditor's source available under compatible open-source terms.

TXTeditor is also inspired by the workflows of AFJSheet and D2ExcelPlus. Those projects are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
