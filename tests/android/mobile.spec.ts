import { expect, test, type Page } from "@playwright/test";

const TOOLS = [
  { id: "generator", title: "Generator" },
  { id: "lookup", title: "BIN Lookup" },
  { id: "sorter", title: "Card Sorter" },
  { id: "settings", title: "Settings" },
] as const;

/** Blocks every request that leaves the bundled app, and records attempts. */
async function isolate(page: Page) {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    external.push(url.href);
    return route.abort("internetdisconnected");
  });
  return external;
}

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

const nav = (page: Page, id: string) => page.locator(`.bottom-nav [data-tool="${id}"]`);
const screen = (page: Page, id: string) => page.locator(`.screen-host[data-screen="${id}"]`);

test.describe("ORIGEN Android shell", () => {
  test("starts from bundled assets with no external requests or errors", async ({ page }) => {
    const external = await isolate(page);
    const errors = await collectErrors(page);
    await page.goto("/");
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(page.locator("html")).toHaveClass(/ready/);
    for (const tool of TOOLS) await nav(page, tool.id).click();
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("ships a strict content security policy and a non-zooming viewport", async ({ page }) => {
    await page.goto("/");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/connect-src https:\/\/[^\s;]+;/);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).toContain("user-scalable=no");
    expect(viewport).toContain("interactive-widget=resizes-content");
  });

  test("bottom navigation switches tools with icons, labels and one current item", async ({ page }) => {
    await page.goto("/");
    const items = page.locator(".bottom-nav .nav-item");
    await expect(items).toHaveCount(4);
    for (const tool of TOOLS) {
      await nav(page, tool.id).tap();
      await expect(page.locator("#app-title")).toHaveText(tool.title);
      await expect(screen(page, tool.id)).toBeVisible();
      await expect(nav(page, tool.id)).toHaveAttribute("aria-current", "page");
      await expect(page.locator('.bottom-nav [aria-current="page"]')).toHaveCount(1);
      await expect(nav(page, tool.id).locator("svg")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#/${tool.id}$`));
    }
  });

  test("Back leaves secondary views first, then returns to Generator", async ({ page }) => {
    await page.goto("/#/sorter");
    await page.locator("#sorter-input").fill("b|1\na|2");
    await page.locator("#sorter-view-result").tap();
    await expect(page.locator("#sorter-result-view")).toBeVisible();
    // Escape is the browser stand-in for the Android Back action.
    await page.keyboard.press("Escape");
    await expect(page.locator("#sorter-input-view")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await page.keyboard.press("Escape");
    await expect(page.locator("#app-title")).toHaveText("Generator");
  });

  test("keeps typed input across tab switches", async ({ page }) => {
    await page.goto("/");
    await page.locator("#gen-prefix").fill("457173");
    await nav(page, "lookup").tap();
    await page.locator("#lookup-bin").fill("411111");
    await nav(page, "generator").tap();
    await expect(page.locator("#gen-prefix")).toHaveValue("457173");
    await nav(page, "lookup").tap();
    await expect(page.locator("#lookup-bin")).toHaveValue("411111");
  });

  test("generates synthetic fixtures fully offline", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    await page.locator("#gen-prefix").fill("411111");
    await page.locator('[data-quantity="5"]').tap();
    await page.locator("#gen-generate").tap();
    await expect(page.locator("#gen-results-list .fixture")).toHaveCount(5);
    await expect(page.locator("#gen-results-list .fixture").first()).toContainText("SYNTHETIC TEST FIXTURE");
    await expect(page.locator("#offline-pill")).toBeVisible();
  });

  test("BIN Lookup reports offline honestly and never shows invented metadata", async ({ page, context }) => {
    const external = await isolate(page);
    await page.goto("/#/lookup");
    await context.setOffline(true);
    await expect(page.locator("#lookup-offline")).toBeVisible();
    await page.locator("#lookup-bin").fill("457173");
    await page.locator("#lookup-submit").tap();
    await expect(page.locator("#lookup-result .state-error")).toContainText("offline");
    await expect(page.locator("#lookup-result .meta-list")).toHaveCount(0);
    expect(external).toEqual([]);
  });

  test("BIN Lookup sends only the prefix and shows the service response", async ({ page }) => {
    const requested: string[] = [];
    await page.route("https://guison-api.onrender.com/**", async (route) => {
      requested.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ iin: "457173", scheme: "visa", type: "debit", brand: "Visa Classic", country: { alpha2: "GB", name: "United Kingdom" }, bank: { name: "Fixture Bank" } }),
      });
    });
    await page.goto("/#/lookup");
    await page.locator("#lookup-bin").fill("4571731234567890");
    await page.locator("#lookup-submit").tap();
    await expect(page.locator("#lookup-bin")).toHaveAttribute("aria-invalid", "true");
    expect(requested).toEqual([]);
    await page.locator("#lookup-bin").fill("457173");
    await page.locator("#lookup-submit").tap();
    await expect(page.locator("#lookup-result")).toContainText("Fixture Bank");
    expect(requested).toEqual(["https://guison-api.onrender.com/v1/bin/457173"]);
  });

  test("keeps every touch target at least 44px in both directions", async ({ page }) => {
    await page.goto("/");
    for (const tool of TOOLS) {
      await nav(page, tool.id).tap();
      const small = await page.evaluate((id) => {
        const host = document.querySelector(`.screen-host[data-screen="${id}"]`);
        const controls = [...document.querySelectorAll<HTMLElement>(".bottom-nav button"), ...(host?.querySelectorAll<HTMLElement>("button, input:not([type=checkbox]):not([type=file]), select, a, .switch") ?? [])];
        return controls
          .filter((element) => element.offsetParent !== null)
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.height < 44 || rect.width < 44)
          .map(({ element, rect }) => `${element.tagName}#${element.id}.${element.className} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }, tool.id);
      expect(small, `small targets on ${tool.id}`).toEqual([]);
    }
  });

  test("keeps form text legible (14px or larger)", async ({ page }) => {
    await page.goto("/");
    for (const tool of TOOLS) {
      await nav(page, tool.id).tap();
      const sizes = await page.evaluate((id) =>
        [...document.querySelectorAll<HTMLElement>(`.screen-host[data-screen="${id}"] input:not([type=checkbox]):not([type=file]), .screen-host[data-screen="${id}"] select, .screen-host[data-screen="${id}"] textarea`)]
          .filter((element) => !element.readOnly)
          .map((element) => parseFloat(getComputedStyle(element).fontSize)),
      tool.id);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(14);
    }
  });

  test("hides the bottom bar while the soft keyboard is open", async ({ page }) => {
    await page.goto("/#/lookup");
    await page.locator("#lookup-bin").focus();
    await page.setViewportSize({ width: 412, height: 520 });
    await expect(page.locator(".app")).toHaveAttribute("data-keyboard", "open");
    await expect(page.locator(".bottom-nav")).toBeHidden();
    await expect(page.locator("#lookup-bin")).toBeInViewport();
    await page.locator("#lookup-bin").blur();
    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page.locator(".app")).toHaveAttribute("data-keyboard", "closed");
    await expect(page.locator(".bottom-nav")).toBeVisible();
  });

  test("pads the app bar and navigation by the system safe-area insets", async ({ page }) => {
    await page.goto("/");
    const before = await page.evaluate(() => ({
      top: document.querySelector(".app-bar")!.getBoundingClientRect().height,
      bottom: parseFloat(getComputedStyle(document.querySelector(".bottom-nav")!).paddingBottom),
    }));
    // Capacitor's SystemBars plugin injects these variables on Android.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-inset-top", "32px");
      document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
    });
    const after = await page.evaluate(() => ({
      top: document.querySelector(".app-bar")!.getBoundingClientRect().height,
      bottom: parseFloat(getComputedStyle(document.querySelector(".bottom-nav")!).paddingBottom),
    }));
    expect(after.top - before.top).toBeCloseTo(32, 0);
    expect(after.bottom - before.bottom).toBeCloseTo(24, 0);
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await nav(page, "lookup").tap();
    const duration = await screen(page, "lookup").evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });

  test("defaults to the charcoal theme and switches from Settings", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/#/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator('#settings-theme [data-value="light"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator('#settings-theme [data-value="system"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

for (const width of [320, 360, 412]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.locator("#gen-prefix").fill("411111");
    await page.locator("#gen-generate").tap();
    for (const tool of TOOLS) {
      await nav(page, tool.id).tap();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll<HTMLElement>(".screen-host:not([hidden]) .screen-scroll")].some((element) => element.scrollWidth > element.clientWidth + 1),
      );
      expect(overflow, `${tool.id} overflows at ${width}px`).toBe(false);
    }
  });
}
