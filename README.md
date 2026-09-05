# TXTeditor

TXTeditor is a Windows-focused desktop editor for Diablo II and Diablo II: Resurrected tab-separated `.txt` data files, `animdata.d2`, and supported D2R JSON string files. Built with Tauri v2, it uses a canvas-rendered virtual grid for editing large tables.

## Download

Zip archives for Windows are available from the [GitHub Releases page](https://github.com/yinyin333333/TXTeditor/releases). Extract an archive before running TXTeditor, or run the installer directly.

## Features

### Table Editing

- Edit large Diablo II-style tab-separated tables in a canvas-rendered, virtualized grid.
- Select cells, ranges, rows, or columns with the mouse and keyboard, then copy, cut, or paste tabular data across compatible selections.
- Fill a selection with one value, create incrementing fills, and apply addition, subtraction, multiplication, or division to selected cells.
- Add, insert, clone, clear, hide, unhide, or delete rows and columns.
- Resize rows and columns manually, fit all or selected columns to their contents, or apply Resize To Fit automatically when a file opens.
- Freeze the first row and first column independently; the selected freeze state is remembered between runs.
- Undo and redo supported editing operations within the current document session.
- Add temporary color highlights to cells and remove them without modifying the underlying file data.

### Files, Workspaces, and Navigation

- Open individual `.txt` files, `animdata.d2`, supported D2R JSON string files, or a whole data folder.
- Include or exclude subfolders when opening a workspace.
- Save a single-folder Workspace Profile (`.txtworkspace`) from the sidebar title ⋯ menu and reopen it to restore saved tabs, the active file, and Explorer hidden files.
- Open file paths passed to TXTeditor at startup.
- Work with multiple open documents in tabs and filter files in the Explorer panel.
- Search forward or backward, find all matches, replace one or all matches, limit searches to row or column titles, and jump directly to a displayed row number.
- Use the active-cell input bar for long values while keeping cell diagnostics visible.

### Linting and Diagnostics

- Choose between Vector-LSP and Legacy Lint, with profiles matched to supported game versions.
- Run live and cross-file checks using workspace or sibling data.
- Review errors and warnings in the Problems panel and jump to the affected table cell or JSON range.

### Customization

- Switch between dark and light themes, choose a grid font, and optionally colorize columns.
- Zoom the table grid, optionally remember the last level, or reset to 100%.
- Lock mouse-based row-height and column-width resizing when accidental resizing is undesirable.
- Place the Explorer and Problems panels on the left, right, top, or bottom and reset the layout when needed.
- Customize command and grid-scrolling shortcuts from the Shortcuts window.
- Use the interface in multiple supported locales.

## Workspace Profiles

Open a folder, arrange your tabs, then choose **sidebar title ⋯ → Save Workspace As…**. The profile records the absolute folder path and relative paths for saved documents inside that folder. It stores session layout, not document contents: save edits and untitled documents separately. Files outside the folder are not included.

Hover over a workspace file (or focus it with the keyboard) and use **Hide** to hide it from Explorer. **Show Hidden Files** in the sidebar title ⋯ menu reveals hidden entries; **Restore** restores an entry. Hidden files remain available to both lint engines and can still be opened directly as tabs. Save the profile again after changing tabs or hidden files to capture the new state.

Choose **sidebar title ⋯ → Open Workspace…** after restarting to restore a saved profile. The same menu beside the TXTeditor title is always available, including while another workspace is open. Select a saved `.txtworkspace` file, not its data folder. Profiles can be stored anywhere: the folder recorded inside the profile determines the workspace root. Successfully saved/opened profiles appear under Recent Workspaces with their full paths and can be reopened directly; this list persists between runs. Older profiles must be opened once to add them to the list. Opening a profile or another folder replaces the current session, with Save / Discard / Cancel for unsaved documents. A missing root or invalid profile leaves the current session intact. Missing individual files are reported while the remaining files are restored. Each switch stops the previous Vector-LSP session and clears Legacy Lint jobs, diagnostics, and workspace/sibling caches before activating the new root. The existing include/exclude subfolders preference still applies.

## JSON Editing

Supported D2R string files under `data/local/lng/strings/*.json` open in a [CodeMirror](https://codemirror.net/)-based editor with syntax highlighting, bracket matching, folding, search, and syntax error markers.

JSON files use the same document tabs and save workflow as table files. If an open JSON file changes on disk, TXTeditor asks whether to reload the disk version or keep the editor version.

## AnimData Editing

`animdata.d2` files use the same opening workflows as other supported formats and are presented as editable tables. When saving, TXTeditor validates the record structure and values before atomically replacing the target file.

## Linting

### Lint Engines

Vector-LSP is selected by default on the first run and supports hover, go-to-definition, and optional JSON linting.

Legacy Lint uses TXTeditor's built-in rules and exposes rule and severity settings in the Problems panel.

You can switch engines while TXTeditor is running; only the selected engine provides active diagnostics.

### Lint Profiles

A single game-version selector applies to both lint engines, keeping their rules, schema, and bundled reference data aligned. Legacy Lint uses the `RotW` rule profile for versions `3.1` through `3.3`.

| Game version | Vector-LSP | Legacy Lint | Bundled reference data |
| --- | --- | --- | --- |
| 3.3 | Supported | `RotW` profile | 3.3 |
| 3.2 | Supported | `RotW` profile | 3.2 |
| 3.1 | Supported | `RotW` profile | 3.1 |
| 2.4 | Supported | 2.4 rules | 2.4 |
| 1.13c | Supported | 1.13c rules | 1.13c |

Legacy Lint is based on [d2rlint](https://github.com/eezstreet/d2rlint) behavior and includes version-specific extensions. Results may differ for some data sets or mod variants.

### Reference Data and Cross-File Lint

Cross-file rules use the files included in the active workspace. For an individually opened `.txt` file, sibling tables provide lint context. Versioned bundled data supplies missing tables, but local files take precedence.

### JSON Lint

Vector-LSP can optionally lint supported D2R JSON string files for duplicate IDs or keys, missing required string fields, and unused keys. Enable it through **Lint Options**. Only string files present in the mod are checked; unused-key checks may also consult D2R layout JSON.

## Shortcuts

Use the toolbar **Shortcuts** button to reassign command and grid-scrolling shortcuts or restore defaults. Assigning an occupied key moves it to the new command. Changes take effect only after choosing **Save**.

- `Ctrl+O`, `Ctrl+S`, and `Ctrl+Shift+S`: open, save, and save as
- `Ctrl+F`, `F3` / `Shift+F3`, and `Ctrl+Shift+H`: search from the active cell, find next / previous, and find and replace
- `Ctrl+G`: go to a displayed row number
- `Ctrl+B` / `Ctrl+L`: toggle the Explorer / Problems panel
- `Ctrl+H`: reset all row heights to default
- `Ctrl+Z` and `Ctrl+Y` / `Ctrl+Shift+Z`: undo and redo
- `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, and `Ctrl+A`: copy, cut, paste tabular data, and select all
- `Ctrl+P` / `Ctrl+Shift+P`: open the command palette
- `Ctrl+W` and `Ctrl+Tab` / `Ctrl+Shift+Tab`: close the current tab and move to the next / previous tab
- `Ctrl+Plus`, `Ctrl+Minus`, and `Ctrl+0`: zoom the table grid in, out, or back to 100%
- `PageUp` / `PageDown`, `Home` / `End`, and `Shift+Home` / `Shift+End`: scroll by page, to the top / bottom, or to the left / right edge
- `Enter` / `F2`, `Escape`, and `Tab` / `Shift+Tab`: edit a cell, cancel editing, or move horizontally after editing
- `Enter` / `Shift+Enter` in the Find window: find next / previous

## Build

Requirements:

- Node.js and npm.
- A Rust toolchain.
- The system dependencies listed in the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

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

## Contributing

Development work targets the `next` branch; `main` represents released versions. Create a focused branch from the latest `upstream/next`, then open a pull request against `yinyin333333/TXTeditor:next`.

Example:

```bash
git clone https://github.com/YOUR-NAME/TXTeditor.git
cd TXTeditor
git remote add upstream https://github.com/yinyin333333/TXTeditor.git
git fetch upstream
git switch -c fix/short-description upstream/next

# Make and test your changes.
git push -u origin fix/short-description
```

Keep each pull request focused on one change and describe both the user-visible result and the validation performed. For most changes, run:

```bash
npm test
npm run build:web
```

Changes involving the Tauri/Rust backend should also be checked with the relevant Cargo commands from `src-tauri`. Build outputs, dependencies, temporary files, and local reference material should not be committed.

## Acknowledgements

- [vector-lsp](https://github.com/eezstreet/vector-lsp) by eezstreet: TXTeditor uses a [modified fork](https://github.com/yinyin333333/vector-lsp) for application-specific integration. The original project's attribution and license apply.
- [d2rlint](https://github.com/eezstreet/d2rlint) by eezstreet: TXTeditor's D2R lint behavior and portions of its live diagnostic logic are based on or adapted from d2rlint, which is licensed under GNU GPLv3.
- [CodeMirror](https://codemirror.net/) is used for the JSON editor.
- The table-editing workflows of AFJSheet and D2ExcelPlus influenced parts of TXTeditor's editing UX.

Additional attribution and licensing notes are available in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

TXTeditor is distributed under the GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

TXTeditor includes lint behavior derived from [d2rlint](https://github.com/eezstreet/d2rlint), which is licensed under GNU GPLv3. Related attribution is documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
