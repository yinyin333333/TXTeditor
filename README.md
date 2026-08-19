# TXTeditor

TXTeditor is a Windows-focused desktop editor for Diablo II / Diablo II: Resurrected style tab-separated `.txt` data files and supported D2R JSON string files. It is built as a Tauri v2 desktop app with a canvas-rendered virtual grid for editing large tables.

TXTeditor is a personal project. I am not an experienced programmer, and most of the implementation was built with the help of OpenAI Codex. The app may contain bugs, incomplete behavior, or rough edges, but I am sharing it in case it is useful to others.

TXTeditor is not affiliated with, endorsed by, or connected to Blizzard Entertainment.

## Download

Windows builds are available from the [GitHub Releases page](https://github.com/yinyin333333/TXTeditor/releases). Download the archive or installer for the version you want to use, extract it when necessary, and run TXTeditor.

## Features

### Table Editing

- Edit Diablo II-style tab-separated data in a canvas-rendered, virtualized grid designed for large tables.
- Select cells, rectangular ranges, complete rows, or complete columns with the mouse and keyboard.
- Copy, cut, and paste tabular data, including repeating copied data across compatible multi-cell selections.
- Fill a selection with one value, create incrementing fills, and apply addition, subtraction, multiplication, or division to selected cells.
- Add, insert, clone, clear, hide, unhide, or delete rows and columns.
- Resize rows and columns manually, fit all columns or only the selected columns to their contents, or automatically apply Resize To Fit when a file opens.
- Freeze the first row and first column independently; the selected freeze state is remembered between runs.
- Undo and redo supported editing operations within the current document session.
- Add temporary color highlights to cells and remove them without modifying the underlying file data.

### Files, Workspaces, and Navigation

- Open individual `.txt` files, supported D2R JSON string files, or an entire `data/global/excel` style folder.
- Include subfolders in a workspace or exclude them through Settings.
- Open file paths passed to TXTeditor when the desktop app starts.
- Work with multiple open documents in tabs and filter files in the Explorer panel.
- Search forward or backward, find all matches, replace one or all matches, limit searches to row or column titles, and jump directly to a displayed row number.
- Use the active-cell input bar for long values while keeping cell diagnostics visible.
- Detect external changes to open JSON documents and choose whether to reload the disk version or keep the editor version.

### Linting and Diagnostics

- Select either Vector-LSP or Legacy Lint directly from the Problems toolbar.
- Choose one game version for the complete lint session: `3.3`, `3.2`, `3.1`, `2.4`, or `1.13c`.
- Run cross-file rules against the active workspace or the sibling files of an individually opened table, with bundled reference data filling in files that are absent from the mod.
- View live errors, warnings, cell markers, precise expression ranges, and overview-ruler markers.
- Click a diagnostic to open its table cell or JSON range, or copy diagnostic details for bug reports.
- Enable Vector-LSP hover information and go-to-definition navigation for supported references.
- Configure Legacy Lint rules and severities, or configure Vector-LSP and optional localization JSON diagnostics.

### Customization

- Switch between dark and light themes, choose a grid font, and optionally colorize columns.
- Zoom from 10% to 800%, optionally remember the last zoom level, or reset to 100%.
- Lock mouse-based row-height and column-width resizing when accidental resizing is undesirable.
- Place the Explorer and Problems panels on the left, right, top, or bottom and reset the layout when needed.
- Customize command and grid-scrolling shortcuts from the Shortcuts window.
- Use the localized interface available in 13 supported locales.

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

TXTeditor exposes one game-version selector for both lint engines. Selecting a version keeps the active rules, schema, and bundled reference data aligned.

| Game version | Vector-LSP | Legacy Lint | Bundled reference data |
| --- | --- | --- | --- |
| 3.3 | Supported | RotW rules | 3.3 |
| 3.2 | Supported | RotW rules | 3.2 |
| 3.1 | Supported | RotW rules | 3.1 |
| 2.4 | Supported | 2.4 rules | 2.4 |
| 1.13c | Supported | 1.13c rules | 1.13c |

The Legacy Lint rules are based on the behavior of [d2rlint](https://github.com/eezstreet/d2rlint), the original D2R linting tool made by eezstreet. Version-specific behavior has since been extended inside TXTeditor.

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

## Contributing

Development work is integrated through the `next` branch. `main` represents released versions and receives changes from `next` when a release is prepared.

1. Fork the repository and clone your fork.
2. Add this repository as `upstream` if needed.
3. Fetch the latest `next` branch and create a focused work branch from it.
4. Make and test your changes on that work branch.
5. Push the work branch to your fork and open a pull request targeting `yinyin333333/TXTeditor:next`.

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
