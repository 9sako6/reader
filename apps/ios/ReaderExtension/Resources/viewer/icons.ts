(function installMobileIcons(root: typeof globalThis, factory: () => ReaderMobileIcons) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.MobileIcons) root.MobileIcons = api;
})(globalThis, function createMobileIcons(): ReaderMobileIcons {
  type IconName = "previous" | "play" | "pause" | "close";
  type IconPart = readonly [keyof SVGElementTagNameMap, Readonly<Record<string, string>>];
  const namespace = "http://www.w3.org/2000/svg";
  const icons: Record<IconName, readonly IconPart[]> = {
    previous: [
      ["path", { d: "M10.9 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" }],
      ["path", { d: "M20.15 5.2a1.25 1.25 0 0 1 2.05.97v11.66a1.25 1.25 0 0 1-2.05.97l-7.3-5.83a1.25 1.25 0 0 1 0-1.94z" }],
    ],
    play: [
      ["path", { d: "M6.2 4.7a1.5 1.5 0 0 1 2.3-1.3l11.4 7.3a1.5 1.5 0 0 1 0 2.6L8.5 20.6a1.5 1.5 0 0 1-2.3-1.3z" }],
    ],
    pause: [
      ["rect", { x: "5", y: "3", width: "5", height: "18", rx: "1.5" }],
      ["rect", { x: "14", y: "3", width: "5", height: "18", rx: "1.5" }],
    ],
    close: [
      ["rect", { x: "3.5", y: "10.5", width: "17", height: "3", rx: "1.5", transform: "rotate(45 12 12)" }],
      ["rect", { x: "3.5", y: "10.5", width: "17", height: "3", rx: "1.5", transform: "rotate(-45 12 12)" }],
    ],
  };

  function create(document: Document, name: IconName, size = 24): SVGSVGElement {
    if (!(name in icons)) throw new TypeError(`Unknown Reader icon: ${name}`);
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    for (const [tagName, attributes] of icons[name]) {
      const element = document.createElementNS(namespace, tagName);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      svg.append(element);
    }
    return svg;
  }

  return { create };
});
