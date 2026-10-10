import { test, expect } from "@playwright/test";
test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
});
test("brands the workspace as ORIGEN and links the Telegram channel", async ({
  page,
}) => {
  await expect(page).toHaveTitle("ORIGEN — Payment Testing Toolkit");
  await expect(page.getByRole("link", { name: "ORIGEN home" })).toBeVisible();
  await expect(page.locator(".brand")).toHaveText("ORIGEN.");
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "ORIGEN",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "ORIGEN — Payment Testing Toolkit",
  );
  await expect(page.locator("#fixture, #card-lab-link")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Card Lab");
  await expect(page.locator("body")).not.toContainText("Artificial Intelligence");
  await expect(page.locator("body")).not.toContainText("AI-powered");
  const join = page.getByRole("link", { name: /Join Channel/i });
  await expect(join).toBeVisible();
  await expect(join).toHaveAttribute("href", "https://t.me/+y8EekRvqpnQzNjZl");
  await expect(join).toHaveAttribute("target", "_blank");
  await expect(join).toHaveAttribute("rel", "noopener noreferrer");
  await expect(join).toHaveAttribute("aria-label", /Telegram/i);
  await expect(join.locator("svg.telegram-mark")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("opening the Telegram channel targets a new tab without leaving the app", async ({
  context,
  page,
}) => {
  const requested: string[] = [];
  await context.route("https://t.me/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "channel",
    });
  });
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: /Join Channel/i }).click(),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  expect(requested).toEqual(["https://t.me/+y8EekRvqpnQzNjZl"]);
  expect(page.url()).toBe("http://localhost:5173/");
  await popup.close();
});

test("generates locally and all copy actions export the requested data", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("http://localhost:5173/"))
      externalRequests.push(req.url());
  });
  await expect(page.getByText("Your next test starts here.")).toBeVisible();
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page.getByLabel("Network", { exact: true }).selectOption("Visa");
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.locator(".test-banner")).toContainText(
    "TEST DATA ONLY — NOT REAL PAYMENT CARDS",
  );
  await page.getByRole("button", { name: "Copy all" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n")).toHaveLength(10);
  expect(text.split("\n")[0]).toMatch(
    /^424242\d{10} \| \d{2}\/\d{2} \| \d{3}$/,
  );
  await page.getByLabel("Format", { exact: true }).selectOption("csv");
  await page.getByRole("button", { name: "Copy all" }).click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split("\n")[0],
  ).toMatch(/^\d{16},\d{2},\d{2},\d{3}$/);
  await page
    .getByRole("button", { name: "Copy synthetic test fixture 1", exact: true })
    .click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split("\n"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Copy JSON" }).click();
  const json = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(json).toHaveLength(10);
  expect(json[0].synthetic).toBe(true);
  await page.getByLabel("Format", { exact: true }).selectOption("json");
  await page.getByRole("button", { name: "Copy text", exact: true }).click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split("\n")[0],
  ).toContain(" | ");
  await page.getByRole("button", { name: "Code view" }).click();
  await expect(page.locator("#code-output")).toContainText('"synthetic": true');
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Your next test starts here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy all" })).toBeDisabled();
  expect(externalRequests).toEqual([]);
});
test("validates input, network, limits and expiry; supports theme and help", async ({
  page,
}) => {
  await page.getByLabel("BIN / IIN", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("#prefix-error")).toContainText("6–8 digits");
  await expect(page.getByRole("alert")).toContainText(
    "Check the highlighted fields",
  );
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page
    .getByLabel("Network", { exact: true })
    .selectOption("American Express");
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("#network-error")).toContainText(
    "does not match this BIN",
  );
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByLabel("Network", { exact: true }).selectOption("Visa");
  await page.getByLabel("Quantity", { exact: true }).fill("101");
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("#quantity-error")).toContainText(
    "between 1 and 100",
  );
  await page.getByRole("button", { name: "25", exact: true }).click();
  await page.getByLabel("Expiry", { exact: true }).selectOption("custom");
  await page.getByLabel("Month", { exact: true }).selectOption("12");
  await page
    .getByLabel("Year", { exact: true })
    .selectOption(String(new Date().getFullYear() + 1));
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Quick guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Your next test starts here.")).toBeVisible();
});
test("empty and populated layouts stay within viewport", async ({
  page,
}, testInfo) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-empty.png`,
    fullPage: true,
  });
  await page.getByLabel("BIN / IIN", { exact: true }).fill("424242");
  await page.getByRole("button", { name: "Generate Test Data" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-results.png`,
    fullPage: true,
  });
});

test('tabs navigate cleanly and BIN Lookup functions with mocked Guison responses', async ({ page }) => {
  // Mock Guison API endpoints to test UI contract, error states, and history
  await page.route('https://guison-api.onrender.com/**', async route => {
    const url = route.request().url();
    if (url.includes('/readyz')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready' }) });
    } else if (url.includes('/v1/bin/45717360')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          iin: '45717360',
          match: { start: '457173', end: '457173', length: 6 },
          number: { length: 16, luhn: true },
          scheme: 'visa',
          brand: 'Visa/Dankort',
          type: 'debit',
          level: 'classic',
          prepaid: false,
          country: { alpha2: 'DK', alpha3: 'DNK', name: 'Denmark', emoji: '🇩🇰', currency: 'DKK' },
          bank: { name: 'Jyske Bank', url: 'www.jyskebank.dk' }
        })
      });
    } else if (url.includes('/v1/bin/999999')) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'not_found', message: 'No record covers this BIN/IIN' } })
      });
    } else {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
    }
  });

  // Switch to BIN Lookup tab
  await page.getByRole('tab', { name: 'BIN Lookup' }).click();
  await expect(page.getByRole('tabpanel', { name: 'BIN Lookup' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Generator' })).toBeHidden();

  // Validate prefix length error
  await page.getByLabel('BIN / IIN to look up').fill('123');
  await page.getByRole('button', { name: 'Lookup metadata' }).click();
  await expect(page.locator('#lookup-error')).toContainText('6–8 digits');

  // Successful lookup
  await page.getByLabel('BIN / IIN to look up').fill('45717360');
  await page.getByRole('button', { name: 'Lookup metadata' }).click();
  await expect(page.locator('#metadata-content')).toContainText('Jyske Bank');
  await expect(page.locator('#metadata-content')).toContainText('Denmark');
  await expect(page.locator('#lookup-history')).toContainText('45717360');

  // Copy metadata
  await page.getByRole('button', { name: 'Copy metadata', exact: true }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Jyske Bank');
  expect(text).toContain('BIN / IIN METADATA ONLY');

  // Copy metadata JSON
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(json.iin).toBe('45717360');

  // 404 handling
  await page.getByLabel('BIN / IIN to look up').fill('999999');
  await page.getByRole('button', { name: 'Lookup metadata' }).click();
  await expect(page.locator('#lookup-error')).toContainText('No metadata was found');

  // Check Settings tab
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('#settings-history-count')).toContainText('1');

  // Check API Status
  await page.getByRole('button', { name: 'Check API status' }).click();
  await expect(page.locator('#api-status-badge')).toContainText('Ready');

  // Clear history in Settings
  await page.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.locator('#settings-history-count')).toContainText('0');

  // Header Generator link returns to Generator tab and restores aria-current
  await expect(page.locator('#generator-link')).not.toHaveAttribute('aria-current', 'page');
  await page.locator('#generator-link').click();
  await expect(page.getByRole('tabpanel', { name: 'Generator' })).toBeVisible();
  await expect(page.locator('#generator-link')).toHaveAttribute('aria-current', 'page');

  // Keyboard navigation across tabs
  await page.getByRole('tab', { name: 'Generator' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'BIN Lookup' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Generator' })).toHaveAttribute('aria-selected', 'true');
});

test('supports generator keyboard shortcut, downloads, and responsive viewports from 320px to 1920px', async ({ page }) => {
  // Generate via keyboard shortcut (Ctrl+Enter)
  await page.getByLabel('BIN / IIN', { exact: true }).fill('424242');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('tbody tr')).toHaveCount(10);

  // Verify TXT, CSV, JSON fixture downloads
  for (const ext of ['txt', 'csv', 'json'] as const) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Export ${ext.toUpperCase()}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`fixture-test-data.${ext}`);
  }

  // Sweep responsive viewports across all 4 tabs and Quick Guide dialog
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const tab of ['Generator', 'BIN Lookup', 'Card Sorter', 'Settings']) {
      await page.getByRole('tab', { name: tab }).click();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, `Horizontal overflow on ${tab} at ${width}x${height}`).toBe(true);
    }
  }
});

