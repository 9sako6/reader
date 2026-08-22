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
  image?: "immediate" | "delayed" | "missing" | "broken" | "vertical" | "horizontal" | "transparent" | "huge" | "default";
  figureFirst?: boolean;
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

test("mobile viewer keeps its focal point and pause state after 25 mode round trips", async ({ page }) => {
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

  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
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
    closedGeneration: trace.closedGeneration,
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
