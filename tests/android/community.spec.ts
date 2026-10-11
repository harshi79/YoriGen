import { expect, test } from "@playwright/test";

const invites = [
  { label: "Join YoriMethods", url: "https://t.me/+y8EekRvqpnQzNjZl" },
  { label: "Join Chat Group", url: "https://t.me/+nzIAZDVK_61lZDQ9" },
] as const;
const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Join the Yori Community" });

test("every fresh launch offers both exact invites, then Maybe later dismisses for that session", async ({ page }) => {
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  for (const invite of invites) {
    await expect(dialog(page).getByRole("link", { name: new RegExp(invite.label) })).toHaveAttribute("href", invite.url);
  }
  await expect(dialog(page).getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Maybe later" })).toBeVisible();

  await dialog(page).getByRole("button", { name: "Maybe later" }).click();
  await expect(dialog(page)).toHaveCount(0);

  // In-session navigation and tab re-selection never reopen it.
  await page.getByRole("button", { name: "Sorter", exact: true }).click();
  await page.getByRole("button", { name: "BIN Lookup", exact: true }).click();
  await page.getByRole("button", { name: "Generator", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  // Dismissal is never persisted, so the next launch shows it again.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("origen.community.dismissed.v1")))
    .toBeNull();
  await page.reload();
  await expect(dialog(page)).toBeVisible();
});

test("a cold start with no stored state still shows the prompt", async ({ context, page }) => {
  await context.clearCookies();
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
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
    await expect(page).toHaveURL(/^http:\/\/localhost:4174\//);
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(dialog(page)).toHaveCount(0);
    await external.close();
  });
}

test("the app stays usable when an invite cannot be opened", async ({ page, context }) => {
  // Simulate a device with no Telegram and no handler: every attempt fails.
  await context.route("https://t.me/**", (route) => route.abort());
  await page.goto("/");
  await dialog(page).getByRole("link", { name: /Join Chat Group/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Sorter", exact: true }).click();
  await expect(page.locator("#app-title")).toHaveText("Card Sorter");
});

test("close and Back dismiss without changing the selected tool", async ({ page }) => {
  await page.goto("/#/lookup");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
  await page.reload();
  await expect(dialog(page)).toBeVisible();
});

test("the prompt shows on an offline cold start and makes no request", async ({ page, context }) => {
  // A real device with no connectivity still loads the bundled app; only a
  // request that left the bundle would fail. Playwright's offline switch would
  // also refuse localhost and the page would never load, so the connection
  // state the app reads is forced instead, and every request that would leave
  // the bundle is recorded and refused.
  const attempts: string[] = [];
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false });
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    attempts.push(url.origin);
    return route.abort("internetdisconnected");
  });
  await page.goto("/");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("#offline-pill")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Maybe later" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Generator", exact: true }).click();
  await expect(page.locator("#gen-generate")).toBeVisible();
  expect(attempts).toEqual([]);
});
