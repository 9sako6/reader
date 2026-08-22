import { expect, test, type Page } from "@playwright/test";

async function loadViewer(page: Page, viewer: "chrome" | "mobile"): Promise<void> {
  await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}`);
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
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
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await dialog.getByRole("button", { name: "再生" }).click();
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
  await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
  await dialog.getByRole("button", { name: "再生" }).click();
  await expect(figure).toBeHidden();
  await expect(dialog.locator("[data-reader-unit]")).toBeVisible();
});

test("Chrome viewer traps focus and restores the launch button after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("[aria-live]")).toHaveCount(0);
  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeFocused();
  await dialog.getByRole("button", { name: "一時停止" }).click();
  await expect(dialog.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);

  const firstControl = dialog.getByRole("button", { name: "実ブラウザで読む" });
  await firstControl.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "再生" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstControl).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
  await expect(dialog.locator("[aria-live]")).toHaveCount(0);
  const closeButton = dialog.getByRole("button", { name: "readerを閉じる" });
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "文章で読む" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
