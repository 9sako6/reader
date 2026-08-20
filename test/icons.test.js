const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../packages/web-reader/src/icons.js");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(child) {
    this.children.push(child);
  }
}

const document = {
  createElementNS(_namespace, tagName) {
    return new Element(tagName);
  },
};

test("playback controls use consistently sized vector icons", () => {
  for (const name of ["previous", "play", "pause", "close"]) {
    const icon = create(document, name, 28);
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.attributes.width, "28");
    assert.equal(icon.attributes.height, "28");
    assert.equal(icon.attributes.viewBox, "0 0 24 24");
    assert.equal(icon.attributes.fill, "currentColor");
    assert.equal(icon.attributes["aria-hidden"], "true");
    assert.ok(icon.children.length > 0);
  }
  assert.equal(create(document, "previous", 28).children.length, 2);
  assert.throws(() => create(document, "missing", 28), /Unknown Reader icon/);
});
