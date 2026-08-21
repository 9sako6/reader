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
    this.className = "";
    this.listeners = new Map();
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
    return { keyframes, options, finished: Promise.resolve() };
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
    return { top: 0, bottom: 100, height: 100 };
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
