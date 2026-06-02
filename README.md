# TXTeditor

TXTeditor 0.1 is a modern Windows-focused editor for Diablo II-style tab-separated `.txt` data files. It keeps the original MVP direction: a VS Code-like dark UI, a Canvas-rendered virtual grid, and a testable table core that does not treat the UI as the database.

The project now includes a Tauri v2 desktop scaffold with native dialogs and Rust filesystem commands. The web frontend still runs by itself for fast iteration.


## Shortcuts

- `Ctrl+O`: open file
- `Ctrl+S`: save
- `Ctrl+Shift+S`: save as
- `Ctrl+F`: search
- `Ctrl+B`: toggle Explorer/sidebar
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
