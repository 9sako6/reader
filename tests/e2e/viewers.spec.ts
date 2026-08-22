import { expect, test, type Locator, type Page } from "@playwright/test";

async function loadViewer(page: Page, viewer: "chrome" | "mobile"): Promise<void> {
  await page.goto(`/tests/e2e/fixtures/article.html?viewer=${viewer}`);
  await page.evaluate(() => (globalThis as typeof globalThis & { ReaderE2EReady: Promise<void> }).ReaderE2EReady);
}

async function openChrome(page: Page): Promise<Locator> {
  await loadViewer(page, "chrome");
  const launchButton = page.getByRole("button", { name: "Chrome readerを開く" });
  await launchButton.focus();
  await launchButton.press("Enter");
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openMobile(page: Page): Promise<Locator> {
  await loadViewer(page, "mobile");
  await page.getByRole("button", { name: "readerで読む" }).click();
  const dialog = page.getByRole("dialog", { name: "reader" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function unitGeometry(unit: Locator) {
  return unit.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      centerX: rectangle.left + rectangle.width / 2,
      centerY: rectangle.top + rectangle.height / 2,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
}

async function expectControlsToBeTouchable(dialog: Locator): Promise<void> {
  for (const name of ["readerを閉じる", "1文戻る", /^(再生|一時停止)$/]) {
    const button = dialog.getByRole("button", { name });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
}

test("Chrome viewer keeps the RSVP focal point stable and survives hostile page CSS", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await openChrome(page);
  await dialog.getByRole("button", { name: "一時停止" }).click();
  const unit = dialog.locator("[data-reader-unit]");
  const initial = await unitGeometry(unit);
  expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 1);
  expect(initial.fontSize).toBeGreaterThanOrEqual(20);
  expect(initial.lineHeight).toBeGreaterThan(initial.fontSize);
  await expectControlsToBeTouchable(dialog);
  await expect(dialog.getByRole("button", { name: "readerを閉じる" })).not.toHaveCSS("background-color", "rgb(255, 0, 128)");

  for (let iteration = 0; iteration < 25; iteration += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
    await dialog.getByRole("button", { name: "一時停止" }).click();
  }
  const afterRoundTrips = await unitGeometry(dialog.locator("[data-reader-unit]"));
  expect(Math.abs(afterRoundTrips.centerX - initial.centerX)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterRoundTrips.centerY - initial.centerY)).toBeLessThanOrEqual(1);
});

test("mobile viewer keeps mode state and real layout stable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openMobile(page);
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  await dialog.getByRole("button", { name: "一時停止" }).click();
  const initial = await unitGeometry(dialog.locator("[data-reader-unit]"));
  expect(initial.scrollWidth).toBeLessThanOrEqual(initial.clientWidth + 1);
  expect(initial.fontSize).toBeGreaterThanOrEqual(20);
  await expectControlsToBeTouchable(dialog);

  for (let iteration = 0; iteration < 25; iteration += 1) {
    await dialog.getByRole("button", { name: "文章で読む" }).click();
    await dialog.getByRole("button", { name: "RSVPで読む" }).click();
  }
  await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  const pauseButton = dialog.getByRole("button", { name: "一時停止" });
  if (await pauseButton.isVisible()) await pauseButton.click();
  const afterRoundTrips = await unitGeometry(dialog.locator("[data-reader-unit]"));
  expect(Math.abs(afterRoundTrips.centerX - initial.centerX)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterRoundTrips.centerY - initial.centerY)).toBeLessThanOrEqual(1);
});

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} viewer pauses for images and exposes image context`, async ({ page }) => {
    await page.setViewportSize(viewer === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    const dialog = viewer === "chrome" ? await openChrome(page) : await openMobile(page);
    const figure = dialog.getByRole("figure", { name: "本文画像" });
    await expect(figure).toBeVisible({ timeout: 15_000 });
    await expect(figure.getByRole("img", { name: "本文の読書フロー図" })).toBeVisible();
    await expect(figure).toContainText("読書フローの図");
    await expect(dialog.getByRole("button", { name: "再生" })).toBeVisible();
    await dialog.getByRole("button", { name: "再生" }).click();
    await expect(figure).toBeHidden();
    await expect(dialog.locator("[data-reader-unit]")).toBeVisible();
  });
}

for (const viewer of ["chrome", "mobile"] as const) {
  test(`${viewer} viewer traps focus, closes with Escape, and restores focus`, async ({ page }) => {
    await page.setViewportSize(viewer === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
    const dialog = viewer === "chrome" ? await openChrome(page) : await openMobile(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.locator("[aria-live]")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "readerを閉じる" })).toBeFocused();
    for (let step = 0; step < 12; step += 1) await page.keyboard.press("Tab");
    const focusIsInsideDialog = await page.evaluate(() => {
      let active: Element | null = document.activeElement;
      while (active instanceof HTMLElement && active.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active?.closest('[role="dialog"]') !== null;
    });
    expect(focusIsInsideDialog).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    if (viewer === "chrome") await expect(page.getByRole("button", { name: "Chrome readerを開く" })).toBeFocused();
    else await expect(page.getByRole("button", { name: "readerで読む" })).toBeFocused();
  });
}

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

test("key viewer states have visual baselines", async ({ page }, testInfo) => {
  const viewer = testInfo.project.name === "webkit" ? "mobile" : "chrome";
  await page.setViewportSize(viewer === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = viewer === "chrome" ? await openChrome(page) : await openMobile(page);
  if (viewer === "mobile") await dialog.locator(".rsvp-view").click({ position: { x: 300, y: 240 } });
  await dialog.getByRole("button", { name: "一時停止" }).click();
  await expect(dialog).toHaveScreenshot(`${viewer}-rsvp.png`);
});
