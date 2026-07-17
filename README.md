# TXTeditor

TXTeditor is a Windows-focused desktop editor for Diablo II / Diablo II: Resurrected style tab-separated `.txt` data files and supported D2R JSON string files. It is built as a Tauri v2 desktop app with a canvas-rendered virtual grid for editing large tables.

TXTeditor is a personal project. I am not an experienced programmer, and most of the implementation was built with the help of OpenAI Codex. The app may contain bugs, incomplete behavior, or rough edges, but I am sharing it in case it is useful to others.

TXTeditor is not affiliated with, endorsed by, or connected to Blizzard Entertainment.

## Features

- Open individual `.txt` files and supported D2R JSON string files.
- Open a D2R `data/global/excel` style folder or workspace, including subfolders when desired.
- Open file paths passed to TXTeditor when the desktop app starts.
- Edit tab-separated data in a grid interface.
- Edit `data/local/lng/strings/*.json` localization files in a dedicated JSON code editor.
- Canvas virtualization for large files.
- Independently freeze the first row and first column; the selected state is remembered between runs.
- Grid zoom, forward and backward search, undo, and redo.
- Copy, cut, paste, fill, and simple arithmetic operations on selections, including filling a multi-cell selection by pasting one value.
- Hide and unhide rows or columns.
- Optionally lock mouse-based row-height and column-width resizing.
- D2R-aware linting in the live Problems panel.
- Select either Vector-LSP or Legacy Lint as the active lint engine.
- Run cross-file lint rules against the active workspace or the sibling files of an individually opened table.
- Optionally lint supported D2R JSON string files with Vector-LSP.
- Click a diagnostic to jump to the matching table cell or JSON range.
- Configure versioned schema and bundled reference data, or use RotW and 2.4 profiles with Legacy Lint.

## JSON Editing

TXTeditor includes a dedicated JSON code editor based on [CodeMirror](https://codemirror.net/). It currently supports D2R string files under `data/local/lng/strings/*.json`, with JSON syntax highlighting, bracket matching, folding, search, and syntax markers.

JSON files use the same document tab and save workflow as table files. If an open JSON file changes on disk, TXTeditor asks whether to reload the disk version or keep the editor version.

## Linting

Lint results appear in the live Problems panel. Selecting a diagnostic opens the matching table cell or JSON range.

### Lint Engines

Vector-LSP is the default engine for first-time runs. It provides bundled Vector-LSP diagnostics, Vector-LSP hover, Lint Options, JSON lint support, and Problems panel integration.

Legacy Lint uses TXTeditor's built-in lint path. In Legacy Lint mode, diagnostics are produced by TXTeditor instead of Vector-LSP, and the Problems panel provides the profile selector and Rules panel.

You can switch between Vector-LSP and Legacy Lint while TXTeditor is running. Only the selected engine updates the active diagnostics, cell markers, overview-ruler marks, and Problems panel. Switching back to Vector-LSP resyncs open files with Vector-LSP and restores the stored Vector-LSP Hover preference.

TXTeditor uses a [modified fork of vector-lsp](https://github.com/yinyin333333/vector-lsp) that includes application-specific integration changes. This fork is derived from the [original vector-lsp](https://github.com/eezstreet/vector-lsp) created by eezstreet and remains subject to the original project's attribution and license.

### Lint Profiles

Legacy Lint includes RotW and 2.4 profiles. These rules are based on the behavior of [d2rlint](https://github.com/eezstreet/d2rlint), the original D2R linting tool made by eezstreet.

The RotW-oriented lint behavior has been checked against the project's current d2rlint-compatible fixture/oracle workflow. Other data sets, mod variants, or future rule changes may still expose bugs or differences.

### Reference Data and Cross-File Lint

Cross-file rules use the files in the active workspace. For a separately opened `.txt` file, sibling tables in the same folder provide its lint context. Folder workspaces include subfolders by default; **Exclude subfolders when opening a folder** in Settings limits the session to the selected folder itself.

Versioned bundled reference data can supply tables that are absent from the current mod. A local workspace, sibling, or explicitly opened table takes precedence over the bundled fallback, so diagnostics follow the files being edited. One selected reference version is used for the whole lint session.

### JSON Lint

Vector-LSP can lint the supported D2R JSON string files. JSON lint is disabled by default and can be enabled through **Lint Options**. Individual rules can check duplicate IDs or keys, required string fields, and unused string keys. The unused-key rule also has a configurable lower ID threshold.

Only JSON files present in the mod are checked. D2R layout JSON is used as evidence when checking whether string keys are used, but layout files are not opened as editable string documents.

Malformed JSON is reported as a syntax problem. When semantic results from the last successful parse are still relevant, a syntax error does not make those existing findings appear resolved merely because the current document cannot be parsed.

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

The toolbar **Shortcuts** button lets you replace command and grid-scrolling shortcuts or restore each shortcut to its default. Assigning an occupied key moves it to the new command and removes it from the previous command. Changes are applied only after choosing **Save** in the shortcut window; **Cancel** discards them.

- `Ctrl+O`: open file
- `Ctrl+S`: save
- `Ctrl+Shift+S`: save as
- `Ctrl+F`: search from the active cell
- `F3` / `Shift+F3`: find next / previous
- `Ctrl+Shift+H`: find and replace
- `Ctrl+G`: go to a displayed row number
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
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: move to the next / previous open tab
- `Ctrl+Plus`: zoom in on the table grid
- `Ctrl+Minus`: zoom out on the table grid
- `Ctrl+0`: reset table-grid zoom
- `PageUp` / `PageDown`: scroll one grid page vertically
- `Home` / `End`: scroll to the top or bottom of the grid
- `Shift+Home` / `Shift+End`: scroll to the left or right edge of the grid
- `Enter` / `F2`: edit cell
- `Escape`: cancel edit
- `Tab` / `Shift+Tab`: move horizontally after edit
- `Enter` / `Shift+Enter` in the Find window: find next / previous

## Acknowledgements

AFJSheet: I used AFJSheet for a long time and learned a lot from its workflow as a Diablo II table editor. TXTeditor is a separate personal project, but AFJSheet strongly influenced what I wanted from a practical TXT editing tool.

D2ExcelPlus: I also used D2ExcelPlus and found it to be an excellent and very stable tool. I personally ported and used it in my own workflow, and that experience was one of the reasons I wanted to make a small editor of my own with OpenAI Codex. Some context-menu and editing UX ideas in TXTeditor were inspired by the experience of using tools such as D2ExcelPlus and AFJSheet.

[d2rlint](https://github.com/eezstreet/d2rlint) by eezstreet: d2rlint is the original D2R linting tool made by eezstreet. TXTeditor's D2R lint behavior is based on d2rlint's behavior, and portions of the lint logic have been ported or adapted for TXTeditor's live editor diagnostics.

OpenAI Codex: Most implementation work was done through collaboration with OpenAI Codex.

## License

TXTeditor is distributed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

This project uses and adapts lint behavior from [d2rlint](https://github.com/eezstreet/d2rlint), the original D2R linting tool made by eezstreet and licensed under GNU GPLv3. The GPL license is included to respect those terms and to keep TXTeditor's source available under compatible open-source terms.

TXTeditor is also inspired by the workflows of AFJSheet and D2ExcelPlus. Those projects are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
