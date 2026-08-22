export class FakeElement {
  [key: string]: any;

  constructor(tagName: string, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
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
    this.listeners = new Map();
    this.animations = [];
    this.rect = null;
    const classes = new Set<string>();
    this.classList = {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
    };
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parent = this;
      child.ownerDocument ||= this.ownerDocument;
      this.children.push(child);
    }
  }

  attachShadow() {
    const shadow = new FakeElement("shadow-root");
    this.append(shadow);
    return shadow;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event: any) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }

  animate(keyframes: any, options: any) {
    const animation = { keyframes, options, finished: Promise.resolve() };
    this.animations.push(animation);
    return animation;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child: FakeElement) => child !== this);
    this.parent = null;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = [];
    this.append(...children);
  }

  getBoundingClientRect() {
    return this.rect || { top: 0, bottom: 100, left: 0, right: 390, width: 390, height: 100 };
  }

  getClientRects() {
    return this.hidden ? [] : [this.getBoundingClientRect()];
  }

  contains(element: FakeElement) {
    if (element === this) return true;
    return this.children.some((child) => child.contains(element));
  }

  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  get parentElement() {
    return this.parent;
  }
}

export function findElement(
  root: FakeElement | null,
  predicate: (element: FakeElement) => boolean,
): FakeElement | null {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

export function findElements(
  root: FakeElement | null,
  predicate: (element: FakeElement) => boolean,
): FakeElement[] {
  if (!root) return [];
  const matches = predicate(root) ? [root] : [];
  for (const child of root.children) matches.push(...findElements(child, predicate));
  return matches;
}
