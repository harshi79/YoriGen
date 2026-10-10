import { test, expect, type Page } from "@playwright/test";

/**
 * ORIGEN Generator end-to-end coverage for the redesigned five-step builder:
 * BIN / IIN → Expiry → CVV → Quantity → Generate.
 *
 * The suite drives the complete flow on desktop and mobile-sized viewports and
 * asserts that generation stays local: no request ever leaves the app, no
 * external validation service is contacted, and every produced row is labeled
 * as a synthetic test fixture.
 */

/** Independent Luhn check so fixtures are verified without reusing app code. */
function luhn(value: string): boolean {
  let sum = 0;
  for (let index = value.length - 1, double = false; index >= 0; index--, double = !double) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const numbers = async (page: Page) =>
  (await page.locator("tbody tr td.card-number").allTextContents()).map((value) =>
    value.replace(/\s+/g, ""),
  );

const generate = (page: Page) =>
  page.getByRole("button", { name: "Generate Test Data", exact: true }).click();

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("completes the whole builder flow with Auto modes and labeled results", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://localhost:5173/"))
      externalRequests.push(request.url());
  });
  await page.goto("/");
  const panel = page.getByRole("tabpanel", { name: "Generator" });
  await expect(panel).toBeVisible();

  // Step 1 · BIN / IIN with Auto off and a synthetic prefix.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await expect(page.locator("#detected")).toContainText("Detected locally · Visa");

  // Step 5 · live summary before generating.
  await expect(page.locator("#summary")).toHaveText(
    "Visa · 16 digits · Auto expiry · Auto CVV · 10 fixtures",
  );

  // Generate.
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10);

  // Results remain the existing table, now with a synthetic fixture label.
  await expect(page.locator(".fixture-banner")).toContainText("SYNTHETIC TEST FIXTURE");
  await expect(page.locator("tbody .fixture-badge")).toHaveCount(10);
  expect(
    await page.locator("tbody .fixture-badge").allTextContents(),
  ).toEqual(Array.from({ length: 10 }, () => "SYNTHETIC TEST FIXTURE"));

  // Fixtures honor the BIN, keep the test format and a future expiry.
  const rows = await numbers(page);
  expect(rows.every((value) => value.startsWith("424242"))).toBe(true);
  expect(rows.every((value) => value.length === 16 && luhn(value))).toBe(true);
  const expiry = await page.locator("tbody tr td.mono").first().textContent();
  const [month, shortYear] = expiry!.split("/");
  expect(Number(month)).toBeGreaterThanOrEqual(1);
  expect(Number(month)).toBeLessThanOrEqual(12);
  expect(2000 + Number(shortYear)).toBeGreaterThanOrEqual(new Date().getFullYear());
  // Auto CVV keeps the network width.
  for (const cell of await page.locator("tbody .cvv-cell").allTextContents())
    expect(cell).toMatch(/^\d{3}$/);

  // Existing copy + export functionality is intact.
  await page.getByRole("button", { name: "Copy all" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")).toHaveLength(10);
  expect(copied.split("\n")[0]).toMatch(/^424242\d{10} \| \d{2}\/\d{2} \| \d{3}$/);
  for (const ext of ["txt", "csv", "json"] as const) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: `Export ${ext.toUpperCase()}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`fixture-test-data.${ext}`);
  }

  // Clear returns to the empty state.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Your next test starts here.")).toBeVisible();
  await expect(page.locator(".fixture-banner")).toBeHidden();

  expect(externalRequests).toEqual([]);
});

test("Auto BIN mode builds prefixes locally and randomizes compatible networks", async ({
  page,
}) => {
  await page.goto("/");
  const auto = page.getByLabel("Auto", { exact: true });
  await expect(auto).not.toBeChecked();
  await auto.check();
  await expect(page.getByLabel("BIN / IIN", { exact: true })).toBeDisabled();
  await expect(page.locator("#detected")).toContainText("Auto");
  await expect(page.locator("#summary")).toHaveText(
    "Auto network · 14–19 digits · Auto expiry · Auto CVV · 10 fixtures",
  );
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  const rows = await numbers(page);
  expect(rows.every((value) => value.length >= 14 && value.length <= 19)).toBe(true);
  expect(rows.every((value) => luhn(value))).toBe(true);
  const networks = await page.locator("tbody .network-badge").allTextContents();
  expect(
    networks.every((name) =>
      /^(Visa|Mastercard|Amex|Discover|JCB|Diners|UnionPay|Maestro|RuPay)$/.test(name.trim()),
    ),
  ).toBe(true);
  // Auto ignores typed digits: enabling it clears nothing, but nothing is used.
  await auto.uncheck();
  await page.getByLabel("BIN / IIN", { exact: true }).fill("378282");
  await auto.check();
  await generate(page);
  await expect
    .poll(async () => (await numbers(page)).some((value) => value.startsWith("378282")))
    .toBe(false);
  const autoRows = await numbers(page);
  expect(autoRows.every((value) => !value.startsWith("378282"))).toBe(true);
});

test("BIN validation reports friendly inline errors and blocks generation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Your next test starts here.")).toBeVisible();
  await expect(page.locator("#prefix-error")).toBeHidden();

  // Empty manual BIN.
  await generate(page);
  await expect(page.locator("#prefix-error")).toContainText("6–8 digit synthetic BIN");
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.getByText("Your next test starts here.")).toBeVisible();

  // Too short / not numeric.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("4242");
  await expect(page.locator("#prefix-error")).toContainText("6–8 digits");
  await expect(page.getByLabel("BIN / IIN", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  // A full card number is never truncated into a BIN.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("4242424242424242");
  await expect(page.locator("#prefix-error")).toHaveText(
    "Please enter a BIN/IIN prefix or masked synthetic template, not a complete card number.",
  );
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(0);

  // Letters are rejected.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("42424a");
  await expect(page.locator("#prefix-error")).toContainText("6–8 digits");

  // Unsupported prefix / network combination.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page.getByLabel("Network", { exact: true }).selectOption("American Express");
  await expect(page.locator("#network-error")).toContainText("does not match this BIN");
  await expect(page.locator("#network-error")).toContainText("Visa");
  await expect(page.locator("#summary")).toHaveText(
    "Network pending · length pending · Auto expiry · Auto CVV · 10 fixtures",
  );

  // A prefix no supported network covers.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("999999");
  await page.getByLabel("Network", { exact: true }).selectOption("Auto");
  await expect(page.locator("#network-error")).toContainText(
    "No supported test network matches this BIN",
  );

  // A supported combination recovers cleanly.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("378282");
  await expect(page.locator("#prefix-error")).toBeHidden();
  await expect(page.locator("#network-error")).toBeHidden();
  await expect(page.locator("#detected")).toContainText("Amex");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  const rows = await numbers(page);
  expect(rows.every((value) => value.startsWith("378282") && value.length === 15)).toBe(true);
  expect(rows.every((value) => luhn(value))).toBe(true);
  for (const cell of await page.locator("tbody .cvv-cell").allTextContents())
    expect(cell).toMatch(/^\d{4}$/);
});

test("masked templates keep all visible digits and generate only synthetic mask positions", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("BIN / IIN", { exact: true });

  for (const [template, visiblePrefix, network] of [
    ["424242xxxxxxxxxx", "424242", "Visa"],
    ["42424242XXXXXXXX", "42424242", "Visa"],
    ["5279109907xxxxxx", "5279109907", "Mastercard"],
  ]) {
    await input.fill(template);
    await expect(page.locator("#prefix-error")).toBeHidden();
    await expect(page.locator("#detected")).toContainText(network);
    await generate(page);
    await expect
      .poll(async () => {
        const rows = await numbers(page);
        return rows.length === 10 && rows.every((number) => number.startsWith(visiblePrefix));
      })
      .toBe(true);

    const rows = await numbers(page);
    expect(
      rows.every(
        (number) =>
          number.startsWith(visiblePrefix) &&
          number.length === 16 &&
          /^\d+$/.test(number) &&
          luhn(number),
      ),
    ).toBe(true);
  }
});

test("Custom expiry and Custom CVV drive the generated fixtures", async ({ page }) => {
  await page.goto("/");
  const nextYear = new Date().getFullYear() + 1;

  // Step 2 · Custom expiry defaults to Auto until changed.
  await expect(page.locator("#expiry-fields")).toBeHidden();
  await page.getByLabel("Expiry", { exact: true }).selectOption("custom");
  await expect(page.locator("#expiry-fields")).toBeVisible();
  await page.getByLabel("Month", { exact: true }).selectOption("12");
  await page.getByLabel("Year", { exact: true }).selectOption(String(nextYear));

  // Step 3 · Custom CVV.
  await page.getByLabel("CVV", { exact: true }).selectOption("custom");
  await expect(page.locator("#cvv-fields")).toBeVisible();
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page.getByLabel("Custom CVV").fill("123");
  await expect(page.locator("#summary")).toHaveText(
    `Visa · 16 digits · Expiry 12/${String(nextYear).slice(-2)} · Custom CVV (3 digits) · 10 fixtures`,
  );
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator("tbody tr td.mono").first()).toHaveText(
    `12/${String(nextYear).slice(-2)}`,
  );
  expect(await page.locator("tbody .cvv-cell").allTextContents()).toEqual(
    Array.from({ length: 10 }, () => "123"),
  );

  // A custom CVV with the wrong length is refused inline.
  await page.getByLabel("Custom CVV").fill("1234");
  await expect(page.locator("#cvv-error")).toContainText("3-digit CVV");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10); // unchanged output

  // Amex accepts the 4-digit length.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("371234");
  await page.getByLabel("Custom CVV").fill("0000");
  await expect(page.locator("#cvv-error")).toBeHidden();
  await generate(page);
  await expect(page.locator("tbody .cvv-cell").first()).toHaveText("0000");
  expect(await page.locator("tbody .cvv-cell").allTextContents()).toEqual(
    Array.from({ length: 10 }, () => "0000"),
  );

  // Malformed values are refused.
  await page.getByLabel("Custom CVV").fill("12");
  await expect(page.locator("#cvv-error")).toContainText("3 or 4 digits");
  // Auto still works with no custom value at all.
  await page.getByLabel("CVV", { exact: true }).selectOption("auto");
  await expect(page.locator("#cvv-error")).toBeHidden();
  await generate(page);
  await expect(page.locator("tbody .cvv-cell").first()).toHaveText(/^\d{4}$/);
  for (const cell of await page.locator("tbody .cvv-cell").allTextContents())
    expect(cell).toMatch(/^\d{4}$/);

  // A past month in the current year is refused with an inline message.
  const pastMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page.getByLabel("Expiry", { exact: true }).selectOption("custom");
  await page.getByLabel("Month", { exact: true }).selectOption(pastMonth);
  await page
    .getByLabel("Year", { exact: true })
    .selectOption(String(new Date().getFullYear()));
  await expect(page.locator("#expiry-error")).toContainText("after the current month");
  await generate(page);
  await expect(page.locator("tbody .cvv-cell")).toHaveCount(10);
  // Auto recovers, and Auto expiry is a future date again.
  await page.getByLabel("Expiry", { exact: true }).selectOption("auto");
  await expect(page.locator("#expiry-error")).toBeHidden();
  await generate(page);
  const [month, shortYear] = (await page.locator("tbody tr td.mono").first().textContent())!.split("/");
  expect(2000 + Number(shortYear)).toBeGreaterThanOrEqual(new Date().getFullYear());
  expect(Number(month)).toBeGreaterThanOrEqual(1);
});

test("quantity presets and manual quantities are validated", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");

  // Presets 1 / 5 / 10 / 25 / 50 / 100 exist and are pressed states.
  const presets = page.locator("[data-quantity]");
  await expect(presets).toHaveCount(6);
  expect(await presets.allTextContents()).toEqual(["1", "5", "10", "25", "50", "100"]);
  await expect(page.locator('[data-quantity="10"]')).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.locator("#summary")).toContainText("1 fixture");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: "100", exact: true }).click();
  await expect(page.locator("#summary")).toContainText("100 fixtures");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(100);

  await page.getByRole("button", { name: "5", exact: true }).click();
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(5);

  // Invalid quantities show an inline error instead of generating.
  for (const value of ["0", "101", "-3", "2.5"]) {
    await page.getByLabel("Quantity", { exact: true }).fill(value);
    await expect(page.locator("#quantity-error")).toContainText("between 1 and 100");
    await generate(page);
    await expect(page.locator("#error")).toContainText("Check the highlighted fields");
    await expect(page.locator("tbody tr")).toHaveCount(5);
  }
  await page.getByLabel("Quantity", { exact: true }).fill("25");
  await expect(page.locator("#quantity-error")).toBeHidden();
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(25);
});

test("desktop and mobile layouts complete the flow without horizontal overflow", async ({
  page,
}, testInfo) => {
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [320, 568],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByRole("tabpanel", { name: "Generator" })).toBeVisible();

    // Auto BIN, Auto expiry, Auto CVV, preset quantity, generate.
    await page.getByLabel("Auto", { exact: true }).check();
    await page.getByRole("button", { name: "25", exact: true }).click();
    await expect(page.locator("#summary")).toContainText("25 fixtures");
    await generate(page);
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(page.locator("tbody .fixture-badge")).toHaveCount(25);

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, `Horizontal overflow at ${width}x${height}`).toBe(true);

    // Touch-friendly control sizes: key controls stay at least 32px tall.
    for (const selector of [".auto-switch", '[data-quantity="10"]', "#generate"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.height, `${selector} at ${width}px`).toBeGreaterThanOrEqual(32);
    }
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-${width}-generator.png`,
      fullPage: true,
    });
  }
});

test("the whole flow works with the keyboard and keeps the guide accurate", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("BIN / IIN", { exact: true }).focus();
  await page.getByLabel("BIN / IIN", { exact: true }).fill("222100");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("tbody tr")).toHaveCount(10);
  expect(await page.locator("tbody .network-badge").first().textContent()).toContain("Mastercard");
  await page.getByRole("button", { name: "Quick guide" }).click();
  const guide = page.getByRole("dialog");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("SYNTHETIC TEST FIXTURE");
  await expect(guide).toContainText("Auto");
  await page.keyboard.press("Escape");
  await expect(guide).not.toBeVisible();
});

test("extended networks are selectable and generate in their own formats", async ({
  page,
}) => {
  await page.goto("/");
  const network = page.getByLabel("Network", { exact: true });

  // Every supported network is offered alongside Auto and Random.
  await expect(network).toHaveCount(1);
  expect(await network.locator("option").allTextContents()).toEqual([
    "Auto",
    "Visa",
    "Mastercard",
    "Amex",
    "Discover",
    "JCB",
    "Diners",
    "UnionPay",
    "Maestro",
    "RuPay",
    "Random",
  ]);

  // Pinning a network explains its accepted length and CVV width locally.
  await network.selectOption("JCB");
  await expect(page.locator("#network-hint")).toContainText("JCB · 16–19 digits · 3-digit CVV");
  // With no BIN entered every network is still compatible, so the CVV hint
  // keeps describing the full Auto range rather than the pinned network.
  await expect(page.locator("#cvv-hint")).toContainText("4 digits for Amex");

  // JCB prefixes generate inside the JCB window and stay Luhn-compatible.
  await page.getByLabel("BIN / IIN", { exact: true }).fill("353011");
  await expect(page.locator("#detected")).toContainText("JCB");
  // Only JCB matches this prefix, so the CVV hint narrows to its width.
  await expect(page.locator("#cvv-hint")).toContainText("3 digits for JCB");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  expect(await page.locator("tbody .network-badge").allTextContents()).toEqual(
    Array.from({ length: 10 }, () => "JCB"),
  );
  const jcb = await numbers(page);
  expect(jcb.every((value) => value.startsWith("353011"))).toBe(true);
  expect(jcb.every((value) => value.length >= 16 && value.length <= 19)).toBe(true);
  expect(jcb.every((value) => luhn(value))).toBe(true);

  // Diners Club uses a 14–19 digit body and is badged with its short name.
  await network.selectOption("Diners Club");
  await page.getByLabel("BIN / IIN", { exact: true }).fill("305693");
  await expect(page.locator("#summary")).toHaveText(
    "Diners · 14–19 digits · Auto expiry · Auto CVV · 10 fixtures",
  );
  await generate(page);
  // Generation is asynchronous: wait for the new rows before reading them,
  // otherwise the previous JCB run is still on screen.
  await expect(page.locator("tbody .network-badge").first()).toHaveText("Diners");
  const diners = await numbers(page);
  expect(diners.every((value) => value.startsWith("305693"))).toBe(true);
  expect(diners.every((value) => value.length >= 14 && value.length <= 19)).toBe(true);
  expect(diners.every((value) => luhn(value))).toBe(true);
  await expect(page.locator("tbody .network-badge").first()).toHaveText("Diners");

  // An out-of-range prefix for the pinned network is still refused inline.
  await network.selectOption("JCB");
  await page.getByLabel("BIN / IIN", { exact: true }).fill("359000");
  await expect(page.locator("#network-error")).toContainText("does not match this BIN");
  await generate(page);
  await expect(page.locator("tbody tr")).toHaveCount(10); // previous output untouched
});
