export class SelectionModel {
  constructor() {
    this.anchor = { row: 0, column: 0 };
    this.focus = { row: 0, column: 0 };
  }

  set(row, column) {
    this.anchor = { row, column };
    this.focus = { row, column };
  }

  extend(row, column) {
    this.focus = { row, column };
  }

  get rect() {
    return {
      top: Math.min(this.anchor.row, this.focus.row),
      left: Math.min(this.anchor.column, this.focus.column),
      bottom: Math.max(this.anchor.row, this.focus.row),
      right: Math.max(this.anchor.column, this.focus.column)
    };
  }

  contains(row, column) {
    const r = this.rect;
    return row >= r.top && row <= r.bottom && column >= r.left && column <= r.right;
  }

  selectAll(rowCount, columnCount) {
    this.anchor = { row: 0, column: 0 };
    this.focus = { row: Math.max(0, rowCount - 1), column: Math.max(0, columnCount - 1) };
  }
}
