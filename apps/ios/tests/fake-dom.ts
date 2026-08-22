export class FakeElement {
  [key: string]: any;

  constructor(tagName: string, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this._textContent = textContent;
    Object.defineProperty(this, "nodeValue", {
      configurable: true,
      get: () => this._textContent,
      set: (value) => { this._textContent = String(value ?? ""); },
    });
    this.style = {};
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.clientHeight = 500;
    this.scrollTop = 0;
    this.hidden = false;
    this.inert = false;
    this.disabled = false;
    this.ownerDocument = null;
    this.className = "";
    Object.defineProperty(this, "srcSet", {
      configurable: true,
      get: () => this.srcset,
      set: (value) => { this.srcset = value; },
    });
    this.listeners = new Map();
    this.animations = [];
    this.rect = null;
    this.classList = {
      add: (...names: string[]) => {
        const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
        names.forEach((name) => classes.add(name));
        this.className = [...classes].join(" ");
      },
      remove: (...names: string[]) => {
        const classes = new Set(this.className.split(/\s+/u).filter(Boolean));
        names.forEach((name) => classes.delete(name));
        this.className = [...classes].join(" ");
      },
      contains: (name: string) => this.className.split(/\s+/u).includes(name),
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child: FakeElement) => child.textContent || "").join("");
  }

  set textContent(value: string) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this._textContent = String(value ?? "");
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (typeof child === "string") {
        const text = new FakeElement("#text", child);
        text.nodeType = 3;
        text.nodeName = "#text";
        this.append(text);
        continue;
      }
      let ancestor: FakeElement | null = this;
      while (ancestor) {
        if (ancestor === child) throw new Error("invalid DOM hierarchy");
        ancestor = ancestor.parent;
      }
      if (child.parent) child.parent.removeChild(child);
      child.parent = this;
      child.ownerDocument ||= this.ownerDocument;
      this.children.push(child);
    }
    if (children.length > 0) this._textContent = "";
  }

  appendChild(child: FakeElement) {
    this.append(child);
    return child;
  }

  insertBefore(child: FakeElement, reference: FakeElement | null) {
    if (!reference) return this.appendChild(child);
    let ancestor: FakeElement | null = this;
    while (ancestor) {
      if (ancestor === child) throw new Error("invalid DOM hierarchy");
      ancestor = ancestor.parent;
    }
    if (child === reference) return child;
    if (child.parent) child.parent.removeChild(child);
    const index = this.children.indexOf(reference);
    if (index < 0) return this.appendChild(child);
    child.parent = this;
    child.ownerDocument ||= this.ownerDocument;
    this.children.splice(index, 0, child);
    this._textContent = "";
    return child;
  }

  removeChild(child: FakeElement) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parent = null;
    }
    return child;
  }

  attachShadow() {
    const shadow = new FakeElement("shadow-root");
    shadow.nodeType = 11;
    this.append(shadow);
    return shadow;
  }

  setAttribute(name: string, value: string) {
    const normalized = String(value);
    this.attributes[name] = normalized;
    if (name === "class") this.className = normalized;
    if (name === "id") this.id = normalized;
    if (name.toLowerCase() === "srcset") this.srcset = normalized;
    if (name === "sizes") this.sizes = normalized;
    if (name === "src") this.src = normalized;
    if (name === "alt") this.alt = normalized;
    if (name === "title") this.title = normalized;
    if (name === "disabled") this.disabled = true;
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = normalized;
    }
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name === "class") this.className = "";
    if (name === "disabled") this.disabled = false;
    if (name === "hidden") this.hidden = false;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      delete this.dataset[key];
    }
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate: any) => candidate !== listener));
  }

  dispatchEvent(event: any) {
    event.target ||= this;
    event.bubbles ??= true;
    event.cancelBubble ??= false;
    event.defaultPrevented ??= false;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => { event.cancelBubble = true; };
    if (!event.composedPath) event.composedPath = () => [this];
    let current: FakeElement | null = this;
    while (current) {
      event.currentTarget = current;
      for (const listener of current.listeners.get(event.type) || []) listener(event);
      if (event.cancelBubble) break;
      current = current.parent;
    }
    return !event.defaultPrevented;
  }

  animate(keyframes: any, options: any) {
    const animation = { keyframes, options, finished: Promise.resolve() };
    this.animations.push(animation);
    return animation;
  }

  remove() {
    if (!this.parent) return;
    this.parent.removeChild(this);
  }

  replaceChildren(...children: FakeElement[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string) {
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (matchesSimpleSelector(child, selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  matches(selector: string) {
    return matchesSimpleSelector(this, selector);
  }

  getBoundingClientRect() {
    return this.rect || { top: 0, bottom: 100, left: 0, right: 390, width: 390, height: 100 };
  }

  getClientRects() {
    return this.hidden ? [] : [this.getBoundingClientRect()];
  }

  contains(element: FakeElement) {
    const pending = [this];
    const visited = new Set<FakeElement>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      if (current === element) return true;
      visited.add(current);
      pending.push(...current.children);
    }
    return false;
  }

  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  get parentElement() {
    return this.parent?.nodeType === 1 ? this.parent : null;
  }

  get parentNode() {
    return this.parent;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get lastChild() {
    return this.children.at(-1) || null;
  }

  get nextSibling() {
    if (!this.parent) return null;
    return this.parent.children[this.parent.children.indexOf(this) + 1] || null;
  }

  get previousSibling() {
    if (!this.parent) return null;
    return this.parent.children[this.parent.children.indexOf(this) - 1] || null;
  }

  get childNodes() {
    return this.children;
  }

  get isConnected() {
    return Boolean(this.parent);
  }

  getRootNode() {
    let current: FakeElement = this;
    while (current.parent) current = current.parent;
    return current;
  }
}

function matchesSimpleSelector(element: FakeElement, selector: string): boolean {
  return selector.split(",").some((part) => {
    const value = part.trim();
    if (!value) return false;
    const tag = value.match(/^[a-z][a-z0-9-]*/iu)?.[0];
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    const id = value.match(/#([a-z0-9_-]+)/iu)?.[1];
    if (id && element.id !== id) return false;
    for (const className of value.matchAll(/\.([a-z0-9_-]+)/giu)) {
      if (!element.classList.contains(className[1])) return false;
    }
    for (const attribute of value.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/gu)) {
      const name = attribute[1];
      if (!element.hasAttribute(name)) return false;
      if (attribute[2] !== undefined && element.getAttribute(name) !== attribute[2]) return false;
    }
    return true;
  });
}

export function findElement(
  root: FakeElement | null,
  predicate: (element: FakeElement) => boolean,
): FakeElement | null {
  if (!root) return null;
  const pending = [root];
  const visited = new Set<FakeElement>();
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element || visited.has(element)) continue;
    visited.add(element);
    if (predicate(element)) return element;
    pending.push(...[...element.children].reverse());
  }
  return null;
}

export function findElements(
  root: FakeElement | null,
  predicate: (element: FakeElement) => boolean,
): FakeElement[] {
  if (!root) return [];
  const matches: FakeElement[] = [];
  const pending = [root];
  const visited = new Set<FakeElement>();
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element || visited.has(element)) continue;
    visited.add(element);
    if (predicate(element)) matches.push(element);
    pending.push(...[...element.children].reverse());
  }
  return matches;
}
