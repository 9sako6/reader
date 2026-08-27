import { expect, test, type Page } from "@playwright/test";

type ChromeOpenOptions = {
  paused?: boolean;
};

async function loadChromeViewer(page: Page): Promise<void> {
  await page.goto("/tests/e2e/fixtures/article.html?viewer=chrome");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
}

async function loadMobileViewer(page: Page): Promise<void> {
  await page.goto("/tests/e2e/fixtures/article.html?viewer=mobile&pageHost=true");
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
}

async function openChromeViewer(page: Page, options: ChromeOpenOptions = {}): Promise<void> {
  await page.evaluate((openOptions) => {
    (globalThis as typeof globalThis & {
      ReaderE2E: { open(options: ChromeOpenOptions): string };
    }).ReaderE2E.open(openOptions);
  }, options);
}

test("Chrome reader stays above hostile page CSS and top-layer UI while its controls remain usable", async ({ page }) => {
  await loadChromeViewer(page);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: content-box !important; }
      button { font-size: 2px !important; padding: 100px !important; }
      img { width: 1px !important; filter: invert(1) !important; }
      svg { position: fixed !important; }
      html { writing-mode: vertical-rl; color-scheme: light; }
    `;
    document.head.append(style);

    const pageOverlay = document.createElement("div");
    pageOverlay.id = "hostile-max-z-index-overlay";
    pageOverlay.textContent = "page overlay";
    Object.assign(pageOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    document.body.append(pageOverlay);

    const pageDialog = document.createElement("dialog");
    pageDialog.id = "hostile-page-dialog";
    pageDialog.textContent = "page dialog";
    document.body.append(pageDialog);
    pageDialog.showModal();

    (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks = 0;
    document.addEventListener("click", (event) => {
      (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks += 1;
      event.preventDefault();
    }, true);
  });

  await openChromeViewer(page, { paused: true });
  const reader = page.getByRole("dialog", { name: "reader" });
  await expect(reader).toBeVisible();

  const shell = await page.evaluate(() => {
    const host = document.querySelector('[data-reader-owned="true"]');
    const dialog = host?.shadowRoot?.querySelector("dialog");
    const modeButton = dialog?.querySelector("[data-reader-topbar] button");
    if (!host || !dialog || !modeButton) throw new Error("reader dialog was not mounted");
    const buttonStyle = getComputedStyle(modeButton);
    const dialogStyle = getComputedStyle(dialog);
    return {
      hostPointerEvents: getComputedStyle(host).pointerEvents,
      dialogPointerEvents: dialogStyle.pointerEvents,
      dialogWritingMode: dialogStyle.writingMode,
      dialogIsModal: dialog.matches(":modal"),
      buttonFontSize: buttonStyle.fontSize,
      buttonPaddingTop: buttonStyle.paddingTop,
      buttonPaddingLeft: buttonStyle.paddingLeft,
      buttonBoxSizing: buttonStyle.boxSizing,
      topLayerElementIsReaderHost: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === host,
    };
  });

  expect(shell.hostPointerEvents).toBe("none");
  expect(shell.dialogPointerEvents).toBe("auto");
  expect(shell.dialogWritingMode).toBe("horizontal-tb");
  expect(shell.dialogIsModal).toBe(true);
  expect(shell.buttonFontSize).toBe("14px");
  expect(shell.buttonPaddingTop).toBe("0px");
  expect(shell.buttonPaddingLeft).toBe("0px");
  expect(shell.buttonBoxSizing).toBe("border-box");
  expect(shell.topLayerElementIsReaderHost).toBe(true);

  await reader.getByRole("button", { name: "Page、文章全体で読む" }).click();
  await expect(reader.locator("[data-reader-page-shell]")).toBeVisible();
  const image = reader.locator("img").first();
  await expect(image).toBeVisible();
  const imageStyle = await image.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: element.getBoundingClientRect().width, filter: style.filter };
  });
  expect(imageStyle.width).toBeGreaterThan(1);
  expect(imageStyle.filter).toBe("none");
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks)).toBeGreaterThan(0);

  await reader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(0);
});

test("Chrome Page reader allows selecting and copying a paragraph on a page that disables selection", async ({ page }) => {
  await loadChromeViewer(page);
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { copiedReaderText: string };
    scope.copiedReaderText = "";
    document.addEventListener("copy", () => {
      scope.copiedReaderText = getSelection()?.toString() || "";
    });
    const style = document.createElement("style");
    style.textContent = "* { user-select: none !important; -webkit-user-select: none !important; }";
    document.head.append(style);

    const host = document.createElement("div");
    host.setAttribute("data-reader-selection-test", "true");
    Object.assign(host.style, { position: "fixed", inset: "0", background: "#090909" });
    const mountPoint = document.createElement("div");
    Object.assign(mountPoint.style, { position: "absolute", inset: "0" });
    host.attachShadow({ mode: "open" }).append(mountPoint);
    document.body.append(host);

    const view = globalThis.ReaderView;
    if (!view) throw new Error("reader view was not loaded");
    view.mount(mountPoint, { layout: "desktop" }).render({
      kind: "page",
      language: "ja",
      title: "",
      blocks: [{
        text: "最初の短い文です。次の文は注視位置が動かないことを確かめます。画像の直前にある文です。",
        kind: "paragraph",
        level: null,
        start: 0,
        end: 43,
        sentenceSpans: [{ start: 0, end: 43, sentenceIndex: 0 }],
      }],
      figures: [],
      headings: [],
      activeHeadingIndex: -1,
      position: { kind: "text", sourceOffset: 0 },
      progress: 0,
    }, {
      close() {},
      cancel() {},
      retry() {},
      switchToPage() {},
      switchToSpots() {},
      previousSentence() {},
      headingSelect() {},
      togglePlayback() {},
      resumeFigure() {},
      figureLoad() {},
      figureError() {},
      figureImage() {},
      toggleFigureBrightness() {},
      loadingAnimation() { return undefined; },
      pageScroll() {},
      pagePosition() {},
    });
  });

  const reader = page.locator('[data-reader-selection-test="true"]');
  const paragraph = reader.locator("p.paragraph");
  await expect(paragraph).toHaveText("最初の短い文です。次の文は注視位置が動かないことを確かめます。画像の直前にある文です。");

  await paragraph.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => getSelection()?.toString() || "")).toContain("最初の短い文です。");
  await page.keyboard.press("ControlOrMeta+C");

  await expect.poll(() => page.evaluate(() => (
    globalThis as typeof globalThis & { copiedReaderText: string }
  ).copiedReaderText)).toContain("最初の短い文です。");
});

test("Chrome reader preserves a page-owned root id and does not duplicate its host after reopening", async ({ page }) => {
  await loadChromeViewer(page);
  await page.evaluate(() => {
    const pageElement = document.createElement("div");
    pageElement.id = "__reader-root";
    pageElement.textContent = "元ページの要素";
    document.body.prepend(pageElement);
  });

  await openChromeViewer(page, { paused: true });
  const reader = page.getByRole("dialog", { name: "reader" });
  await expect(reader).toBeVisible();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] [data-reader-spot]')).toHaveCount(1);

  await reader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(0);
  await expect(page.locator("#__reader-root")).toHaveText("元ページの要素");

  await openChromeViewer(page, { paused: true });
  const reopenedReader = page.getByRole("dialog", { name: "reader" });
  await expect(reopenedReader).toBeVisible();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] dialog')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] [data-reader-spot]')).toHaveCount(1);

  await reopenedReader.getByRole("button", { name: "Page、文章全体で読む" }).click();
  await expect(reopenedReader.locator("[data-reader-page-shell]")).toBeVisible();
  await reopenedReader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(0);
  await expect(page.locator("#__reader-root")).toHaveText("元ページの要素");
});

test("Safari reader isolates hostile page styles and preserves a page-owned host across reopen", async ({ page }) => {
  await loadMobileViewer(page);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: content-box !important; }
      button { font-size: 2px !important; padding: 100px !important; }
      img { width: 1px !important; filter: invert(1) !important; }
      svg { position: fixed !important; }
      html { writing-mode: vertical-rl; color-scheme: light; }
    `;
    document.head.append(style);

    (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks = 0;
    document.addEventListener("click", (event) => {
      (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks += 1;
      event.preventDefault();
    }, true);
  });

  const launchButton = page.getByRole("button", { name: "readerで読む" });
  await launchButton.click();
  const reader = page.getByRole("dialog", { name: "reader" });
  await expect(reader).toBeVisible();

  const isolation = await page.evaluate(() => {
    const host = document.querySelector('[data-reader-owned="true"]');
    const readerElement = host?.shadowRoot?.querySelector<HTMLElement>(".reader");
    const closeButton = readerElement?.querySelector<HTMLElement>('[aria-label="readerを閉じる"]');
    const pageOwnedHost = document.querySelector("#__reader-host");
    if (!host || !readerElement || !closeButton || !pageOwnedHost) {
      throw new Error("Safari hostile-page fixture did not mount the expected nodes");
    }
    const buttonStyle = getComputedStyle(closeButton);
    const readerStyle = getComputedStyle(readerElement);
    return {
      ownedHostCount: document.querySelectorAll('[data-reader-owned="true"]').length,
      hostPointerEvents: getComputedStyle(host).pointerEvents,
      readerPointerEvents: readerStyle.pointerEvents,
      readerWritingMode: readerStyle.writingMode,
      closeButtonFontSize: buttonStyle.fontSize,
      closeButtonPaddingTop: buttonStyle.paddingTop,
      closeButtonWidth: closeButton.getBoundingClientRect().width,
      closeButtonHeight: closeButton.getBoundingClientRect().height,
      pageOwnedHostText: pageOwnedHost.textContent,
    };
  });

  expect(isolation.ownedHostCount).toBe(1);
  expect(isolation.hostPointerEvents).toBe("none");
  expect(isolation.readerPointerEvents).toBe("auto");
  expect(isolation.readerWritingMode).toBe("horizontal-tb");
  expect(isolation.closeButtonFontSize).not.toBe("2px");
  expect(isolation.closeButtonPaddingTop).not.toBe("100px");
  expect(isolation.closeButtonWidth).toBeGreaterThanOrEqual(44);
  expect(isolation.closeButtonHeight).toBeGreaterThanOrEqual(44);
  expect(isolation.pageOwnedHostText).toBe("ページ側の要素");

  await reader.getByRole("button", { name: "Page、文章全体で読む" }).click();
  await expect(reader.locator(".page-view")).toBeVisible();
  const imageStyle = await reader.locator("img").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: element.getBoundingClientRect().width, filter: style.filter };
  });
  expect(imageStyle.width).toBeGreaterThan(1);
  expect(imageStyle.filter).toBe("none");
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { hostileCaptureClicks: number }).hostileCaptureClicks)).toBeGreaterThan(0);

  await reader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator("#__reader-host")).toHaveText("ページ側の要素");
  await expect(reader).toBeHidden();

  await launchButton.click();
  const reopenedReader = page.getByRole("dialog", { name: "reader" });
  await expect(reopenedReader).toBeVisible();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] .reader')).toHaveCount(1);
  await expect(page.locator("#__reader-host")).toHaveText("ページ側の要素");
});
