import { expect, test } from "@playwright/test";

const invites = [
  { label: "Join YoriMethods", url: "https://t.me/+y8EekRvqpnQzNjZl" },
  { label: "Join Chat Group", url: "https://t.me/+nzIAZDVK_61lZDQ9" },
] as const;
const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Join the Yori Community" });

test("first launch offers both exact invites, then Maybe later persists across launches", async ({ page }) => {
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("Explore YoriMethods");
  for (const invite of invites) {
    await expect(dialog(page).getByRole("link", { name: new RegExp(invite.label) })).toHaveAttribute("href", invite.url);
  }
  await expect(dialog(page).getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Maybe later" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Maybe later" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("origen.community.dismissed.v1"))).toBe("true");
  await page.getByRole("button", { name: "Sorter", exact: true }).click();
  await page.getByRole("button", { name: "Generator", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("#app-title")).toHaveText("Generator");
});

for (const invite of invites) {
  test(`${invite.label} opens only its intended external HTTPS invite`, async ({ page, context }) => {
    const requested: string[] = [];
    await context.route("https://t.me/**", async (route) => {
      requested.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "invite" });
    });
    await page.goto("/");
    const [external] = await Promise.all([
      context.waitForEvent("page"),
      dialog(page).getByRole("link", { name: new RegExp(invite.label) }).click(),
    ]);
    await external.waitForLoadState("domcontentloaded");
    expect(requested).toEqual([invite.url]);
    expect(external.url()).toBe(invite.url);
    await expect(page).toHaveURL(/localhost:4174\/#\/generator$/);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("origen.community.dismissed.v1"))).toBe("true");
    await page.reload();
    await expect(dialog(page)).toHaveCount(0);
    await external.close();
  });
}

test("close and Back dismiss without changing the selected tool", async ({ page }) => {
  await page.goto("/#/lookup");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
  await page.reload();
  await expect(dialog(page)).toHaveCount(0);
});

test("blocked storage cannot stop startup or repeatedly interrupt this session", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
  });
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Sorter", exact: true }).click();
  await page.getByRole("button", { name: "Generator", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("#app-title")).toHaveText("Generator");
});

test("320px dialog respects safe areas, viewport height, focus and touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 560 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-area-inset-top", "28px");
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
    document.documentElement.style.setProperty("--safe-area-inset-left", "8px");
    document.documentElement.style.setProperty("--safe-area-inset-right", "8px");
  });
  const modal = dialog(page);
  await expect(modal).toBeVisible();
  await expect(modal.locator(":focus")).toHaveCount(1);
  for (const invite of invites) {
    const link = modal.getByRole("link", { name: new RegExp(invite.label) });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const bounds = await modal.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(312);
  expect(bounds!.y).toBeGreaterThanOrEqual(28);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(560 - 24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A resized WebView (e.g. keyboard open) keeps the dialog scrollable.
  await page.setViewportSize({ width: 320, height: 400 });
  await expect(modal.getByRole("button", { name: "Maybe later" })).toBeVisible();
  await modal.getByRole("button", { name: "Maybe later" }).click();
  await expect(page.locator("#gen-prefix")).toBeVisible();
});
