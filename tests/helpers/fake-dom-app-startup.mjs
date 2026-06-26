class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) if (name) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, String(value));
  }

  getPropertyValue(name) {
    return this.values.get(name) ?? "";
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this._id = "";
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this.listeners = new Map();
    this.clientWidth = 960;
    this.clientHeight = 540;
    this.scrollWidth = 960;
    this.scrollHeight = 540;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.value = "";
    this.checked = false;
    this.files = [];
    this.options = [];
    this.open = false;
    this._innerHTML = "";
    this._className = "";
    this._textContent = "";
  }

  set id(value) {
    this._id = String(value || "");
    if (this.ownerDocument && this._id) this.ownerDocument.registerElement(this);
  }

  get id() {
    return this._id;
  }

  set className(value) {
    this._className = String(value || "");
    this.classList = new FakeClassList(this);
    for (const name of this._className.split(/\s+/)) this.classList.add(name);
  }

  get className() {
    return this.classList.toString();
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this.children = [];
    this._textContent = "";
    this.options = [...this._innerHTML.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>/g)]
      .map((match) => ({ value: decodeHtml(match[1]) }));
    parseHtmlFragment(this, this._innerHTML, this.ownerDocument);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
    this._innerHTML = "";
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join("")}`;
  }

  appendChild(child) {
    if (typeof child === "string") {
      this._textContent += child;
      return child;
    }
    if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
    child.parentElement = this;
    this.children.push(child);
    if (child.ownerDocument && child.id) child.ownerDocument.registerElement(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    applyAttribute(this, name, stringValue);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  removeEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    this.listeners.set(name, listeners.filter((item) => item !== listener));
  }

  setPointerCapture() {}

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    event.stopPropagation ??= () => { event.__stopped = true; };
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    if (event.bubbles !== false && !event.__stopped && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click() {
    return this.dispatchEvent({ type: "click", target: this, bubbles: true });
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {}

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.clientWidth,
      height: this.clientHeight,
      right: this.clientWidth,
      bottom: this.clientHeight
    };
  }

  getContext() {
    return makeCanvasContext();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const results = [];
    walkElements(this.children, (element) => {
      if (matchesSelector(element, selector)) results.push(element);
    });
    return results;
  }
}

class FakeDocument {
  constructor({ indexHtml = "", optionalIds = [] } = {}) {
    this.elements = new Map();
    this.optionalIds = new Set(optionalIds);
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.activeElement = null;
    this.listeners = new Map();
    if (indexHtml) parseHtmlFragment(this.body, bodyHtml(indexHtml), this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  registerElement(element) {
    if (element.id) this.elements.set(element.id, element);
  }

  getElementById(id) {
    if (this.elements.has(id)) return this.elements.get(id);
    if (this.optionalIds.has(id)) {
      const element = new FakeElement(elementTagForId(id), this);
      element.id = id;
      if (id === "gridHost") {
        element.clientWidth = 1024;
        element.clientHeight = 620;
      }
      this.elements.set(id, element);
      return element;
    }
    return null;
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  removeEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    this.listeners.set(name, listeners.filter((item) => item !== listener));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const roots = [this.documentElement, this.body, ...this.elements.values()];
    const results = [];
    for (const root of roots) {
      if (matchesSelector(root, selector)) results.push(root);
      walkElements(root.children, (element) => {
        if (matchesSelector(element, selector)) results.push(element);
      });
    }
    return [...new Set(results)];
  }
}

function elementTagForId(id) {
  if (/canvas/i.test(id)) return "canvas";
  if (id === "hiddenFileInput") return "input";
  if (id === "cellEditor") return "textarea";
  return "div";
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function bodyHtml(html) {
  const match = String(html).match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : String(html);
}

function parseHtmlFragment(parent, html, documentRef) {
  const stack = [parent];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  for (const match of String(html).matchAll(tokenRe)) {
    const token = match[0];
    const current = stack.at(-1);
    if (!token.startsWith("<")) {
      current._textContent += decodeHtml(token);
      continue;
    }
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const closing = token.match(/^<\/\s*([a-zA-Z][\w:-]*)/);
      const tagName = closing?.[1]?.toUpperCase();
      while (stack.length > 1) {
        const popped = stack.pop();
        if (!tagName || popped.tagName === tagName) break;
      }
      continue;
    }
    const start = token.match(/^<\s*([a-zA-Z][\w:-]*)([\s\S]*?)\/?\s*>$/);
    if (!start) continue;
    const [, tagName, attrText] = start;
    const element = new FakeElement(tagName, documentRef);
    applyAttributes(element, attrText);
    current.appendChild(element);
    const selfClosing = /\/\s*>$/.test(token) || VOID_TAGS.has(tagName.toLowerCase());
    if (!selfClosing) stack.push(element);
  }
}

function applyAttributes(element, attrText) {
  const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  for (const match of String(attrText || "").matchAll(attrRe)) {
    const name = match[1];
    const value = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
    element.attributes.set(name, value);
    applyAttribute(element, name, value);
  }
}

function applyAttribute(element, name, value) {
  if (name === "id") {
    element.id = value;
    return;
  }
  if (name === "class") {
    element.className = value;
    return;
  }
  if (name.startsWith("data-")) {
    element.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value || "";
    return;
  }
  if (name === "value") element.value = value;
  if (name === "checked") element.checked = true;
  if (name === "selected") element.selected = true;
  if (name === "disabled") element.disabled = true;
  if (name === "hidden") element.hidden = true;
  if (name === "open") element.open = true;
}

function walkElements(elements, visit) {
  for (const element of elements) {
    visit(element);
    walkElements(element.children, visit);
  }
}

function matchesSelector(element, selector) {
  if (!selector || selector.includes(",")) return selector.split(",").some((part) => matchesSelector(element, part.trim()));
  const compoundClass = selector.match(/^\.([\w-]+)\.([\w-]+)$/);
  if (compoundClass) return element.classList.contains(compoundClass[1]) && element.classList.contains(compoundClass[2]);
  const attrMatch = selector.match(/^(?:(\w+))?\[data-([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/);
  if (attrMatch) {
    const [, tag, attr, expected] = attrMatch;
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    const key = attr.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (!Object.hasOwn(element.dataset, key)) return false;
    return expected === undefined || element.dataset[key] === expected;
  }
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function makeCanvasContext() {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "measureText") return (text) => ({ width: String(text ?? "").length * 7 });
      if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
      if (prop === "createPattern") return () => null;
      return () => {};
    },
    set() {
      return true;
    }
  });
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&hellip;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

export function installFakeAppStartupDom(options = {}) {
  const normalized = typeof options === "string" ? { indexHtml: options } : options;
  const document = new FakeDocument(normalized);
  const window = {
    document,
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    location: { hostname: "localhost" },
    navigator: { clipboard: {} },
    addEventListener() {},
    removeEventListener() {}
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = window.location;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator
  });
  globalThis.localStorage = makeStorage();
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.CSS = { escape: (value) => String(value).replace(/"/g, "\\\"") };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => "",
    color: "#fff"
  });
  globalThis.requestAnimationFrame = (callback) => {
    callback(performance.now());
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.fetch = async () => ({ text: async () => "" });

  return { document, window };
}
