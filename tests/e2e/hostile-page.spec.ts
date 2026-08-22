import { expect, test, type Page } from "@playwright/test";

type ChromeOpenOptions = {
  paused?: boolean;
};

async function loadChromeViewer(page: Page): Promise<void> {
  await page.goto("/tests/e2e/fixtures/article.html?viewer=chrome");
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
  expect(shell.buttonPaddingLeft).toBe("12px");
  expect(shell.buttonBoxSizing).toBe("border-box");
  expect(shell.topLayerElementIsReaderHost).toBe(true);

  await reader.getByRole("button", { name: "文章で読む" }).click();
  await expect(reader.locator("[data-reader-text-shell]")).toBeVisible();
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

test("Chrome reader preserves a page-owned root id and does not duplicate its host after reopening", async ({ page }) => {
  await loadChromeViewer(page);
  await page.evaluate(() => {
    const pageElement = document.createElement("div");
    pageElement.id = "__rsvp-reader-root";
    pageElement.textContent = "元ページの要素";
    document.body.prepend(pageElement);
  });

  await openChromeViewer(page, { paused: true });
  const reader = page.getByRole("dialog", { name: "reader" });
  await expect(reader).toBeVisible();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] [data-reader-unit]')).toHaveCount(1);

  await reader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(0);
  await expect(page.locator("#__rsvp-reader-root")).toHaveText("元ページの要素");

  await openChromeViewer(page, { paused: true });
  const reopenedReader = page.getByRole("dialog", { name: "reader" });
  await expect(reopenedReader).toBeVisible();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] dialog')).toHaveCount(1);
  await expect(page.locator('[data-reader-owned="true"] [data-reader-unit]')).toHaveCount(1);

  await reopenedReader.getByRole("button", { name: "文章で読む" }).click();
  await expect(reopenedReader.locator("[data-reader-text-shell]")).toBeVisible();
  await reopenedReader.getByRole("button", { name: "readerを閉じる" }).click();
  await expect(page.locator('[data-reader-owned="true"]')).toHaveCount(0);
  await expect(page.locator("#__rsvp-reader-root")).toHaveText("元ページの要素");
});
