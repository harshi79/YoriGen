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

/** Closes the launch prompt so a test starts from the shell itself. */
async function dismissPrompt(page: Page) {
  const prompt = page.getByRole("dialog", { name: "Join the Yori Community" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Maybe later" }).click();
  await expect(prompt).toHaveCount(0);
}

/**
 * Dispatches a touch drag, the input a real device produces, rather than a
 * mouse drag the gesture was never designed for.
 */
async function touchDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const steps = 6;
  await send("touchStart", from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    await send("touchMove", from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  await send("touchEnd", from.x + dx, from.y + dy);
  await cdp.detach();
}

/**
 * Lays a plain, non-interactive strip inside the current screen's scroller and
 * returns a point on it, so the gesture starts on ordinary card surface — what
 * a finger actually lands on — at a known place.
 *
 * Hunting for a free point by hit testing proved unreliable: the element under
 * a probed coordinate was not always the element the touch landed on, and the
 * gesture then started on a control and was correctly ignored.
 *
 * The starting x follows the direction so the whole travel stays inside the
 * screen host: a gesture that leaves it is abandoned by design.
 */
async function swipePoint(page: Page, dx: number) {
  await page.evaluate(() => {
    document.getElementById("swipe-surface")?.remove();
    const scroller = document.querySelector(".screen-host:not([hidden]) .screen-scroll");
    if (!scroller) throw new Error("no visible screen scroller");
    const surface = document.createElement("div");
    surface.id = "swipe-surface";
    surface.style.height = "160px";
    scroller.append(surface);
    surface.scrollIntoView({ block: "center" });
  });
  const box = await page.locator("#swipe-surface").boundingBox();
  if (!box) throw new Error("the swipe surface has no box");
  const fraction = dx < 0 ? 0.8 : dx > 0 ? 0.2 : 0.5;
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

async function swipe(page: Page, dx: number) {
  await touchDrag(page, await swipePoint(page, dx), dx, 2);
}

// The prompt's own lifecycle is covered in community.spec.ts.

/**
 * Loads the app and clears the launch prompt, which every fresh page load
 * shows. A test that navigates again starts a new boot and sees it again.
 */
async function boot(page: Page, url = "/") {
  await page.goto(url);
  // A goto that only changes the hash is a same-document navigation: the app
  // keeps running and never shows the launch prompt again. Reload so every boot
  // is a real cold start, whatever route it starts on.
  await page.reload();
  await dismissPrompt(page);
}

// Every test starts at the shell with the launch prompt already dismissed, the
// way a user who has cleared it sees the app. A test that needs a specific
// route boots again itself. The prompt's own lifecycle is covered in
// community.spec.ts.
test.beforeEach(async ({ page }) => {
  await boot(page);
});

test.describe("ORIGEN Android shell", () => {
  test("starts from bundled assets with no external requests or errors", async ({ page }) => {
    const external = await isolate(page);
    const errors = await collectErrors(page);
    await boot(page);
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(page.locator("html")).toHaveClass(/ready/);
    for (const tool of TOOLS) await nav(page, tool.id).click();
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("ships a strict content security policy and a non-zooming viewport", async ({ page }) => {
    await boot(page);
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
    await boot(page);
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
    await boot(page, "/#/sorter");
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
    await boot(page);
    await page.locator("#gen-prefix").fill("457173");
    await nav(page, "lookup").tap();
    await page.locator("#lookup-bin").fill("411111");
    await nav(page, "generator").tap();
    await expect(page.locator("#gen-prefix")).toHaveValue("457173");
    await nav(page, "lookup").tap();
    await expect(page.locator("#lookup-bin")).toHaveValue("411111");
  });

  test("generates synthetic fixtures fully offline", async ({ page, context }) => {
    await boot(page);
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
    await boot(page, "/#/lookup");
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
    await boot(page, "/#/lookup");
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
    await boot(page);
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
    await boot(page);
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
    await boot(page, "/#/lookup");
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
    await boot(page);
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
    await boot(page);
    await nav(page, "lookup").tap();
    const duration = await screen(page, "lookup").evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });

  test("defaults to the charcoal theme and switches from Settings", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await boot(page, "/#/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator('#settings-theme [data-value="light"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await dismissPrompt(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator('#settings-theme [data-value="system"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

for (const width of [320, 360, 412]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await boot(page);
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

test("nav labels, action buttons and the theme control are not truncated at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await boot(page);
  for (const tool of TOOLS) {
    await nav(page, tool.id).tap();
    const clipped = await page.evaluate((id) => {
      const visible = (element: Element) => (element as HTMLElement).offsetParent !== null;
      const labels = [...document.querySelectorAll<HTMLElement>(".bottom-nav .nav-label")];
      const buttons = [...document.querySelectorAll<HTMLElement>(`.screen-host[data-screen="${id}"] .action-bar .btn span`)];
      const segments = [...document.querySelectorAll<HTMLElement>(`.screen-host[data-screen="${id}"] .segment`)];
      return [...labels, ...buttons, ...segments]
        .filter(visible)
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent?.trim() ?? "");
    }, tool.id);
    expect(clipped, `truncated text on ${tool.id}`).toEqual([]);
  }
});

test.describe("swipe between destinations", () => {
  test("a left swipe moves forward and a right swipe moves back", async ({ page }) => {
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await swipe(page, -260);
    await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
    await swipe(page, -260);
    await expect(page.locator("#app-title")).toHaveText("Card Sorter");
    await swipe(page, 260);
    await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
  });

  test("does not wrap around at either end of the navigation", async ({ page }) => {
    await swipe(page, 260); // before the first destination
    await expect(page.locator("#app-title")).toHaveText("Generator");
    // click, not tap: after a touch sequence dispatched over CDP, Chromium
    // gives a following synthesised tap a pointerdown but no click, so the
    // navigation would not run. Measured, not assumed — the same tap reaches
    // the button everywhere no swipe precedes it.
    await nav(page, "settings").click();
    await expect(page.locator("#app-title")).toHaveText("Settings");
    await swipe(page, -260); // after the last destination
    await expect(page.locator("#app-title")).toHaveText("Settings");
  });

  test("a vertical drag scrolls instead of navigating", async ({ page }) => {
    await touchDrag(page, await swipePoint(page, 0), 8, -220);
    await expect(page.locator("#app-title")).toHaveText("Generator");
  });

  test("a short drag is not a swipe", async ({ page }) => {
    await touchDrag(page, await swipePoint(page, -1), -24, 0);
    await expect(page.locator("#app-title")).toHaveText("Generator");
  });

  test("a swipe starting in a text field is left to the field", async ({ page }) => {
    const box = await page.locator("#gen-prefix").boundingBox();
    await touchDrag(page, { x: box!.x + box!.width * 0.8, y: box!.y + box!.height / 2 }, -200, 0);
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(page.locator("#gen-prefix")).toBeVisible();
  });

  test("a swipe does not navigate while a sheet owns the screen", async ({ page }) => {
    await page.locator("#gen-prefix").fill("411111");
    await page.locator("#gen-generate").tap();
    await page.locator("#gen-export").tap();
    const sheet = page.getByRole("dialog", { name: "Export fixtures" });
    await expect(sheet).toBeVisible();
    await swipe(page, -260);
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(sheet).toBeVisible();
    // The sheet still closes normally afterwards.
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("plays a directional transition and cleans the class up afterwards", async ({ page }) => {
    await swipe(page, -260);
    const incoming = screen(page, "lookup");
    await expect(incoming).not.toHaveClass(/screen-in-forward/);
    await expect(incoming).toBeVisible();
    await expect(incoming).not.toHaveAttribute("hidden");
  });

  test("the bottom navigation remains as the non-swipe alternative", async ({ page }) => {
    for (const tool of TOOLS) {
      await nav(page, tool.id).tap();
      await expect(page.locator("#app-title")).toHaveText(tool.title);
    }
    await expect(page.locator(".bottom-nav .nav-item")).toHaveCount(4);
  });

  test("reduced motion removes the transition but keeps the navigation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await swipe(page, -260);
    await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
    const duration = await screen(page, "lookup").evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });
});

test.describe("interactive stacked-card swipe", () => {
  /** Opens a raw touch stream so a test can pause mid-gesture. */
  async function openTouch(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const from = await swipePoint(page, -260);
    const move = (x: number, y: number) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    return {
      from,
      start: () => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] }),
      move,
      end: async (dx: number) => {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
        return dx;
      },
    };
  }

  test("the card follows the finger and the next page is staged underneath before release", async ({ page }) => {
    const touch = await openTouch(page);
    await touch.start();
    for (let step = 1; step <= 4; step += 1) await touch.move(touch.from.x - (step * 200) / 4, touch.from.y);

    // Still held down: the navigation has not happened, but the card has moved
    // with the finger and the next page is already revealed behind it.
    await expect(page.locator("#app-title")).toHaveText("Generator");
    const card = page.locator(".screen-host.stack-top");
    await expect(card).toHaveAttribute("data-screen", "generator");
    const offset = await card.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41);
    expect(offset).toBeLessThan(-100);
    const under = screen(page, "lookup");
    await expect(under).toHaveClass(/stack-under/);
    await expect(under).not.toHaveAttribute("hidden");

    await touch.end(-200);
    await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
    await expect(card).toHaveCount(0);
    await expect(under).not.toHaveClass(/stack-under/);
    await expect(under).not.toHaveAttribute("style", /transform/);
  });

  test("no screen fades or blanks at any frame of a committed swipe", async ({ page }) => {
    // Sample every screen's opacity and visibility on every animation frame.
    await page.evaluate(() => {
      const samples: { screen: string; opacity: string; hidden: boolean }[] = [];
      (window as unknown as { __samples: typeof samples }).__samples = samples;
      const tick = () => {
        for (const element of document.querySelectorAll<HTMLElement>(".screen-host")) {
          if (element.hidden) continue;
          samples.push({ screen: element.dataset.screen ?? "", opacity: getComputedStyle(element).opacity, hidden: element.hidden });
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    await swipe(page, -260);
    await expect(page.locator("#app-title")).toHaveText("BIN Lookup");
    await page.waitForTimeout(100);
    const samples = await page.evaluate(() => (window as unknown as { __samples: { screen: string; opacity: string }[] }).__samples);
    expect(samples.length).toBeGreaterThan(5);
    expect(samples.filter((sample) => sample.opacity !== "1")).toEqual([]);
  });

  test("a drag too short to commit springs the card back and changes nothing", async ({ page }) => {
    const touch = await openTouch(page);
    await touch.start();
    // Below the flick minimum, so even a fast release must not commit.
    for (let step = 1; step <= 4; step += 1) await touch.move(touch.from.x - (step * 40) / 4, touch.from.y);
    await touch.end(-40);
    await expect(page.locator("#app-title")).toHaveText("Generator");
    await expect(screen(page, "generator")).not.toHaveAttribute("style", /transform/);
    await expect(screen(page, "lookup")).toHaveAttribute("hidden", "");
    await expect(page.locator(".screen-host.stack-top")).toHaveCount(0);
    await expect(screen(page, "generator")).not.toHaveClass(/stack-top/);
  });
});

test.describe("Help page", () => {
  test("is reached from Settings and is not a bottom-navigation destination", async ({ page }) => {
    await nav(page, "settings").tap();
    await page.locator("#settings-open-help").tap();
    await expect(page.locator("#app-title")).toHaveText("Help");
    await expect(page).toHaveURL(/#\/help$/);
    await expect(page.locator('.bottom-nav [data-tool="help"]')).toHaveCount(0);
    await expect(page.locator(".bottom-nav .nav-item")).toHaveCount(4);
  });

  test("returns to Settings by button and by Escape (the browser Back)", async ({ page }) => {
    await nav(page, "settings").tap();
    await page.locator("#settings-open-help").tap();
    await page.locator("#help-back").tap();
    await expect(page.locator("#app-title")).toHaveText("Settings");

    await page.locator("#settings-open-help").tap();
    await page.keyboard.press("Escape");
    await expect(page.locator("#app-title")).toHaveText("Settings");
  });

  test("renders with no external requests and no errors", async ({ page }) => {
    const external = await isolate(page);
    const errors = await collectErrors(page);
    await boot(page, "/#/help");
    await expect(page.locator("#app-title")).toHaveText("Help");
    for (const heading of ["What ORIGEN does", "Generator", "BIN Lookup", "Card Sorter", "Settings", "Community buttons", "Limits and privacy"]) {
      await expect(screen(page, "help").getByRole("heading", { name: heading })).toBeVisible();
    }
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("documents the real limits and keeps the safety warnings", async ({ page }) => {
    await boot(page, "/#/help");
    const text = (await screen(page, "help").textContent()) ?? "";
    expect(text).toContain("the only tool that uses the internet");
    expect(text).toContain("5 MB");
    expect(text).toContain("not reserved test numbers");
    expect(text).toContain("No analytics, tracking, accounts or advertising");
  });
});

test.describe("Settings layout", () => {
  test("groups every setting under a labelled card with an icon", async ({ page }) => {
    await nav(page, "settings").tap();
    const titles = await screen(page, "settings").locator(".card-title").allTextContents();
    expect(titles).toEqual(["Appearance", "Help", "Tools", "BIN metadata service", "Privacy", "About"]);
    for (const card of await screen(page, "settings").locator(".card").all()) {
      await expect(card.locator(".card-title svg")).toBeVisible();
    }
  });

  test("every Settings row and control meets the 48px touch target", async ({ page }) => {
    await nav(page, "settings").tap();
    const small = await screen(page, "settings").evaluate((host) =>
      [...host.querySelectorAll<HTMLElement>("button, a, .segment, .setting-row")]
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.height < 48 || rect.width < 44)
        .map(({ element, rect }) => `${element.tagName}#${element.id}.${element.className} ${Math.round(rect.width)}x${Math.round(rect.height)}`),
    );
    expect(small).toEqual([]);
  });

  test("external links leave the app and in-app rows navigate", async ({ page }) => {
    await nav(page, "settings").tap();
    const links = screen(page, "settings").locator("a.setting-row-link");
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", /^https:\/\//);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    await page.locator("#settings-open-help").tap();
    await expect(page.locator("#app-title")).toHaveText("Help");
  });

  test("stays readable and untruncated in the light theme at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await nav(page, "settings").tap();
    await page.locator('#settings-theme [data-value="light"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll<HTMLElement>(".screen-host:not([hidden]) .screen-scroll")].some((element) => element.scrollWidth > element.clientWidth + 1),
    );
    expect(overflow).toBe(false);
    const clipped = await screen(page, "settings").evaluate((host) =>
      [...host.querySelectorAll<HTMLElement>(".setting-row-copy strong, .card-title, .segment")]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent?.trim() ?? ""),
    );
    expect(clipped).toEqual([]);
  });
});

test.describe("Help page layout", () => {
  for (const width of [320, 412]) {
    test(`does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await boot(page, "/#/help");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth || [...document.querySelectorAll<HTMLElement>(".screen-host:not([hidden]) .screen-scroll")].some((element) => element.scrollWidth > element.clientWidth + 1),
      );
      expect(overflow, `help overflows at ${width}px`).toBe(false);
    });
  }

  test("keeps every touch target and heading intact at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await boot(page, "/#/help");
    const small = await screen(page, "help").evaluate((host) =>
      [...host.querySelectorAll<HTMLElement>("button")]
        .filter((element) => element.offsetParent !== null)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.height < 48)
        .map((rect) => `${Math.round(rect.width)}x${Math.round(rect.height)}`),
    );
    expect(small).toEqual([]);
    await expect(screen(page, "help").getByRole("heading", { name: "Limits and privacy" })).toBeVisible();
  });

  test("safe-area insets pad the Help screen like every other screen", async ({ page }) => {
    await boot(page, "/#/help");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-inset-top", "32px");
      document.documentElement.style.setProperty("--safe-area-inset-bottom", "24px");
    });
    const top = await page.locator(".app-bar").evaluate((element) => element.getBoundingClientRect().height);
    expect(top).toBeGreaterThan(56);
  });
});



