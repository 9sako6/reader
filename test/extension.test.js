const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "apps", "ios", "ReaderExtension", "Resources", "manifest.json");

test("Safari extension loads Reader resources in dependency order", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "defuddle.js",
    "engine.js",
    "extractor.js",
    "icons.js",
    "viewer.js",
    "bootstrap.js",
  ]);
});

test("Xcode project embeds every manifest script in the extension", () => {
  const project = fs.readFileSync(path.join(root, "apps", "ios", "Reader.xcodeproj", "project.pbxproj"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const script of manifest.content_scripts[0].js) {
    assert.match(project, new RegExp(`${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} in Resources`));
  }
  assert.match(project, /ReaderExtension\.appex in Embed Foundation Extensions/);
});

test("mobile controls keep the primary reading actions at the bottom", () => {
  const overlay = fs.readFileSync(path.join(root, "apps", "ios", "ReaderExtension", "Resources", "viewer", "viewer.js"), "utf8");
  assert.match(overlay, /reader\.append\(topbar, content, controlbar\)/);
  assert.match(overlay, /context-unit previous/);
  assert.match(overlay, /context-unit next/);
  assert.match(overlay, /grid-template-columns: 1fr 64px 1fr/);
  assert.match(overlay, /background: transparent/);
  assert.doesNotMatch(overlay, /\.control-dock \{[^}]*border:/s);
  assert.doesNotMatch(overlay, /\.control-dock \{[^}]*box-shadow:/s);
  assert.match(overlay, /\.progress \{ position: absolute; right:/);
  assert.match(overlay, /controlbar\.append\(progress\)/);
  assert.match(overlay, /nodes\.controlbar\.replaceChildren\(dock, nodes\.progress\)/);
  assert.match(overlay, /nodes\.controlbar\.replaceChildren\(nodes\.progress\)/);
  assert.match(overlay, /\.controlbar\.text-mode \{ min-height: calc\(44px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(overlay, /nodes\.controlbar\.classList\.add\("text-mode"\)/);
  assert.match(overlay, /nodes\.controlbar\.classList\.remove\("text-mode"\)/);
  assert.doesNotMatch(overlay, /\.controlbar \{ position: absolute/);
  assert.match(overlay, /RSVPで読む/);
  assert.match(overlay, /文章で読む/);
  assert.match(overlay, /\.mode-button \{[^}]*left: 50%;[^}]*bottom: 8px/s);
  assert.match(overlay, /topbar\.append\(modeButton, closeButton\)/);
  assert.match(overlay, /dock\.append\(previous, playButton\)/);
  assert.doesNotMatch(overlay, /mode-switch/);
  assert.doesNotMatch(overlay, /const play = transportButton/);
  assert.doesNotMatch(overlay, /1文進む|表示設定/);
  assert.match(overlay, /justify-content: flex-end/);
  assert.match(overlay, /iconButton\("close", "Readerを閉じる"/);
  assert.match(overlay, /\.rsvp-unit\.quote::before/);
  assert.doesNotMatch(overlay, /\.rsvp-unit\.quote \{[^}]*padding:/s);
  assert.match(overlay, /\.text-view \{[^}]*-webkit-mask-image: linear-gradient\(to bottom, transparent/s);
  assert.match(overlay, /\.text-view \{[^}]*mask-image: linear-gradient\(to bottom, transparent/s);
  assert.doesNotMatch(overlay, /desktop-viewer|DesktopViewer|記事の構成/);
});
