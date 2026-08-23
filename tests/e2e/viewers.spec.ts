import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function loadViewer(page: Page, viewer: "chrome" | "mobile", query = ""): Promise<void> {
  await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}${query}`);
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
}

async function readReaderPosition(dialog: ReturnType<Page["getByRole"]>): Promise<{
  kind: "text" | "figure";
  sourceStart: number;
  figureIndex: number | null;
}> {
  const figure = dialog.locator('[data-reader-position-kind="figure"]:visible').first();
  if (await figure.count() > 0) {
    return {
      kind: "figure",
      sourceStart: Number(await figure.getAttribute("data-source-start")),
      figureIndex: Number(await figure.getAttribute("data-figure-index")),
    };
  }
  const unit = dialog.locator('[data-reader-position-kind="text"][data-reader-unit]:visible').first();
  return {
    kind: "text",
    sourceStart: Number(await unit.getAttribute("data-source-start")),
    figureIndex: null,
  };
}

async function pauseReaderIfPlaying(dialog: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect(dialog.getByRole("button", { name: /^(文章で読む|RSVPで読む)$/ })).toBeVisible();
  const pause = dialog.getByRole("button", { name: "一時停止" });
  if (await pause.count() > 0 && await pause.isVisible()) await pause.click();
}

async function placeTextMarker(marker: ReturnType<Page["getByRole"]>, targetTop: number): Promise<void> {
  await marker.evaluate((element, desiredTop) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += markerRect.top - scrollerRect.top - desiredTop;
  }, targetTop);
}

async function scrollTextToEnd(marker: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect.poll(() => marker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    return scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
  })).toBeGreaterThan(0);
  await marker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    scroller.scrollTop = scroller.scrollHeight;
  });
}

type ChromeOpenOptions = {
  delay?: number;
  text?: string;
  readingContext?: {
    language?: string;
    title?: string;
    blocks?: Array<{
      text: string;
      kind: "heading" | "paragraph" | "quote" | "preformatted";
      level: number | null;
      start: number;
      end: number;
    }>;
    headings?: Array<{ text: string; level: number }>;
    sectionOffsets?: number[];
    sectionTransitions?: Array<{ offset: number; headingIndex: number }>;
    initialHeadingIndex?: number;
    figures?: [];
  };
  image?: "immediate" | "delayed" | "missing" | "broken" | "vertical" | "horizontal" | "transparent" | "huge" | "default";
  figureFirst?: boolean;
  outline?: "two";
  alt?: string;
  caption?: string;
  cacheKey?: string;
  srcset?: string;
  sizes?: string;
  imageDelay?: number;
  requestId?: string;
  paused?: boolean;
  error?: boolean;
  reason?: "content_not_found" | "unsupported_page" | "extraction_failed";
};

type MobileOpenOptions = {
  text?: string;
  image?: "immediate" | "delayed" | "missing" | "broken" | "vertical" | "horizontal" | "transparent" | "huge" | "default";
  figureFirst?: boolean;
  alt?: string;
  caption?: string;
  cacheKey?: string;
  srcset?: string;
  sizes?: string;
  imageDelay?: number;
  error?: boolean;
  reason?: "content_not_found" | "unsupported_page" | "extraction_failed";
};

async function openChrome(page: Page, options: ChromeOpenOptions): Promise<void> {
  await page.evaluate((openOptions) => {
    (globalThis as typeof globalThis & {
      ReaderE2E: { open(options: ChromeOpenOptions): string };
    }).ReaderE2E.open(openOptions);
  }, options);
}

async function openMobile(page: Page, options: MobileOpenOptions = {}): Promise<void> {
  await page.evaluate((openOptions) => {
    (globalThis as typeof globalThis & {
      ReaderE2E: { open(options: MobileOpenOptions): Promise<void> };
    }).ReaderE2E.open(openOptions);
  }, options);
}

async function loadingBarWasRevealed(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as typeof globalThis & {
    ReaderE2E: { loadingBarRevealEvents: unknown[] };
  }).ReaderE2E.loadingBarRevealEvents.length);
}

async function loadingBarRevealSnapshot(page: Page): Promise<{
  height: string;
  left: number;
  top: number;
  width: number;
  viewportWidth: number;
  viewportHeight: number;
} | null> {
  return page.evaluate(() => (globalThis as typeof globalThis & {
    ReaderE2E: { loadingBarRevealEvents: Array<{
      height: string;
      left: number;
      top: number;
      width: number;
      viewportWidth: number;
      viewportHeight: number;
    }> };
  }).ReaderE2E.loadingBarRevealEvents.at(-1) || null);
}

const RSVP_WIDTHS = [320, 375, 390, 430, 768];
const RSVP_SHORT_TEXT = "短い。";
const RSVP_NEAR_LIMIT_TEXT = "上限付近。";
const RSVP_LONG_URL = "https://example.com/path/to/a/very/long/resource?token=abcdefghijklmnopqrstuvwxyz0123456789";
const RSVP_WIDTH_SOURCE = `${RSVP_SHORT_TEXT}${RSVP_NEAR_LIMIT_TEXT}${RSVP_LONG_URL}。`;

test("Chrome RSVP controls and outline distinguish active, inactive, and keyboard focus in more contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "no-preference" });
  await loadViewer(page, "chrome");
  await openChrome(page, { paused: true, outline: "two" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  const normal = await dialog.evaluate((reader) => {
    const read = (selector: string) => {
      const element = reader.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, outline: style.outlineColor };
    };
    return {
      mode: read('[data-reader-mode-button="true"]'),
      close: read('[data-reader-topbar] button[aria-label="readerを閉じる"]'),
      previous: read('[aria-label="1文戻る"]'),
      play: read('[aria-label="再生"]'),
      previousContext: read('[data-reader-context-previous="true"]'),
      nextContext: read('[data-reader-context-next="true"]'),
      progress: read('[data-reader-progress="true"]'),
      activeHeading: read('[data-reader-minimap] button[aria-current="location"]'),
      inactiveHeading: read('[data-reader-minimap] button[aria-current="false"]'),
    };
  });

  await page.emulateMedia({ contrast: "more" });
  await page.reload();
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await openChrome(page, { paused: true, outline: "two" });
  const highContrastDialog = page.getByRole("dialog", { name: "reader" });
  await expect(highContrastDialog).toBeVisible();
  await expect(highContrastDialog.getByRole("button", { name: "再生" })).toBeVisible();

  const highContrast = await highContrastDialog.evaluate((reader) => {
    const read = (selector: string) => {
      const element = reader.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    };
    return {
      mode: read('[data-reader-mode-button="true"]'),
      close: read('[data-reader-topbar] button[aria-label="readerを閉じる"]'),
      previous: read('[aria-label="1文戻る"]'),
      play: read('[aria-label="再生"]'),
      previousContext: read('[data-reader-context-previous="true"]'),
      nextContext: read('[data-reader-context-next="true"]'),
      progress: read('[data-reader-progress="true"]'),
      activeHeading: read('[data-reader-minimap] button[aria-current="location"]'),
      inactiveHeading: read('[data-reader-minimap] button[aria-current="false"]'),
    };
  });

  expect(normal.mode.background).not.toBe(highContrast.mode.background);
  expect(normal.previous.color).not.toBe(highContrast.previous.color);
  expect(normal.previousContext.color).not.toBe(highContrast.previousContext.color);
  expect(normal.progress.color).not.toBe(highContrast.progress.color);
  expect(highContrast.mode.color).toBe("rgb(0, 0, 0)");
  expect(highContrast.mode.background).toBe("rgb(255, 255, 255)");
  expect(highContrast.close.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.previous.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.play.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.previousContext.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.nextContext.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.progress.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.activeHeading.color).toBe("rgb(0, 0, 0)");
  expect(highContrast.activeHeading.background).toBe("rgb(255, 255, 255)");
  expect(highContrast.inactiveHeading.color).toBe("rgb(255, 255, 255)");
  expect(highContrast.inactiveHeading.background).toBe("rgba(0, 0, 0, 0)");
  expect(highContrast.activeHeading.color).not.toBe(highContrast.inactiveHeading.color);

  await highContrastDialog.getByRole("button", { name: "文章で読む" }).focus();
  await page.keyboard.press("Tab");
  const focusedClose = highContrastDialog.getByRole("button", { name: "readerを閉じる" });
  await expect(focusedClose).toBeFocused();
  await expect(focusedClose).toHaveCSS("outline-style", "solid");
  await expect(focusedClose).toHaveCSS("outline-width", "2px");
  await expect(focusedClose).toHaveCSS("outline-color", "rgb(255, 255, 255)");
});

test("Chrome text content and progress become readable in more contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "more" });
  await loadViewer(page, "chrome");
  await openChrome(page, { paused: true });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog.getByRole("button", { name: "文章で読む" })).toBeVisible();
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  await expect(dialog.locator('[data-reader-text-shell="true"]')).toBeVisible();

  await expect(dialog.locator("article.article")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(dialog.locator("[data-reader-position-kind=\"text\"]").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(dialog.locator('[data-reader-progress="true"]')).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("Chrome figure caption, loading status, and description become readable in more contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "more" });
  const releaseImage = await openFigureViewer(page, "chrome", { paused: true, cacheKey: "contrast-figure" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const figure = dialog.getByRole("figure", { name: "本文画像" });
  const status = figure.locator("[data-reader-figure-status]");
  const description = figure.locator("[data-reader-figure-description]");
  await expect(status).toBeVisible();
  await expect(description).toBeVisible();
  await expect(status).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(description).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(figure.locator("[data-reader-figure-indicator]")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await releaseImage();
  await expect(status).toBeHidden({ timeout: 5_000 });
  await expect(figure.locator("figcaption")).toBeVisible();
  await expect(figure.locator("figcaption")).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("Chrome preparation loading feedback becomes readable in more contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "more" });
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 2_000 });

  await expect(page.locator('[data-reader-loading-label="true"]')).toHaveText("文章を準備しています");
  await expect(page.locator('[data-reader-loading-cancel="true"]')).toBeVisible();
  await expect(page.locator('[data-reader-loading-label="true"]')).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator('[data-reader-loading-cancel="true"]')).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator('[data-reader-loading-bar="true"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator('[data-reader-loading-indicator="true"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
});

test("Chrome headingless RSVP progress reaches 100% after playback", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  await openChrome(page, { text: "最初の文です。最後の文です。", paused: true });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const progress = dialog.locator('[data-reader-progress="true"]');
  await expect(progress).toHaveCount(1);
  await expect(dialog.locator('[data-reader-minimap="true"]')).toHaveCount(0);

  await dialog.getByRole("button", { name: "再生" }).click();
  await expect(progress).toHaveText("100%");
});

test("Chrome text progress reaches 100% at the article end and survives a mode switch", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await loadViewer(page, "chrome");
  const articleText = `${Array.from({ length: 40 }, () => "中間の文章です。").join("")}\n\n最後の文章です。`;
  await openChrome(page, { text: articleText, paused: true });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const progress = dialog.locator('[data-reader-progress="true"]');
  const progressGeometry = () => progress.evaluate((element) => {
    const progressElement = element as HTMLElement;
    const container = progressElement.offsetParent;
    if (!container) throw new Error("progress container not found");
    const progressRectangle = element.getBoundingClientRect();
    const containerRectangle = container.getBoundingClientRect();
    return {
      rightGap: containerRectangle.right - progressRectangle.right,
      bottomGap: containerRectangle.bottom - progressRectangle.bottom,
    };
  });
  const rsvpGeometry = await progressGeometry();
  expect(Math.abs(rsvpGeometry.rightGap - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(rsvpGeometry.bottomGap - 16)).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const lastTextMarker = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]').last();
  await lastTextMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    scroller.style.paddingBottom = "600px";
  });
  await scrollTextToEnd(lastTextMarker);
  await expect(progress).toHaveText("100%");
  const endProgress = await progress.textContent();
  const textGeometry = await progressGeometry();
  expect(Math.abs(textGeometry.rightGap - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(textGeometry.bottomGap - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(textGeometry.rightGap - rsvpGeometry.rightGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(textGeometry.bottomGap - rsvpGeometry.bottomGap)).toBeLessThanOrEqual(1);

  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await expect(progress).toHaveText(endProgress || "100%");
});

test("Chrome image progress follows its source offset and the minimap has no duplicate meter", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  await openChrome(page, { paused: true, outline: "two" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const progress = dialog.locator('[data-reader-progress="true"]');
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const imageMarker = dialog.locator('[data-reader-position-kind="figure"]').first();
  const imageOffset = Number(await imageMarker.getAttribute("data-source-start"));
  const sourceLength = await dialog.locator("article.article [data-source-end]").evaluateAll((elements) => Math.max(
    ...elements.map((element) => Number(element.getAttribute("data-source-end"))),
  ));
  await imageMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    scroller.style.paddingBottom = "600px";
  });
  await placeTextMarker(imageMarker, 100);
  await expect.poll(() => imageMarker.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller]");
    if (!scroller) return false;
    const scrollerRectangle = scroller.getBoundingClientRect();
    return rectangle.bottom > scrollerRectangle.top && rectangle.top < scrollerRectangle.bottom;
  })).toBe(true);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();

  await expect(dialog.getByRole("figure", { name: "本文画像" })).toBeVisible();
  await expect(progress).toHaveText(`${Math.round((imageOffset / sourceLength) * 100)}%`);
  await expect(dialog.locator('[data-reader-minimap="true"] [data-reader-progress="true"], [data-reader-minimap="true"] [role="progressbar"], [data-reader-minimap="true"] .progress')).toHaveCount(0);
});

test("Chrome heading jump updates progress to the selected section offset", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  await openChrome(page, { paused: true, outline: "two" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const progress = dialog.locator('[data-reader-progress="true"]');
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const article = dialog.locator("article.article");
  const sourceLength = await article.locator("[data-source-end]").evaluateAll((elements) => Math.max(
    ...elements.map((element) => Number(element.getAttribute("data-source-end"))),
  ));
  const selectedSectionOffset = Number(await article.locator("p.paragraph[data-source-start][data-source-end]").last().getAttribute("data-source-start"));
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();

  const minimap = dialog.locator('[data-reader-minimap="true"]');
  await expect(minimap).toBeVisible();
  await minimap.getByRole("button", { name: "画像のある節" }).click();

  await expect(progress).toHaveCount(1);
  await expect(progress).toHaveText(`${Math.round((selectedSectionOffset / sourceLength) * 100)}%`);
  await expect(minimap.locator('[data-reader-progress="true"], [role="progressbar"], .progress')).toHaveCount(0);
  const progressGeometry = await progress.evaluate((element) => {
    const progressElement = element as HTMLElement;
    const container = progressElement.offsetParent;
    if (!container) throw new Error("progress container not found");
    const progressRectangle = element.getBoundingClientRect();
    const containerRectangle = container.getBoundingClientRect();
    return {
      rightGap: containerRectangle.right - progressRectangle.right,
      bottomGap: containerRectangle.bottom - progressRectangle.bottom,
    };
  });
  expect(Math.abs(progressGeometry.rightGap - 16)).toBeLessThanOrEqual(1);
  expect(Math.abs(progressGeometry.bottomGap - 16)).toBeLessThanOrEqual(1);
});

test("Chrome extraction errors keep retry and close actions readable in more contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "more" });
  await loadViewer(page, "chrome");
  await openChrome(page, { error: true, reason: "unsupported_page" });

  const error = page.locator('[data-reader-error="true"]');
  await expect(error).toBeVisible();
  await expect(page.getByRole("button", { name: "やり直す" })).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "readerを閉じる" })).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("Chrome keeps high contrast colors while reduced motion disables loading animation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 1_200 });

  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);
  const indicator = page.locator('[data-reader-loading-indicator="true"]');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await indicator.evaluate((element) => element.getAnimations().length)).toBe(0);
});

for (const viewportWidth of RSVP_WIDTHS) {
  test(`Chrome viewer caps RSVP units at ${viewportWidth}px without changing font size`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: 800 });
    await loadViewer(page, "chrome");
    await openChrome(page, { text: RSVP_WIDTH_SOURCE, paused: true });

    const dialog = page.getByRole("dialog", { name: "reader" });
    await expect(dialog).toBeVisible();
    const display = dialog.locator("[data-reader-unit]");
    await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();

    const inspectDisplay = () => display.evaluate((element) => {
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return {
        text: element.textContent || "",
        sourceStart: Number(element.getAttribute("data-source-start")),
        sourceEnd: Number(element.getAttribute("data-source-end")),
        widthOverflow: element.scrollWidth - element.clientWidth,
        fontSize: style.fontSize,
        centerY: rectangle.top + rectangle.height / 2,
      };
    });

    const snapshots = [];
    await expect(display).toHaveText(RSVP_SHORT_TEXT);
    await expect.poll(async () => (await inspectDisplay()).sourceStart).toBe(0);
    snapshots.push(await inspectDisplay());

    await dialog.getByRole("button", { name: "再生" }).click();
    await expect.poll(async () => (await inspectDisplay()).sourceStart).toBe(RSVP_SHORT_TEXT.length);
    await dialog.getByRole("button", { name: "一時停止" }).click();
    snapshots.push(await inspectDisplay());

    await dialog.getByRole("button", { name: "再生" }).click();
    await expect.poll(async () => (await inspectDisplay()).sourceStart).toBe(
      RSVP_SHORT_TEXT.length + RSVP_NEAR_LIMIT_TEXT.length,
    );
    await dialog.getByRole("button", { name: "一時停止" }).click();
    snapshots.push(await inspectDisplay());

    expect(snapshots[0]?.text).toBe(RSVP_SHORT_TEXT);
    expect(snapshots[1]?.text).toBe(RSVP_NEAR_LIMIT_TEXT);
    expect(snapshots[2]?.text.startsWith("https:")).toBe(true);
    expect(snapshots.every(({ widthOverflow }) => widthOverflow <= 0)).toBe(true);
    expect(snapshots.map(({ fontSize }) => fontSize)).toEqual(
      snapshots.map(() => snapshots[0]?.fontSize),
    );
    const centerYs = snapshots.map(({ centerY }) => centerY);
    expect(Math.max(...centerYs) - Math.min(...centerYs)).toBeLessThanOrEqual(1);

    const sourceStartBeforeResize = (await inspectDisplay()).sourceStart;
    await page.setViewportSize({ width: viewportWidth === 768 ? 320 : 768, height: 800 });
    await expect.poll(async () => (await inspectDisplay()).sourceStart).toBe(sourceStartBeforeResize);
    const resizedDisplay = await inspectDisplay();
    expect(RSVP_WIDTH_SOURCE.slice(resizedDisplay.sourceStart, resizedDisplay.sourceEnd)).toBe(resizedDisplay.text);
    expect(resizedDisplay.widthOverflow).toBeLessThanOrEqual(0);
    expect(resizedDisplay.fontSize).toBe(snapshots[0]?.fontSize);
  });
}

test("Chrome reader keeps the loading bar hidden when preparation completes in 0ms", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 0 });

  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
  await expect(page.locator("[data-reader-loading-bar]")).toHaveCount(0);
  expect(await loadingBarWasRevealed(page)).toBe(0);
});

test("Chrome reader keeps the loading bar hidden when preparation completes in 99ms", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 99 });

  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
  await expect(page.locator("[data-reader-loading-bar]")).toHaveCount(0);
});

test("Chrome reader reveals a centered thin bar at the 100ms threshold", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 100 });

  await expect.poll(() => loadingBarRevealSnapshot(page)).toMatchObject({ height: "2px" });
  const snapshot = await loadingBarRevealSnapshot(page);
  expect(snapshot).not.toBeNull();
  expect(snapshot!.width).toBeGreaterThan(0);
  expect(Math.abs(snapshot!.left + snapshot!.width / 2 - snapshot!.viewportWidth / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(snapshot!.top + 1 - snapshot!.viewportHeight / 2)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
});

test("Chrome reader keeps only the thin bar before the slow preparation threshold", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 399 });

  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);
  await expect(page.locator("[data-reader-loading-bar]")).toHaveCount(1);
  await expect(page.getByText("文章を準備しています")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "中止" })).toHaveCount(0);
});

test("Chrome reader exposes status and cancel controls after 400ms", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 2000 });

  await expect(page.getByRole("status")).toHaveText("文章を準備しています");
  await expect(page.getByRole("button", { name: "中止" })).toBeVisible();
  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await page.waitForTimeout(2100);
  await expect(page.getByRole("dialog", { name: "reader" })).toHaveCount(0);
});

test("Chrome reader lets users retry a classified preparation error", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 0, error: true, reason: "unsupported_page" });

  await expect(page.getByText("このページはまだ開けません")).toBeVisible();
  await page.getByRole("button", { name: "やり直す" }).click();
  const retriedDialog = page.getByRole("dialog", { name: "reader" });
  await expect(retriedDialog).toBeVisible();
  await retriedDialog.getByRole("button", { name: "一時停止" }).click();
  await expect.poll(async () => (await page.locator("[data-reader-unit]").allTextContents()).join(""))
    .toBe("再試行成功。");
});

test("Chrome reader restores launch focus and source scroll after error retry", async ({ page }) => {
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    window.scrollTo(0, 480);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);

  await openChrome(page, { delay: 0, error: true, reason: "unsupported_page" });
  await expect(page.getByText("このページはまだ開けません")).toBeVisible();
  await page.getByRole("button", { name: "やり直す" }).click();

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expect(launchButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);
});

test("Chrome reader locks source scrolling during preparation and restores inline overflow after cancel", async ({ page }) => {
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "auto";
    window.scrollTo({ top: 480, behavior: "auto" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);

  await openChrome(page, { delay: 2_000 });
  await expect(page.getByRole("status")).toHaveText("文章を準備しています");
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    scroll: window.scrollY,
  }))).toEqual({ htmlOverflow: "hidden", bodyOverflow: "hidden", scroll: 480 });

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);

  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    y: window.scrollY,
  }))).toEqual({ htmlOverflow: "scroll", bodyOverflow: "auto", y: 480 });
});

test("Chrome reader locks source scrolling while ready and restores the saved page after close", async ({ page }) => {
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "auto";
    window.scrollTo({ top: 520, behavior: "auto" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(520);

  await openChrome(page, { delay: 0, paused: true });
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
  }))).toEqual({ htmlOverflow: "hidden", bodyOverflow: "hidden" });

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(520);

  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect(launchButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    y: window.scrollY,
  }))).toEqual({ htmlOverflow: "scroll", bodyOverflow: "auto", y: 520 });
});

test("Chrome text view contains top and bottom overscroll without moving the source page", async ({ page }) => {
  await loadViewer(page, "chrome");
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "auto";
    window.scrollTo({ top: 360, behavior: "auto" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(360);

  await openChrome(page, {
    delay: 0,
    text: "本文を文章ビューで読むための長い段落です。".repeat(120),
    paused: true,
  });
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const scroller = dialog.locator('[data-reader-text-scroller="true"]');
  await expect(scroller).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe("contain");

  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await scroller.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(360);

  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await scroller.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(360);

  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    y: window.scrollY,
  }))).toEqual({ htmlOverflow: "scroll", bodyOverflow: "auto", y: 360 });
});

test("Chrome reader restores source overflow and scroll through consecutive ready and error closes", async ({ page }) => {
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    document.documentElement.style.overflow = "scroll";
    document.body.style.overflow = "auto";
    window.scrollTo({ top: 400, behavior: "auto" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

  await openChrome(page, { delay: 0, text: "一回目のReaderです。", paused: true });
  const firstDialog = page.getByRole("dialog", { name: "reader" });
  await expect(firstDialog).toBeVisible();
  await firstDialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ html: document.documentElement.style.overflow, body: document.body.style.overflow, y: window.scrollY }))).toEqual({ html: "scroll", body: "auto", y: 400 });

  await openChrome(page, { delay: 0, error: true, reason: "unsupported_page" });
  await expect(page.getByText("このページはまだ開けません")).toBeVisible();
  await page.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ html: document.documentElement.style.overflow, body: document.body.style.overflow, y: window.scrollY }))).toEqual({ html: "scroll", body: "auto", y: 400 });

  await openChrome(page, { delay: 0, text: "三回目のReaderです。", paused: true });
  const thirdDialog = page.getByRole("dialog", { name: "reader" });
  await expect(thirdDialog).toBeVisible();
  await thirdDialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ html: document.documentElement.style.overflow, body: document.body.style.overflow, y: window.scrollY }))).toEqual({ html: "scroll", body: "auto", y: 400 });
});

test("mobile reader keeps the launch indicator hidden for a 99ms preparation", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&delay=99");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await page.evaluate(() => { void (globalThis as typeof globalThis & { ReaderE2E: { open(): Promise<void> } }).ReaderE2E.open(); });

  await expect(page.locator(".launch-progress-track")).toHaveCount(0);
  await expect(page.locator(".reader")).toBeVisible();
});

test("mobile reader shows a bar and then slow preparation cancel feedback", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&delay=800");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await page.evaluate(() => { void (globalThis as typeof globalThis & { ReaderE2E: { open(): Promise<void> } }).ReaderE2E.open(); });

  await expect(page.locator(".launch-progress-track")).toBeVisible();
  await expect(page.locator(".launch-status")).toHaveText("文章を準備しています");
  await expect(page.locator(".launch-cancel")).toBeVisible();
  await page.locator(".launch-cancel").click();
  await expect(page.locator(".reader")).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.locator(".reader")).toHaveCount(0);
});

test("mobile reader restores launch focus and source scroll after error retry", async ({ page }) => {
  await loadViewer(page, "mobile");
  const launchButton = page.getByRole("button", { name: "readerで読む" });
  await launchButton.focus();
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    window.scrollTo(0, 480);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);

  await openMobile(page, { error: true, reason: "content_not_found" });
  await expect(page.getByText("文章を読み取れませんでした")).toBeVisible();
  await page.getByRole("button", { name: "やり直す" }).click();

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expect(launchButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(480);
});

test("Chrome reader shows the bar for 1200ms preparation and removes it after the reader opens", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 1200 });

  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);
  await expect(page.locator("[data-reader-loading-bar]")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
  await expect(page.locator("[data-reader-loading-bar]")).toHaveCount(0);
});

test("Chrome reader disables loading and cover animations for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 1200 });

  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);
  const loadingIndicator = page.locator("[data-reader-loading-indicator]");
  await expect(loadingIndicator).toHaveCount(1);
  expect(await loadingIndicator.evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
  expect(await page.getByRole("dialog", { name: "reader" }).evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("Chrome reader ignores a stale A result after request B starts", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 1200, text: "Aの本文です。" });
  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);

  await openChrome(page, { delay: 0, text: "Bの本文です。" });
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-reader-unit]")).toHaveText("Bの本文です。");

  await page.waitForTimeout(1300);
  await expect(dialog.locator("[data-reader-unit]")).toHaveText("Bの本文です。");
});

test("Chrome reader stays closed when a loading request is closed before its result arrives", async ({ page }) => {
  await loadViewer(page, "chrome");
  await openChrome(page, { delay: 1200, text: "閉じられる本文です。" });
  await expect.poll(() => loadingBarWasRevealed(page)).toBe(1);

  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
  await page.waitForTimeout(1300);
  await expect(page.locator("#__rsvp-reader-root")).toHaveCount(0);
});

async function addAccessibilityFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.head.inert = true;
    document.body.inert = false;
    const outsideButton = document.createElement("button");
    outsideButton.id = "outside-reader-button";
    outsideButton.type = "button";
    outsideButton.textContent = "記事側の操作";
    const outsideInput = document.createElement("input");
    outsideInput.id = "outside-reader-input";
    outsideInput.setAttribute("aria-label", "記事側の入力");
    const outsideEditor = document.createElement("div");
    outsideEditor.id = "outside-reader-editor";
    outsideEditor.contentEditable = "true";
    outsideEditor.setAttribute("aria-label", "記事側の編集欄");
    document.body.prepend(outsideEditor, outsideInput, outsideButton);
  });
}

async function expectFocusToStayInReader(page: Page, dialog: Locator): Promise<void> {
  const outsideButton = page.locator("#outside-reader-button");
  const outsideInput = page.locator("#outside-reader-input");
  const outsideEditor = page.locator("#outside-reader-editor");
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    await expect(outsideButton).not.toBeFocused();
    await expect(outsideInput).not.toBeFocused();
    await expect(outsideEditor).not.toBeFocused();
    await expect(dialog).toBeVisible();
  }
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Shift+Tab");
    await expect(outsideButton).not.toBeFocused();
    await expect(outsideInput).not.toBeFocused();
    await expect(outsideEditor).not.toBeFocused();
    await expect(dialog).toBeVisible();
  }
}

test("Chrome viewer keeps RSVP text readable without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "一時停止" }).click();

  const geometry = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      widthOverflow: element.scrollWidth - element.clientWidth,
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });

  expect(geometry.widthOverflow).toBeLessThanOrEqual(1);
  expect(geometry.fontSize).toBeGreaterThanOrEqual(20);
  expect(geometry.lineHeight).toBeGreaterThan(geometry.fontSize);
});

test("Chrome RSVP keeps body quote and aside units on one shared vertical center", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const body = "通常文です。";
  const quote = "「引用文です。」";
  const aside = "（補足です。）";
  const text = `${body}${quote}${aside}後ろの本文です。`;
  await openChrome(page, { text, paused: true });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  const unit = dialog.locator('[data-reader-unit]:visible').first();
  const expectedStarts = [0, body.length, body.length + quote.length];
  const snapshots = [];

  for (const [index, expectedStart] of expectedStarts.entries()) {
    await expect.poll(() => unit.getAttribute("data-source-start")).toBe(String(expectedStart));
    snapshots.push(await unit.evaluate((element) => {
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return {
        kind: element.getAttribute("data-reader-unit-kind"),
        centerY: rectangle.top + rectangle.height / 2,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
      };
    }));

    if (index < expectedStarts.length - 1) {
      await dialog.getByRole("button", { name: "再生" }).click();
      await expect.poll(() => unit.getAttribute("data-source-start")).toBe(String(expectedStarts[index + 1]));
      await pauseReaderIfPlaying(dialog);
    }
  }

  expect(snapshots.map(({ kind }) => kind)).toEqual(["body", "quote", "aside"]);
  const centerYs = snapshots.map(({ centerY }) => centerY);
  expect(Math.max(...centerYs) - Math.min(...centerYs)).toBeLessThanOrEqual(1);
  expect(new Set(snapshots.map(({ fontSize }) => fontSize)).size).toBe(1);
  expect(new Set(snapshots.map(({ lineHeight }) => lineHeight)).size).toBe(1);
  for (const snapshot of snapshots) expect(snapshot.paddingTop).toBe(snapshot.paddingBottom);
});

test("Chrome RSVP centers quote and aside backgrounds without moving surrounding controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const body = "通常文です。";
  const quote = "「引用文です。」";
  const aside = "（補足です。）";
  await openChrome(page, { text: `${body}${quote}${aside}続きの本文です。`, paused: true });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  const unit = dialog.locator('[data-reader-unit]:visible').first();
  const surrounding = await dialog.evaluate((dialogElement) => {
    const selectors = [
      '[data-reader-context-previous]',
      '[data-reader-context-next]',
      '[data-reader-mode-button]',
      '[data-reader-progress]',
    ];
    return selectors.map((selector) => {
      const element = dialogElement.querySelector(selector);
      if (!element) throw new Error(`missing surrounding element: ${selector}`);
      const rectangle = element.getBoundingClientRect();
      if (selector === '[data-reader-context-previous]') {
        return { selector, left: rectangle.left, width: rectangle.width, bottom: innerHeight - rectangle.bottom };
      }
      if (selector === '[data-reader-context-next]') {
        return { selector, left: rectangle.left, width: rectangle.width, top: rectangle.top };
      }
      if (selector === '[data-reader-progress]') {
        return { selector, right: innerWidth - rectangle.right, top: rectangle.top, height: rectangle.height };
      }
      return { selector, left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height };
    });
  });
  const expectedStarts = [0, body.length, body.length + quote.length];
  const snapshots = [];

  for (const [index, expectedStart] of expectedStarts.entries()) {
    await expect.poll(() => unit.getAttribute("data-source-start")).toBe(String(expectedStart));
    snapshots.push(await unit.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const textElement = element.querySelector<HTMLElement>("[data-reader-unit-text]");
      const text = textElement?.getBoundingClientRect() || (() => {
        const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
        if (!textNode) throw new Error("RSVP body text node is missing");
        const range = document.createRange();
        range.selectNodeContents(textNode);
        return range.getBoundingClientRect();
      })();
      const backgroundElement = element.querySelector<HTMLElement>("[data-reader-unit-background]");
      const background = backgroundElement?.getBoundingClientRect() || null;
      return {
        kind: element.getAttribute("data-reader-unit-kind"),
        outerCenterY: outer.top + outer.height / 2,
        textCenterY: text.top + text.height / 2,
        backgroundCenterY: background ? background.top + background.height / 2 : null,
        backgroundWidth: background?.width || null,
        outerWidth: outer.width,
      };
    }));

    if (index < expectedStarts.length - 1) {
      await dialog.getByRole("button", { name: "再生" }).click();
      await expect.poll(() => unit.getAttribute("data-source-start")).toBe(String(expectedStarts[index + 1]));
      await pauseReaderIfPlaying(dialog);
    }
  }

  expect(snapshots.map(({ kind }) => kind)).toEqual(["body", "quote", "aside"]);
  for (const snapshot of snapshots) {
    expect(Math.abs(snapshot.outerCenterY - snapshot.textCenterY)).toBeLessThanOrEqual(1);
  }
  for (const snapshot of snapshots.slice(1)) {
    expect(snapshot.backgroundCenterY).not.toBeNull();
    expect(Math.abs(snapshot.textCenterY - snapshot.backgroundCenterY!)).toBeLessThanOrEqual(1);
    expect(snapshot.backgroundWidth).toBe(snapshot.outerWidth);
  }

  const finalSurrounding = await dialog.evaluate((dialogElement) => {
    const selectors = [
      '[data-reader-context-previous]',
      '[data-reader-context-next]',
      '[data-reader-mode-button]',
      '[data-reader-progress]',
    ];
    return selectors.map((selector) => {
      const element = dialogElement.querySelector(selector);
      if (!element) throw new Error(`missing surrounding element: ${selector}`);
      const rectangle = element.getBoundingClientRect();
      if (selector === '[data-reader-context-previous]') {
        return { selector, left: rectangle.left, width: rectangle.width, bottom: innerHeight - rectangle.bottom };
      }
      if (selector === '[data-reader-context-next]') {
        return { selector, left: rectangle.left, width: rectangle.width, top: rectangle.top };
      }
      if (selector === '[data-reader-progress]') {
        return { selector, right: innerWidth - rectangle.right, top: rectangle.top, height: rectangle.height };
      }
      return { selector, left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height };
    });
  });
  expect(finalSurrounding).toEqual(surrounding);
});

test("Chrome RSVP keeps structural units centered and unclipped at 125% reader zoom", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const cases = [
    { kind: "body", text: "通常文です。" },
    { kind: "quote", text: "「引用文です。」" },
    { kind: "aside", text: "（補足です。）" },
  ] as const;
  for (const structuralCase of cases) {
    await loadViewer(page, "chrome");
    await openChrome(page, { text: structuralCase.text, paused: true });
    const dialog = page.getByRole("dialog", { name: "reader" });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((element) => { (element as HTMLElement).style.zoom = "1.25"; });
    await pauseReaderIfPlaying(dialog);
    const unit = dialog.locator('[data-reader-unit]:visible').first();
    await expect(unit).toHaveAttribute("data-source-start", "0");
    const geometry = await dialog.evaluate((dialogElement) => {
      const element = dialogElement.querySelector<HTMLElement>('[data-reader-unit]');
      if (!element) throw new Error("RSVP unit is missing");
      const dialogRectangle = dialogElement.getBoundingClientRect();
      const rectangle = element.getBoundingClientRect();
      return {
        leftOverflow: dialogRectangle.left - rectangle.left,
        rightOverflow: rectangle.right - dialogRectangle.right,
        centerDeltaY: Math.abs((rectangle.top + rectangle.height / 2) - (dialogRectangle.top + dialogRectangle.height / 2)),
        widthOverflow: element.scrollWidth - element.clientWidth,
        kind: element.getAttribute("data-reader-unit-kind"),
      };
    });
    expect(geometry.kind).toBe(structuralCase.kind);
    expect(geometry.leftOverflow).toBeLessThanOrEqual(1);
    expect(geometry.rightOverflow).toBeLessThanOrEqual(1);
    expect(geometry.centerDeltaY).toBeLessThanOrEqual(1);
    expect(geometry.widthOverflow).toBeLessThanOrEqual(1);
  }
});

test("Chrome viewer exposes touchable controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeVisible();
  const closeBox = await closeButton.boundingBox();
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);

  const backButton = dialog.getByRole("button", { name: "1文戻る" });
  await expect(backButton).toBeVisible();
  const backBox = await backButton.boundingBox();
  expect(backBox?.width).toBeGreaterThanOrEqual(44);
  expect(backBox?.height).toBeGreaterThanOrEqual(44);

  const playPauseButton = dialog.getByRole("button", { name: /^(再生|一時停止)$/ });
  await expect(playPauseButton).toBeVisible();
  const playPauseBox = await playPauseButton.boundingBox();
  expect(playPauseBox?.width).toBeGreaterThanOrEqual(44);
  expect(playPauseBox?.height).toBeGreaterThanOrEqual(44);
});

test("Chrome viewer isolates its controls from hostile page CSS", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByRole("button", { name: "readerを閉じる" })).not.toHaveCSS(
    "background-color",
    "rgb(255, 0, 128)",
  );
});

test("Chrome viewer keeps its focal point after 25 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "一時停止" }).click();

  const initialCenter = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 };
  });

  for (let roundTrip = 0; roundTrip < 25; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await dialog.getByRole("button", { name: "一時停止" }).click();
  }

  const finalCenter = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 };
  });
  expect(Math.abs(finalCenter.x - initialCenter.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(finalCenter.y - initialCenter.y)).toBeLessThanOrEqual(1);
});

test("Chrome viewer preserves the first complete sentence after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 500 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const textMarker = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]').nth(1);
  await placeTextMarker(textMarker, 180);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("text");
  expect(expected.sourceStart).toBe(0);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await pauseReaderIfPlaying(dialog);
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("Chrome viewer resumes at the first complete sentence below a partially visible sentence", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadViewer(page, "chrome");
  const firstSentence = "上端で途中まで見える最初の文です、文章ビューの上端に一部だけ残り、下には次の文を全文表示できるように十分な長さを持たせています、さらに行をまたいで続きます、読書領域の選択規則を確かめるためここまで続きます、".repeat(2) + "最後まで続きます。";
  const secondSentence = "完全に見える二番目の文です。";
  const secondSentenceStart = firstSentence.length + 1;
  const thirdSentence = "さらに後ろの文です、スクロール領域を確実に作るための後続本文です、".repeat(20) + "最後の後続文です。";
  const text = `${firstSentence}\n${secondSentence}\n${thirdSentence}`;
  await openChrome(page, {
    text,
    paused: true,
    readingContext: {
      blocks: [
        { text: firstSentence, kind: "paragraph", level: null, start: 0, end: firstSentence.length },
        { text: secondSentence, kind: "paragraph", level: null, start: secondSentenceStart, end: secondSentenceStart + secondSentence.length },
        { text: thirdSentence, kind: "paragraph", level: null, start: firstSentence.length + secondSentence.length + 2, end: text.length },
      ],
    },
  });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const markers = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]');
  await expect(markers).toHaveCount(3);
  await markers.nth(0).evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += markerRect.top - scrollerRect.top + 40;
  });
  const geometry = await markers.evaluateAll((elements) => {
    const scroller = elements[0]?.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const scrollerRect = scroller.getBoundingClientRect();
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, scrollerTop: scrollerRect.top, scrollerBottom: scrollerRect.bottom };
    });
  });
  expect(geometry[0]?.top).toBeLessThan(geometry[0]?.scrollerTop ?? 0);
  expect(geometry[0]?.bottom).toBeGreaterThan(geometry[0]?.scrollerTop ?? 0);
  expect(geometry[1]?.top).toBeGreaterThanOrEqual((geometry[1]?.scrollerTop ?? 0) + 72);
  expect(geometry[1]?.bottom).toBeLessThanOrEqual((geometry[1]?.scrollerBottom ?? 0) - 112);

  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const selectedUnit = dialog.locator('[data-reader-unit]:visible').first();
  await expect(selectedUnit).toHaveAttribute("data-source-start", String(secondSentenceStart));
  await expect(selectedUnit).toContainText("完全に見える二番目の");
});

test("Chrome viewer falls back to the visible sentence when one long sentence cannot fit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await loadViewer(page, "chrome");
  const leadingSentence = "画面より前の文です。";
  const longSentence = "画面より高い長文がここから始まり、読書領域に全文を収めることができないまま何行も続き、上端から見えているこの文の文頭へ戻れることを確認するための内容をさらに重ね、まだまだ下へ伸びていく文章として表示されます、".repeat(12) + "最後まで一つの文として扱います。";
  const trailingSentence = "長文の後ろの文です。";
  const text = `${leadingSentence}\n${longSentence}\n${trailingSentence}`;
  await openChrome(page, {
    text,
    paused: true,
    readingContext: {
      blocks: [
        { text: leadingSentence, kind: "paragraph", level: null, start: 0, end: leadingSentence.length },
        { text: longSentence, kind: "paragraph", level: null, start: leadingSentence.length + 1, end: leadingSentence.length + 1 + longSentence.length },
        { text: trailingSentence, kind: "paragraph", level: null, start: leadingSentence.length + longSentence.length + 2, end: text.length },
      ],
    },
  });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const markers = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]');
  await expect(markers).toHaveCount(3);
  await markers.nth(1).evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += markerRect.top - scrollerRect.top + 20;
  });
  const longMarkerGeometry = await markers.nth(1).evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return { markerTop: markerRect.top, markerBottom: markerRect.bottom, scrollerTop: scrollerRect.top, scrollerBottom: scrollerRect.bottom, scrollerHeight: scrollerRect.height };
  });
  expect(longMarkerGeometry.markerTop).toBeLessThan(longMarkerGeometry.scrollerTop);
  expect(longMarkerGeometry.markerBottom).toBeGreaterThan(longMarkerGeometry.scrollerBottom);
  expect(longMarkerGeometry.markerBottom - longMarkerGeometry.markerTop).toBeGreaterThan(longMarkerGeometry.scrollerHeight);

  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  await expect(dialog.locator('[data-reader-unit]:visible').first()).toContainText("画面より高い長文");
});

test("Chrome viewer preserves sentence selection across heading quote and preformatted blocks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadViewer(page, "chrome");
  const heading = "構造化された本文";
  const quote = "「引用ブロックの文です、構造化本文の選択対象を確認するための引用です、」".repeat(8) + "最後の引用文です。」";
  const preformatted = "preformatted blockの文です。";
  const preformattedStart = heading.length + quote.length + 2;
  const following = "最後に続く本文です、後続のスクロール領域を作るための文章です、".repeat(16) + "最後の本文です。";
  const text = `${heading}\n${quote}\n${preformatted}\n${following}`;
  await openChrome(page, {
    text,
    paused: true,
    readingContext: {
      blocks: [
        { text: heading, kind: "heading", level: 1, start: 0, end: heading.length },
        { text: quote, kind: "quote", level: null, start: heading.length + 1, end: heading.length + 1 + quote.length },
        { text: preformatted, kind: "preformatted", level: null, start: preformattedStart, end: preformattedStart + preformatted.length },
        { text: following, kind: "paragraph", level: null, start: heading.length + quote.length + preformatted.length + 3, end: text.length },
      ],
    },
  });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const textView = dialog.locator('[data-reader-text-shell="true"]');
  await expect(textView.locator("h1")).toHaveText(heading);
  await expect(textView.locator("blockquote")).toHaveText(quote);
  await expect(textView.locator("pre")).toHaveText(preformatted);
  const preMarker = textView.locator('pre [data-reader-position-kind="text"][data-reader-text-anchor]');
  await expect(preMarker).toHaveCount(1);
  await preMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += markerRect.top - scrollerRect.top - 140;
  });
  const preGeometry = await preMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return { markerTop: markerRect.top, markerBottom: markerRect.bottom, scrollerTop: scrollerRect.top, scrollerBottom: scrollerRect.bottom };
  });
  expect(preGeometry.markerTop).toBeGreaterThanOrEqual(preGeometry.scrollerTop + 72);
  expect(preGeometry.markerBottom).toBeLessThanOrEqual(preGeometry.scrollerBottom - 112);

  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const selectedUnit = dialog.locator('[data-reader-unit]:visible').first();
  await expect(selectedUnit).toHaveAttribute("data-source-start", String(preformattedStart));
});

test("Chrome viewer does not move to the previous sentence during repeated text and RSVP round trips", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadViewer(page, "chrome");
  const firstSentence = "最初の前文です、選択文の上に十分な行を作り、スクロールしても選択対象の文頭を明確に判定できるようにするための前置きです、".repeat(2) + "前文の最後です。";
  const selectedSentence = "往復しても前の文へ戻らない選択文です。";
  const selectedSentenceStart = firstSentence.length + 1;
  const followingSentence = "選択文の後ろです、往復テストのスクロール領域を維持するための後続本文です、".repeat(18) + "後続文の最後です。";
  const text = `${firstSentence}\n${selectedSentence}\n${followingSentence}`;
  await openChrome(page, {
    text,
    paused: true,
    readingContext: {
      blocks: [
        { text: firstSentence, kind: "paragraph", level: null, start: 0, end: firstSentence.length },
        { text: selectedSentence, kind: "paragraph", level: null, start: selectedSentenceStart, end: selectedSentenceStart + selectedSentence.length },
        { text: followingSentence, kind: "paragraph", level: null, start: firstSentence.length + selectedSentence.length + 2, end: text.length },
      ],
    },
  });

  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const selectedMarker = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]').nth(1);
  await expect(selectedMarker).toHaveCount(1);
  await selectedMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    const markerRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += markerRect.top - scrollerRect.top - 140;
  });

  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const selectedUnit = dialog.locator('[data-reader-unit]:visible').first();
  await expect(selectedUnit).toHaveAttribute("data-source-start", String(selectedSentenceStart));

  for (let roundTrip = 0; roundTrip < 6; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await pauseReaderIfPlaying(dialog);
    await expect(selectedUnit).toHaveAttribute("data-source-start", String(selectedSentenceStart));
  }
});

test("Chrome viewer preserves an image position after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  await page.getByRole("button", { name: "Chrome readerを開く" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const imageMarker = dialog.locator('[data-reader-position-kind="figure"]').first();
  await imageMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    scroller.style.paddingBottom = "600px";
  });
  await placeTextMarker(imageMarker, 100);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("figure");
  expect(expected.sourceStart).toBe(44);
  expect(expected.figureIndex).toBe(0);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("Chrome viewer preserves the sentence after an image after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 500 });
  await loadViewer(page, "chrome");
  await page.getByRole("button", { name: "Chrome readerを開く" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const textMarkers = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]');
  const afterImageMarker = textMarkers.last();
  await scrollTextToEnd(afterImageMarker);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("text");
  expect(expected.sourceStart).toBe(52);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await pauseReaderIfPlaying(dialog);
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("mobile viewer keeps RSVP text readable without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  await dialog.getByRole("button", { name: "一時停止" }).click();

  const geometry = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      widthOverflow: element.scrollWidth - element.clientWidth,
      fontSize: Number.parseFloat(style.fontSize),
    };
  });

  expect(geometry.widthOverflow).toBeLessThanOrEqual(1);
  expect(geometry.fontSize).toBeGreaterThanOrEqual(20);
});

test("mobile viewer exposes touchable controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });

  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeVisible();
  const closeBox = await closeButton.boundingBox();
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);

  const backButton = dialog.getByRole("button", { name: "1文戻る" });
  await expect(backButton).toBeVisible();
  const backBox = await backButton.boundingBox();
  expect(backBox?.width).toBeGreaterThanOrEqual(44);
  expect(backBox?.height).toBeGreaterThanOrEqual(44);

  const playPauseButton = dialog.getByRole("button", { name: /^(再生|一時停止)$/ });
  await expect(playPauseButton).toBeVisible();
  const playPauseBox = await playPauseButton.boundingBox();
  expect(playPauseBox?.width).toBeGreaterThanOrEqual(44);
  expect(playPauseBox?.height).toBeGreaterThanOrEqual(44);
});

test("mobile viewer keeps its focal point after 25 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  await dialog.getByRole("button", { name: "一時停止" }).click();

  const initialCenter = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 };
  });

  for (let roundTrip = 0; roundTrip < 25; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  }

  await expect(dialog.getByRole("button", { name: "一時停止" })).toBeVisible();
  const finalCenter = await dialog.locator("[data-reader-unit]").evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { x: rectangle.left + rectangle.width / 2, y: rectangle.top + rectangle.height / 2 };
  });
  expect(Math.abs(finalCenter.x - initialCenter.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(finalCenter.y - initialCenter.y)).toBeLessThanOrEqual(1);
});

test("mobile viewer preserves the first complete sentence after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 500 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const textMarker = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]').nth(1);
  await placeTextMarker(textMarker, 180);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("text");
  expect(expected.sourceStart).toBe(0);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await pauseReaderIfPlaying(dialog);
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("mobile viewer preserves an image position after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const imageMarker = dialog.locator('[data-reader-position-kind="figure"]').first();
  await imageMarker.evaluate((element) => {
    const scroller = element.closest<HTMLElement>("[data-reader-text-scroller], .text-view");
    if (!scroller) throw new Error("text scroller not found");
    scroller.style.paddingBottom = "600px";
  });
  await placeTextMarker(imageMarker, 100);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("figure");
  expect(expected.sourceStart).toBe(44);
  expect(expected.figureIndex).toBe(0);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("mobile viewer preserves the sentence after an image after 50 mode round trips", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 500 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await pauseReaderIfPlaying(dialog);
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  const textMarkers = dialog.locator('[data-reader-position-kind="text"][data-reader-text-anchor]');
  const afterImageMarker = textMarkers.last();
  await scrollTextToEnd(afterImageMarker);
  await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  await pauseReaderIfPlaying(dialog);
  const expected = await readReaderPosition(dialog);
  expect(expected.kind).toBe("text");
  expect(expected.sourceStart).toBe(52);

  for (let roundTrip = 0; roundTrip < 50; roundTrip += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await pauseReaderIfPlaying(dialog);
    expect(await readReaderPosition(dialog)).toEqual(expected);
  }
});

test("Chrome viewer pauses for an image and exposes its context", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible({ timeout: 15_000 });
  await expect(figure.getByRole("img", { name: "本文の読書フロー図" })).toBeVisible();
  await expect(figure).toContainText("読書フローの図");
  await expect(dialog.getByRole("button", { name: "続きを読む" })).toBeVisible();
  await dialog.getByRole("button", { name: "続きを読む" }).click();
  await expect(figure).toBeHidden();
  await expect(dialog.locator("[data-reader-unit]")).toBeVisible();
});

test("mobile viewer pauses for an image and exposes its context", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible({ timeout: 15_000 });
  await expect(figure.getByRole("img", { name: "本文の読書フロー図" })).toBeVisible();
  await expect(figure).toContainText("読書フローの図");
  await expect(dialog.getByRole("button", { name: "続きを読む" })).toBeVisible();
  await dialog.getByRole("button", { name: "続きを読む" }).click();
  await expect(figure).toBeHidden();
  await expect(dialog.locator("[data-reader-unit]")).toBeVisible();
});

test("Chrome viewer toggles a ready image surface with touch and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/e2e/fixtures/article.html?viewer=chrome&image=immediate&figure=first");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await openChrome(page, { paused: true, figureFirst: true, image: "immediate" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible();
  const surface = figure.locator('[data-reader-image-surface]');
  await expect(surface).toHaveAccessibleName("画像を明るく表示");
  await expect(surface).toHaveAttribute("aria-pressed", "false");
  await expect(figure.locator("[data-reader-figure-indicator]")).toHaveCount(0);

  await surface.click();
  await expect(surface).toHaveAttribute("aria-pressed", "true");
  await expect(surface).toHaveAccessibleName("画像を暗く表示");
  await surface.focus();
  await page.keyboard.press("Space");
  await expect(surface).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(surface).toHaveAttribute("aria-pressed", "true");
});

test.describe("mobile viewer touch controls", () => {
  test.use({ hasTouch: true });

  test("toggles a ready image surface with tap and keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&image=immediate&figure=first");
    await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
    await openMobile(page, { image: "immediate", figureFirst: true });

    const dialog = page.getByRole("dialog", { name: "reader" });
    const figure = dialog.getByRole("figure", { name: "本文画像" });
    await expect(figure).toBeVisible();
    const surface = figure.locator('[data-reader-image-surface]');
    await expect(surface).toHaveAccessibleName("画像を明るく表示");
    await expect(surface).toHaveAttribute("aria-pressed", "false");

    await surface.tap();
    await expect(surface).toHaveAttribute("aria-pressed", "true");
    await expect(surface).toHaveAccessibleName("画像を暗く表示");
    await surface.focus();
    await page.keyboard.press("Space");
    await expect(surface).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(surface).toHaveAttribute("aria-pressed", "true");
  });
});

test("Chrome viewer shows delayed figure loading and resumes after a 404", async ({ page }) => {
  const releaseImage = await openFigureViewer(page, "chrome", { paused: true, cacheKey: "chrome-delayed-figure" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible();
  await expect(figure.locator("[data-reader-figure-status]")).toBeVisible();
  await expect(figure.locator("[data-reader-figure-status]")).toHaveText(/画像を準備しています/u);
  await expect(figure.locator("[data-reader-figure-indicator]")).toBeVisible();
  await expect(figure.locator("[data-reader-figure-description]")).toBeVisible();
  await expect(figure.locator("[data-reader-image-surface]")).toBeHidden();
  await expect(figure.locator("[data-reader-image-surface]")).toBeDisabled();
  await expect(figure.locator("[data-reader-image-surface]")).toHaveAttribute("aria-hidden", "true");
  await expect(figure.locator("[data-reader-figure-description]")).toHaveText("本文の読書フロー図。先頭画像");
  await releaseImage();
  await expect(figure.locator("[data-reader-figure-status]")).toBeHidden({ timeout: 5_000 });
  await dialog.getByRole("button", { name: "続きを読む" }).click();
  await expect(dialog.locator("[data-reader-unit]")).toContainText("画像の直後から");
});

for (const image of ["missing", "broken"] as const) {
  test(`Chrome viewer keeps playback available for a ${image} figure`, async ({ page }) => {
    await page.goto(`/tests/e2e/fixtures/article.html?viewer=chrome&image=${image}&figure=first`);
    await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
    await openChrome(page, { paused: true, figureFirst: true, image });

    const dialog = page.getByRole("dialog", { name: "reader" });
    const figure = dialog.getByRole("figure", { name: "本文画像" });
    await expect(figure.locator("[data-reader-figure-status]")).toBeVisible();
    await expect(figure.locator("[data-reader-figure-status]")).toHaveText("画像を読み込めませんでした");
    await expect(figure.locator("[data-reader-image-surface]")).toHaveCount(0);
    await expect(figure.locator("[data-reader-figure-description]")).toBeVisible();
    await expect(figure.getByRole("button", { name: /画像を/u })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "続きを読む" })).toBeVisible();
    await dialog.getByRole("button", { name: "続きを読む" }).click();
    await expect(dialog.locator("[data-reader-unit]")).toContainText("画像の直後から");
  });
}

test("mobile viewer shows delayed figure loading and resumes after a 404", async ({ page }) => {
  const releaseImage = await openFigureViewer(page, "mobile", { cacheKey: "mobile-delayed-figure" });

  const dialog = page.getByRole("dialog", { name: "reader" });
  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible();
  await expect(figure.locator("[data-reader-figure-status]")).toBeVisible();
  await expect(figure.locator("[data-reader-figure-status]")).toHaveText(/画像を準備しています/u);
  await expect(figure.locator("[data-reader-figure-indicator]")).toBeVisible();
  await expect(figure.locator("[data-reader-figure-description]")).toBeVisible();
  await expect(figure.locator("[data-reader-image-surface]")).toBeHidden();
  await expect(figure.locator("[data-reader-image-surface]")).toBeDisabled();
  await expect(figure.locator("[data-reader-image-surface]")).toHaveAttribute("aria-hidden", "true");
  await expect(figure.locator("[data-reader-figure-description]")).toHaveText("本文の読書フロー図。先頭画像");
  await releaseImage();
  await expect(figure.locator("[data-reader-figure-status]")).toBeHidden({ timeout: 5_000 });

  await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&image=missing&figure=first");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await openMobile(page);
  const failedDialog = page.getByRole("dialog", { name: "reader" });
  const failedFigure = failedDialog.getByRole("figure", { name: "本文画像" });
  await expect(failedFigure.locator("[data-reader-figure-status]")).toHaveText("画像を読み込めませんでした");
  await expect(failedFigure.locator("[data-reader-image-surface]")).toHaveCount(0);
  await expect(failedFigure.locator("[data-reader-figure-description]")).toBeVisible();
  await expect(failedFigure.getByRole("button", { name: /画像を/u })).toHaveCount(0);
  await failedDialog.getByRole("button", { name: "続きを読む" }).click();
  await expect(failedDialog.locator("[data-reader-unit]")).toContainText("画像の直後から");
});

async function openFigureViewer(
  page: Page,
  viewer: "chrome" | "mobile",
  options: ChromeOpenOptions & MobileOpenOptions,
): Promise<() => Promise<void>> {
  const baseCacheKey = options.cacheKey || `${viewer}-${options.alt || "default-alt"}-${options.caption || "default-caption"}`;
  const cacheKey = `${baseCacheKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const delayedImagePattern = "**/image/delayed/**";
  let requestStartedResolve: () => void = () => {};
  let releaseImageResolve: () => void = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    requestStartedResolve = resolve;
  });
  const releaseImagePromise = new Promise<void>((resolve) => {
    releaseImageResolve = resolve;
  });
  await page.route(delayedImagePattern, async (route) => {
    requestStartedResolve();
    await releaseImagePromise;
    await route.continue();
  });
  await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}&image=delayed&figure=first`);
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/image/delayed/"),
    { timeout: 5_000 },
  );
  if (viewer === "chrome") {
    await openChrome(page, {
      ...options,
      paused: true,
      figureFirst: true,
      image: "delayed",
      cacheKey,
      imageDelay: 500,
    });
  } else {
    await openMobile(page, {
      ...options,
      figureFirst: true,
      image: "delayed",
      cacheKey,
      imageDelay: 500,
    });
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("delayed figure image request did not start")), 5_000);
    requestStarted.then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    releaseImageResolve();
    await responsePromise;
  };
}

const FIGURE_DESCRIPTION_CASES = [
  { name: "alt only", alt: "遅延画像のalt説明", caption: "", description: "遅延画像のalt説明", captionCount: 0 },
  { name: "caption only", alt: "", caption: "遅延画像のcaption説明", description: "遅延画像のcaption説明", captionCount: 1 },
  { name: "neither alt nor caption", alt: "", caption: "", description: "本文画像", captionCount: 0 },
] as const;

for (const viewer of ["chrome", "mobile"] as const) {
  for (const figureCase of FIGURE_DESCRIPTION_CASES) {
    test(`${viewer} viewer describes a delayed figure with ${figureCase.name}`, async ({ page }) => {
      const releaseImage = await openFigureViewer(page, viewer, figureCase);
      const dialog = page.getByRole("dialog", { name: "reader" });
      const figure = dialog.getByRole("figure", { name: "本文画像" });
      const status = figure.locator("[data-reader-figure-status]");
      const description = figure.locator("[data-reader-figure-description]");
      await expect(status).toBeVisible();
      await expect(figure.locator("[data-reader-figure-indicator]")).toBeVisible();
      await expect(description).toBeVisible();
      await expect(description).toHaveText(figureCase.description);
      await expect(figure.locator("figcaption")).toHaveCount(figureCase.captionCount);

      await releaseImage();
      await expect(status).toBeHidden({ timeout: 5_000 });
      await expect(description).toBeHidden();
    });
  }
}

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} viewer ignores a delayed figure completion after close`, async ({ page }) => {
    const releaseImage = await openFigureViewer(page, viewer, {});
    const dialog = page.getByRole("dialog", { name: "reader" });
    await expect(dialog.getByRole("figure", { name: "本文画像" })).toBeVisible();
    await dialog.getByRole("button", { name: "readerを閉じる" }).click();
    await expect(dialog).toBeHidden();
    await releaseImage();
    await page.waitForTimeout(750);
    await expect(page.locator("[data-reader-figure-status]")).toHaveCount(0);
  });
}

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} viewer treats a complete image as ready when decode rejects`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        configurable: true,
        value: () => Promise.reject(new Error("decode rejected")),
      });
    });
    await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}&image=immediate&figure=first`);
    await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
    if (viewer === "chrome") await openChrome(page, { paused: true, figureFirst: true, image: "immediate" });
    else await openMobile(page, { figureFirst: true, image: "immediate" });

    const figure = page.getByRole("dialog", { name: "reader" }).getByRole("figure", { name: "本文画像" });
    await expect(figure.locator("[data-reader-image-surface]")).toBeVisible();
    await expect(figure.locator("[data-reader-figure-status]")).toBeHidden();
  });
}

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} viewer fails an invalid image when decode rejects`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        configurable: true,
        value: () => Promise.reject(new Error("decode rejected")),
      });
    });
    await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}&image=broken&figure=first`);
    await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
    if (viewer === "chrome") await openChrome(page, { paused: true, figureFirst: true, image: "broken" });
    else await openMobile(page, { figureFirst: true, image: "broken" });

    const figure = page.getByRole("dialog", { name: "reader" }).getByRole("figure", { name: "本文画像" });
    await expect(figure.locator("[data-reader-figure-status]")).toHaveText("画像を読み込めませんでした");
    await expect(figure.locator("[data-reader-image-surface]")).toHaveCount(0);
  });
}

for (const viewer of ["chrome", "mobile"] as const) {
  for (const image of ["vertical", "horizontal", "transparent", "huge"] as const) {
    test(`${viewer} viewer keeps a ${image} figure within safe controls`, async ({ page }) => {
      const viewport = viewer === "chrome" ? { width: 1280, height: 800 } : { width: 390, height: 844 };
      await page.setViewportSize(viewport);
      await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}&image=${image}&figure=first`);
      await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
      if (viewer === "chrome") await openChrome(page, { paused: true, figureFirst: true, image });
      else await openMobile(page, { figureFirst: true, image });

      const dialog = page.getByRole("dialog", { name: "reader" });
      const figure = dialog.getByRole("figure", { name: "本文画像" });
      const surface = figure.locator("[data-reader-image-surface]");
      await expect(surface).toBeVisible();
      const intrinsicDimensions = {
        vertical: { width: 240, height: 1200 },
        horizontal: { width: 1200, height: 240 },
        transparent: { width: 640, height: 480 },
        huge: { width: 4000, height: 3000 },
      }[image];
      await expect.poll(() => surface.locator("img").evaluate((element) => ({
        width: (element as HTMLImageElement).naturalWidth,
        height: (element as HTMLImageElement).naturalHeight,
      }))).toEqual(intrinsicDimensions);
      const geometry = await surface.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      });
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(geometry.left).toBeGreaterThanOrEqual(dialogBox!.x);
      expect(geometry.right).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
      expect(geometry.top).toBeGreaterThanOrEqual(dialogBox!.y);
      expect(geometry.bottom).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
      for (const control of [
        dialog.getByRole("button", { name: "readerを閉じる" }),
        dialog.getByRole("button", { name: /^(再生|一時停止|続きを読む)$/ }),
      ]) {
        if (await control.count() === 0) continue;
        const controlBox = await control.first().boundingBox();
        if (!controlBox) continue;
        expect(geometry.right <= controlBox.x
          || geometry.left >= controlBox.x + controlBox.width
          || geometry.bottom <= controlBox.y
          || geometry.top >= controlBox.y + controlBox.height).toBe(true);
      }
      await expect(dialog.getByRole("button", { name: "続きを読む" })).toBeVisible();
      await dialog.getByRole("button", { name: "続きを読む" }).click();
      await expect(dialog.locator("[data-reader-unit]")).toContainText("画像の直後から");
    });
  }
}

test("Chrome viewer traps focus and restores the launch button after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("aria-live", "off");
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("aria-atomic", "false");
  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeFocused();
  await dialog.getByRole("button", { name: "一時停止" }).click();
  await expect(dialog.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);

  const firstControl = dialog.getByRole("button", { name: "実ブラウザで読む" });
  await firstControl.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /^(再生|一時停止)$/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstControl).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launchButton).toBeFocused();
});

test("Chrome text viewer traps focus and restores the launch button after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  await addAccessibilityFixture(page);
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "文章で読む" }).click();
  await expect(dialog.locator("[data-reader-text-shell]")).toBeVisible();
  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  const rsvpModeButton = dialog.getByRole("button", { name: "RSVPで読む" });
  await expect(closeButton).toBeFocused();

  await rsvpModeButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rsvpModeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: false, head: true });
  await expect(launchButton).toBeFocused();
});

test("mobile viewer traps focus and restores the launch button after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  const launchButton = page.getByRole("button", { name: "readerで読む" });
  await launchButton.click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("aria-live", "off");
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("aria-atomic", "false");
  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /^(再生|一時停止)$/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launchButton).toBeFocused();
});

test("mobile text viewer keeps keyboard focus inside the Reader and restores it after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await addAccessibilityFixture(page);
  const launchButton = page.getByRole("button", { name: "readerで読む" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "一時停止" }).click();
  await expect(dialog).toMatchAriaSnapshot(`
    - dialog "reader":
      - /children: contain
      - banner:
        - /children: contain
        - button "readerを閉じる"
      - contentinfo:
        - /children: contain
        - button "文章で読む"
        - button "再生" [pressed=false]
  `);

  await dialog.getByRole("button", { name: "文章で読む" }).click();
  await expect(dialog.locator(".text-view")).toBeVisible();
  await dialog.getByRole("button", { name: "RSVPで読む" }).focus();
  await expectFocusToStayInReader(page, dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: false, head: true });
  await expect(launchButton).toBeFocused();
});

test("mobile RSVP viewer does not capture Space or ArrowLeft from editable controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "一時停止" }).click();
  const initialUnit = await dialog.locator("[data-reader-unit]").getAttribute("data-source-start");
  expect(initialUnit).not.toBeNull();

  await dialog.evaluate((reader) => {
    const content = reader.querySelector(".content");
    if (!content) throw new Error("Reader content is missing");
    const input = document.createElement("input");
    input.id = "reader-editable-input";
    input.setAttribute("aria-label", "Reader内の入力");
    input.value = "入力";
    const textarea = document.createElement("textarea");
    textarea.id = "reader-editable-textarea";
    textarea.setAttribute("aria-label", "Reader内の複数行入力");
    textarea.value = "複数行";
    const select = document.createElement("select");
    select.id = "reader-editable-select";
    select.setAttribute("aria-label", "Reader内の選択");
    select.append(new Option("選択肢1", "one"), new Option("選択肢2", "two"));
    select.value = "two";
    const editor = document.createElement("div");
    editor.id = "reader-editable-content";
    editor.contentEditable = "true";
    editor.setAttribute("aria-label", "Reader内の編集領域");
    editor.textContent = "編集";
    for (const element of [input, textarea, select]) {
      Object.assign(element.style, { position: "fixed", left: "8px", top: "8px", zIndex: "10" });
      content.append(element);
    }
    Object.assign(editor.style, { position: "fixed", left: "8px", top: "8px", zIndex: "10" });
    content.append(editor);
  });

  await page.locator("#reader-editable-input").focus();
  await expect(page.locator("#reader-editable-input")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#reader-editable-input")).toHaveValue("入力 ");
  await expect.poll(() => page.locator("#reader-editable-input").evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(2);
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("data-source-start", initialUnit!);

  await page.locator("#reader-editable-textarea").focus();
  await expect(page.locator("#reader-editable-textarea")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#reader-editable-textarea")).toHaveValue("複数行 ");
  await expect.poll(() => page.locator("#reader-editable-textarea").evaluate((element) => (element as HTMLTextAreaElement).selectionStart)).toBe(3);
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("data-source-start", initialUnit!);

  await page.locator("#reader-editable-select").focus();
  await expect(page.locator("#reader-editable-select")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#reader-editable-select")).toHaveValue("two");
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("data-source-start", initialUnit!);

  await page.evaluate(() => {
    const keyEvents: Array<{ key: string; defaultPrevented: boolean }> = [];
    window.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "ArrowLeft") {
        keyEvents.push({ key: event.key, defaultPrevented: event.defaultPrevented });
      }
    });
    (window as typeof window & { readerEditableKeyEvents?: typeof keyEvents }).readerEditableKeyEvents = keyEvents;
  });
  await page.locator("#reader-editable-content").focus();
  await expect(page.locator("#reader-editable-content")).toBeFocused();
  await page.locator("#reader-editable-content").press("Space");
  await page.locator("#reader-editable-content").press("ArrowLeft");
  const keyEvents = await page.evaluate(() => (window as typeof window & {
    readerEditableKeyEvents?: Array<{ key: string; defaultPrevented: boolean }>;
  }).readerEditableKeyEvents);
  expect(keyEvents).toEqual([
    { key: " ", defaultPrevented: false },
    { key: "ArrowLeft", defaultPrevented: false },
  ]);
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await expect(dialog.locator("[data-reader-unit]")).toHaveAttribute("data-source-start", initialUnit!);
});

test("mobile viewer suppresses control transforms and animations with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();

  const normalMotion = await dialog.evaluate((reader) => {
    const controls = [
      reader.querySelector<HTMLElement>(".mode-button"),
      reader.querySelector<HTMLElement>('[aria-label="readerを閉じる"]'),
      reader.querySelector<HTMLElement>('[aria-label="1文戻る"]'),
      reader.querySelector<HTMLElement>('[aria-label="一時停止"]'),
    ];
    return {
      closeTransitionDuration: getComputedStyle(controls[1]!).transitionDuration,
      transportTransitionDuration: getComputedStyle(controls[2]!).transitionDuration,
    };
  });
  const modeButton = dialog.getByRole("button", { name: "文章で読む" });
  const modeBox = await modeButton.boundingBox();
  expect(modeBox).not.toBeNull();
  await page.mouse.move(modeBox!.x + modeBox!.width / 2, modeBox!.y + modeBox!.height / 2);
  await page.mouse.down();
  const normalActiveTransform = await modeButton.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.up();

  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(dialog).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await page.getByRole("button", { name: "readerで読む" }).click();
  const reducedDialog = page.getByRole("dialog", { name: "reader" });
  await expect(reducedDialog).toBeVisible();
  const reducedMotion = await reducedDialog.evaluate((reader) => {
    const controls = [
      reader.querySelector<HTMLElement>(".mode-button"),
      reader.querySelector<HTMLElement>('[aria-label="readerを閉じる"]'),
      reader.querySelector<HTMLElement>('[aria-label="1文戻る"]'),
      reader.querySelector<HTMLElement>('[aria-label="一時停止"]'),
    ];
    return {
      closeTransitionDuration: getComputedStyle(controls[1]!).transitionDuration,
      transportTransitionDuration: getComputedStyle(controls[2]!).transitionDuration,
      animationCount: reader.getAnimations({ subtree: true }).length,
    };
  });
  const reducedModeButton = reducedDialog.getByRole("button", { name: "文章で読む" });
  const reducedModeBox = await reducedModeButton.boundingBox();
  expect(reducedModeBox).not.toBeNull();
  await page.mouse.move(reducedModeBox!.x + reducedModeBox!.width / 2, reducedModeBox!.y + reducedModeBox!.height / 2);
  await page.mouse.down();
  const reducedActiveTransform = await reducedModeButton.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.up();

  expect(normalMotion.closeTransitionDuration).not.toBe("0s");
  expect(normalMotion.transportTransitionDuration).not.toBe("0s");
  expect(reducedMotion.closeTransitionDuration).toBe("0s");
  expect(reducedMotion.transportTransitionDuration).toBe("0s");
  expect(reducedMotion.animationCount).toBe(0);
  expect(reducedActiveTransform).not.toBe(normalActiveTransform);
});

test("mobile viewer keeps a 200 percent text layout within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "文章で読む" }).click();
  await expect(dialog.locator(".text-view")).toBeVisible();

  const layout = await dialog.evaluate((reader) => {
    const textView = reader.querySelector<HTMLElement>(".text-view");
    const article = reader.querySelector<HTMLElement>(".article");
    const modeButton = reader.querySelector<HTMLElement>(".mode-button");
    if (!textView || !article || !modeButton) throw new Error("Reader text layout is missing");
    const baselineFontSize = Number.parseFloat(getComputedStyle(article).fontSize);
    article.style.fontSize = `${baselineFontSize * 2}px`;
    const zoomedFontSize = Number.parseFloat(getComputedStyle(article).fontSize);
    const dialogRect = reader.getBoundingClientRect();
    const modeRect = modeButton.getBoundingClientRect();
    return {
      baselineFontSize,
      zoomedFontSize,
      textOverflow: textView.scrollWidth - textView.clientWidth,
      articleOverflow: article.scrollWidth - article.clientWidth,
      modeRight: modeRect.right,
      dialogRight: dialogRect.right,
      closeBox: reader.querySelector<HTMLElement>('[aria-label="readerを閉じる"]')?.getBoundingClientRect(),
    };
  });

  expect(layout.zoomedFontSize).toBeCloseTo(layout.baselineFontSize * 2, 1);
  expect(layout.textOverflow).toBeLessThanOrEqual(0);
  expect(layout.articleOverflow).toBeLessThanOrEqual(0);
  expect(layout.modeRight).toBeLessThanOrEqual(layout.dialogRight);
  expect(layout.closeBox?.width).toBeGreaterThanOrEqual(44);
  expect(layout.closeBox?.height).toBeGreaterThanOrEqual(44);
});

test("mobile viewer keeps controls and figures usable in landscape and restores the page after close", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&figure=first&image=horizontal");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
  await page.evaluate(() => window.scrollTo({ top: 200, left: 0, behavior: "auto" }));
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  const figure = dialog.getByRole("figure", { name: "本文画像" });
  await expect(figure).toBeVisible();
  const figureSurface = figure.locator("[data-reader-image-surface]");
  await expect(figureSurface).toBeVisible();

  const readerRect = await dialog.boundingBox();
  const figureRect = await figureSurface.boundingBox();
  const closeRect = await dialog.getByRole("button", { name: "readerを閉じる" }).boundingBox();
  const modeRect = await dialog.getByRole("button", { name: "文章で読む" }).boundingBox();
  expect(readerRect).not.toBeNull();
  expect(figureRect).not.toBeNull();
  expect(closeRect).not.toBeNull();
  expect(modeRect).not.toBeNull();

  expect(figureRect!.x).toBeGreaterThanOrEqual(readerRect!.x);
  expect(figureRect!.x + figureRect!.width).toBeLessThanOrEqual(readerRect!.x + readerRect!.width);
  expect(figureRect!.y).toBeGreaterThanOrEqual(readerRect!.y);
  expect(figureRect!.y + figureRect!.height).toBeLessThanOrEqual(readerRect!.y + readerRect!.height);
  expect(closeRect!.width).toBeGreaterThanOrEqual(44);
  expect(closeRect!.height).toBeGreaterThanOrEqual(44);
  expect(modeRect!.width).toBeGreaterThanOrEqual(120);
  expect(modeRect!.height).toBeGreaterThanOrEqual(44);

  await dialog.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "readerで読む" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
});

test("Chrome viewer keeps background inert and keyboard focus inside the modal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "chrome");
  await addAccessibilityFixture(page);
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog.getByRole("button", { name: "readerを閉じる" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: true, head: true });
  await expectFocusToStayInReader(page, dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: false, head: true });
  await expect(launchButton).toBeFocused();
});

test("mobile viewer keeps background inert and keyboard focus inside the modal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadViewer(page, "mobile");
  await addAccessibilityFixture(page);
  const launchButton = page.getByRole("button", { name: "readerで読む" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog.getByRole("button", { name: "readerを閉じる" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: true, head: true });
  await expectFocusToStayInReader(page, dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ({ body: document.body.inert, head: document.head.inert }))).toEqual({ body: false, head: true });
  await expect(launchButton).toBeFocused();
});

test("generated assets extract the real fixture article", async ({ page }) => {
  await loadViewer(page, "mobile");
  const extraction = await page.evaluate(() => {
    const content = (globalThis as typeof globalThis & {
      ReaderE2E: { extract(): { text: string; readingContext: { figures: Array<{ alt: string }> } } };
    }).ReaderE2E.extract();
    return { text: content.text, figureAlts: content.readingContext.figures.map((figure) => figure.alt) };
  });

  expect(extraction.text).toContain("画像の後に続く文章です");
  expect(extraction.figureAlts).toContain("本文の読書フロー図");
});

test("real WASM session keeps close, stale preparation, and stale tick inert", async ({ page }) => {
  await loadViewer(page, "chrome");
  const trace = await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & {
      ReaderSession: {
        init(): Promise<void>;
        create(): { id: number; state: unknown; destroyed: boolean };
        dispatch(
          handle: { id: number; state: unknown; destroyed: boolean },
          command: Record<string, unknown> & { type: string },
        ): { state: { phase: string; generation: number }; effects: unknown[] };
        destroy(handle: { id: number; state: unknown; destroyed: boolean }): void;
      };
    }).ReaderSession;
    return api.init().then(() => {
      const handle = api.create();
      const prep = {
        textLength: 4,
        units: [{ sentenceIndex: 0, kind: "body" as const, start: 0, end: 4, durationMs: 1 }],
        figures: [],
        flow: [{ kind: "unit" as const, sourceOffset: 0, unitIndex: 0 }],
      };
      api.dispatch(handle, { type: "open", requestId: "A" });
      api.dispatch(handle, { type: "open", requestId: "B" });
      const stalePreparation = api.dispatch(handle, { type: "prepareSucceeded", requestId: "A", flow: prep });
      const reading = api.dispatch(handle, { type: "prepareSucceeded", requestId: "B", flow: prep });
      const closed = api.dispatch(handle, { type: "close" });
      const lateTick = api.dispatch(handle, { type: "tick", generation: reading.state.generation });
      api.destroy(handle);
      return {
        stalePhase: stalePreparation.state.phase,
        readingPhase: reading.state.phase,
        closedPhase: closed.state.phase,
        closedGeneration: closed.state.generation,
        latePhase: lateTick.state.phase,
        lateGeneration: lateTick.state.generation,
      };
    });
  });
  expect(trace).toEqual({
    stalePhase: "preparing",
    readingPhase: "reading",
    closedPhase: "ended",
    closedGeneration: 4,
    latePhase: "ended",
    lateGeneration: trace.closedGeneration,
  });
  expect(trace.lateGeneration).toBe(trace.closedGeneration);
});

test("Chrome WASM initialization failure is recoverable and retry loads the real module", async ({ page }) => {
  await loadViewer(page, "chrome", "&wasm=fail");
  await openChrome(page, {});
  await expect(page.getByText("文章を準備できませんでした")).toBeVisible();
  await page.evaluate(() => { (globalThis as typeof globalThis & { __READER_WASM_RETRY: boolean }).__READER_WASM_RETRY = true; });
  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
});

test("mobile WASM initialization failure is recoverable and retry loads the real module", async ({ page }) => {
  await loadViewer(page, "mobile", "&wasm=fail");
  await openMobile(page);
  await expect(page.getByText("文章を準備できませんでした")).toBeVisible();
  await page.evaluate(() => { (globalThis as typeof globalThis & { __READER_WASM_RETRY: boolean }).__READER_WASM_RETRY = true; });
  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(page.getByRole("dialog", { name: "reader" })).toBeVisible();
});

test("WASM is lazy until the viewer is opened", async ({ page }) => {
  await loadViewer(page, "mobile");
  expect(await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("reader_session_bg.wasm")).length)).toBe(0);
  await openMobile(page);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("reader_session_bg.wasm")).length)).toBeGreaterThan(0);
});

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} pauses on hidden and does not auto-resume on visible`, async ({ page }) => {
    await loadViewer(page, viewer);
    if (viewer === "chrome") await openChrome(page, { text: "可視性確認。", paused: true });
    else await openMobile(page, { text: "可視性確認。" });

    const dialog = page.getByRole("dialog", { name: "reader" });
    await expect(dialog).toBeVisible();
    await pauseReaderIfPlaying(dialog);
    await dialog.getByRole("button", { name: "再生" }).click();
    await expect(dialog.getByRole("button", { name: "一時停止" })).toBeVisible();

    const setVisibility = async (state: "hidden" | "visible") => {
      await page.evaluate((nextState) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: nextState,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    };

    await setVisibility("hidden");
    await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
    const hiddenPosition = await readReaderPosition(dialog);

    await setVisibility("visible");
    await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
    await page.waitForTimeout(700);
    await expect.poll(() => readReaderPosition(dialog)).toEqual(hiddenPosition);
  });
}

const TIMING_E2E_TEXT = Array.from({ length: 10 }, (_, index) => `計測用の文${index + 1}です。`).join("");

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} reports planned and wall-clock RSVP timing`, async ({ page }, testInfo) => {
    await loadViewer(page, viewer);
    const plan = await page.evaluate((text) => {
      const engine = (globalThis as typeof globalThis & {
        Engine: {
          segmentText(value: string, locale: string): Array<{ text: string; sentenceIndex: number }>;
          displayDuration(
            unit: { text: string; sentenceIndex: number },
            nextUnit?: { sentenceIndex: number },
            sectionBreak?: boolean,
          ): number;
        };
      }).Engine;
      const units = engine.segmentText(text, "ja");
      const durations = units.map((unit, index) => engine.displayDuration(unit, units[index + 1], false));
      return {
        textLength: text.length,
        unitCount: units.length,
        plannedDurationMs: durations.reduce((total, duration) => total + duration, 0),
      };
    }, TIMING_E2E_TEXT);
    expect(plan.plannedDurationMs).toBeGreaterThanOrEqual(5_000);
    expect(plan.plannedDurationMs).toBeLessThanOrEqual(10_000);

    if (viewer === "chrome") await openChrome(page, { text: TIMING_E2E_TEXT, paused: true });
    else await openMobile(page, { text: TIMING_E2E_TEXT });

    const dialog = page.getByRole("dialog", { name: "reader" });
    await expect(dialog).toBeVisible();
    await pauseReaderIfPlaying(dialog);
    await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
    const startedAt = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-reader-owned="true"], #__reader-host'));
      const button = hosts
        .map((host) => host.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="再生"]'))
        .find((candidate): candidate is HTMLButtonElement => Boolean(candidate));
      if (!button) throw new Error("paused RSVP control not found");
      const timestamp = performance.now();
      button.click();
      return timestamp;
    });
    await expect(dialog.getByRole("button", { name: "一時停止" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(
      Array.from(document.querySelectorAll<HTMLElement>('[data-reader-owned="true"], #__reader-host'))
        .some((host) => Boolean(host.shadowRoot?.querySelector('[aria-label="再生"]'))),
    )), { timeout: plan.plannedDurationMs * 2 }).toBe(true);
    const actualDurationMs = await page.evaluate((start) => performance.now() - start, startedAt);
    const timingReport = {
      viewer,
      project: testInfo.project.name,
      textLength: plan.textLength,
      unitCount: plan.unitCount,
      plannedDurationMs: plan.plannedDurationMs,
      actualDurationMs: Math.round(actualDurationMs),
      relativeError: Math.abs(actualDurationMs - plan.plannedDurationMs) / plan.plannedDurationMs,
      withinFifteenPercent: Math.abs(actualDurationMs - plan.plannedDurationMs) / plan.plannedDurationMs <= 0.15,
    };
    const timingReportPath = `test-results/timing/${viewer}-${testInfo.project.name}.json`;
    await mkdir("test-results/timing", { recursive: true });
    await writeFile(timingReportPath, `${JSON.stringify(timingReport, null, 2)}\n`, "utf8");
    await testInfo.attach("reader-timing", {
      path: timingReportPath,
      contentType: "application/json",
    });
    expect(timingReport.actualDurationMs).toBeGreaterThan(0);
  });
}

test("Chrome viewer RSVP state matches its visual baseline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "一時停止" }).click();

  await expect(dialog).toHaveScreenshot("chrome-rsvp.png");
});

test("mobile viewer RSVP state matches its visual baseline", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  await dialog.getByRole("button", { name: "一時停止" }).click();

  await expect(dialog).toHaveScreenshot("mobile-rsvp.png");
});
