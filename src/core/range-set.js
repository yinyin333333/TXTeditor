export class RangeSet {
  constructor(values = []) {
    this.ranges = [];
    if (values instanceof RangeSet) {
      this.ranges = values.ranges.map((range) => [...range]);
    } else if (Array.isArray(values?.ranges)) {
      this.addRanges(values.ranges);
    } else if (isRangeList(values)) {
      this.addRanges(values);
    } else {
      this.addValues(values);
    }
  }

  static from(value) {
    return value instanceof RangeSet ? new RangeSet(value) : new RangeSet(value ?? []);
  }

  static fromRanges(ranges) {
    return new RangeSet().addRanges(ranges);
  }

  get size() {
    return this.ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
  }

  get rangeCount() {
    return this.ranges.length;
  }

  has(value) {
    const target = normalizeIndex(value);
    if (target == null) return false;
    const index = rangeIndexFor(this.ranges, target);
    return index >= 0;
  }

  add(value) {
    const target = normalizeIndex(value);
    if (target == null) return this;
    return this.addRange(target, target);
  }

  delete(value) {
    const target = normalizeIndex(value);
    if (target == null) return false;
    return this.deleteRange(target, target);
  }

  clear() {
    this.ranges = [];
  }

  addValues(values) {
    for (const value of values ?? []) this.add(value);
    return this;
  }

  addRanges(ranges) {
    for (const range of ranges ?? []) this.addRange(range[0], range[1]);
    return this;
  }

  addRange(start, end = start) {
    const range = normalizeRange(start, end);
    if (!range) return this;
    let [nextStart, nextEnd] = range;
    const next = [];
    let inserted = false;
    for (const [currentStart, currentEnd] of this.ranges) {
      if (currentEnd + 1 < nextStart) {
        next.push([currentStart, currentEnd]);
      } else if (nextEnd + 1 < currentStart) {
        if (!inserted) {
          next.push([nextStart, nextEnd]);
          inserted = true;
        }
        next.push([currentStart, currentEnd]);
      } else {
        nextStart = Math.min(nextStart, currentStart);
        nextEnd = Math.max(nextEnd, currentEnd);
      }
    }
    if (!inserted) next.push([nextStart, nextEnd]);
    this.ranges = next;
    return this;
  }

  deleteRange(start, end = start) {
    const range = normalizeRange(start, end);
    if (!range) return false;
    const [removeStart, removeEnd] = range;
    let changed = false;
    const next = [];
    for (const [currentStart, currentEnd] of this.ranges) {
      if (currentEnd < removeStart || currentStart > removeEnd) {
        next.push([currentStart, currentEnd]);
        continue;
      }
      changed = true;
      if (currentStart < removeStart) next.push([currentStart, removeStart - 1]);
      if (currentEnd > removeEnd) next.push([removeEnd + 1, currentEnd]);
    }
    if (changed) this.ranges = next;
    return changed;
  }

  shiftForInsert(index, count) {
    const at = normalizeIndex(index);
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const shifted = new RangeSet(this);
    if (at == null || safeCount <= 0 || !shifted.ranges.length) return shifted;
    const max = shifted.ranges.at(-1)[1];
    if (at > max) return shifted;
    shifted.ranges = [];
    for (const [start, end] of this.ranges) {
      if (end < at) shifted.addRange(start, end);
      else if (start >= at) shifted.addRange(start + safeCount, end + safeCount);
      else {
        shifted.addRange(start, at - 1);
        shifted.addRange(at + safeCount, end + safeCount);
      }
    }
    return shifted;
  }

  shiftForDelete(index, count) {
    const at = normalizeIndex(index);
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const shifted = new RangeSet();
    if (at == null || safeCount <= 0 || !this.ranges.length) return new RangeSet(this);
    const deleteEnd = at + safeCount - 1;
    for (const [start, end] of this.ranges) {
      if (end < at) shifted.addRange(start, end);
      else if (start > deleteEnd) shifted.addRange(start - safeCount, end - safeCount);
      else {
        if (start < at) shifted.addRange(start, at - 1);
        if (end > deleteEnd) shifted.addRange(at, end - safeCount);
      }
    }
    return shifted;
  }

  *[Symbol.iterator]() {
    for (const [start, end] of this.ranges) {
      for (let value = start; value <= end; value++) yield value;
    }
  }

  toRanges() {
    return this.ranges.map((range) => [...range]);
  }
}

function isRangeList(values) {
  return Array.isArray(values) && values.every((value) => Array.isArray(value) && value.length >= 2);
}

function normalizeIndex(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

function normalizeRange(start, end) {
  const safeStart = normalizeIndex(start);
  const safeEnd = normalizeIndex(end);
  if (safeStart == null || safeEnd == null) return null;
  return [Math.min(safeStart, safeEnd), Math.max(safeStart, safeEnd)];
}

function rangeIndexFor(ranges, value) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = ranges[mid];
    if (value < start) high = mid - 1;
    else if (value > end) low = mid + 1;
    else return mid;
  }
  return -1;
}
