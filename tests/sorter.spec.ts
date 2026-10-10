import { test, expect, type Page } from "@playwright/test";

/**
 * Card Sorter end-to-end coverage: paste, clean, sort, export, files,
 * shortcuts and responsive layout. Everything below is local text handling —
 * the suite also asserts that no request ever leaves the app.
 */
const SAMPLE = [
  "4242424242424242|01|2029|123",
  "4242424242424242|01|2029|123",
  "4242 4242 4242 4242,01,2029,123",
  "5555555555554444|02/30|456",
  "# batch: qa-fixtures",
  "378282246310005:03:2031:4567",
  "   ",
  "some trailing note",
  "5555555555554444|02/30|456",
].join("\n");

const outputLines = async (page: Page) =>
  (await page.locator("#sorter-output").inputValue())
    .split("\n")
    .filter((line, index, all) => !(line === "" && index === all.length - 1));

/**
 * Simulates a paste. Playwright's fill() is quadratic for very large values in
 * this Chromium build, so the value is set the same way a real paste does and
 * an input event is dispatched.
 */
async function paste(page: Page, text: string) {
  const input = page.locator("#sorter-input");
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  await input.evaluate((element, value) => {
    const area = element as HTMLTextAreaElement;
    area.focus();
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function openSorter(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Card Sorter" }).click();
  await expect(page.getByRole("tabpanel", { name: "Card Sorter" })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("cleans pasted test data locally, keeps unknown lines and reports statistics", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://localhost:5173/"))
      externalRequests.push(request.url());
  });
  await openSorter(page);

  await expect(page.getByText("Nothing sorted yet.")).toBeVisible();
  await expect(page.getByText("Local text processing — data is not uploaded.").first()).toBeVisible();

  await page.getByLabel("Card records, one record per line").fill(SAMPLE);
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");
  await expect(page.locator("#sorter-stat-unique")).toHaveText("6");
  await expect(page.locator("#sorter-stat-duplicates")).toHaveText("2");
  await expect(page.locator("#sorter-stat-empty")).toHaveText("1");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("9");
  await expect(page.locator("#sorter-before")).toHaveText("9");
  await expect(page.locator("#sorter-after")).toHaveText("9");
  await expect(page.locator("#sorter-mix")).toContainText("6 records · 3 unrecognized kept");

  await page.getByRole("button", { name: "Remove duplicates" }).click();
  await expect(page.locator("#toast")).toContainText("2 duplicate lines removed");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("7");
  await expect(page.locator("#sorter-after")).toHaveText("7");
  expect(await outputLines(page)).toHaveLength(7);
  expect(await outputLines(page)).toContain("# batch: qa-fixtures");
  expect(await outputLines(page)).toContain("some trailing note");

  await page.getByRole("button", { name: "Remove empty lines" }).click();
  await expect(page.locator("#toast")).toContainText("1 empty line removed");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("6");

  await page.getByRole("button", { name: "Normalize separators" }).click();
  const normalized = await outputLines(page);
  expect(normalized).toContain("4242424242424242|01/29|123");
  expect(normalized).toContain("378282246310005|03/31|4567");
  expect(normalized).toContain("# batch: qa-fixtures");
  expect(normalized).toContain("some trailing note");
  expect(normalized).not.toContain("4242 4242 4242 4242,01,2029,123");

  await page.getByRole("button", { name: "Remove exact duplicate records" }).click();
  await expect(page.locator("#toast")).toContainText("1 duplicate record removed");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("5");

  expect(externalRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("sorts by full line, number prefix, local network and parsed expiry", async ({
  page,
}) => {
  await openSorter(page);
  await page.getByLabel("Card records, one record per line").fill(SAMPLE);
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");
  await page.getByRole("button", { name: "Remove duplicates" }).click();
  await page.getByRole("button", { name: "Remove empty lines" }).click();
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("6");

  await page.getByRole("button", { name: "Sort A to Z" }).click();
  await expect(page.locator("#sorter-status")).toContainText("Sorted by full line · A → Z");
  const ascending = await outputLines(page);
  expect(ascending[0]).toBe("# batch: qa-fixtures");
  expect(ascending.at(-1)).toBe("some trailing note");

  await page.getByRole("button", { name: "Sort Z to A" }).click();
  expect((await outputLines(page))[0]).toBe("some trailing note");

  await page.getByLabel("Sort by").selectOption("expiry");
  await expect(page.locator("#sorter-status")).toContainText("Sorted by parsed expiry · Z → A");
  let lines = await outputLines(page);
  expect(lines[0]).toBe("378282246310005:03:2031:4567");
  expect(lines.slice(-2)).toEqual(["some trailing note", "# batch: qa-fixtures"]);

  await page.getByRole("button", { name: "Sort A to Z" }).click();
  lines = await outputLines(page);
  expect(lines.slice(0, 3)).toEqual([
    "4242424242424242|01|2029|123",
    "4242 4242 4242 4242,01,2029,123",
    "5555555555554444|02/30|456",
  ]);

  await page.getByLabel("Sort by").selectOption("number");
  await page.getByRole("button", { name: "Sort A to Z" }).click();
  expect((await outputLines(page)).slice(0, 3)).toEqual([
    "378282246310005:03:2031:4567",
    "4242424242424242|01|2029|123",
    "4242 4242 4242 4242,01,2029,123",
  ]);

  await page.getByLabel("Sort by").selectOption("network");
  await page.getByRole("button", { name: "Sort A to Z" }).click();
  lines = await outputLines(page);
  expect(lines[0]).toBe("4242424242424242|01|2029|123");
  expect(lines[1]).toBe("4242 4242 4242 4242,01,2029,123");
  expect(lines[2]).toBe("5555555555554444|02/30|456");
  expect(lines[3]).toBe("378282246310005:03:2031:4567");

  await page.getByRole("button", { name: "Reverse order" }).click();
  expect((await outputLines(page))[0]).toBe("# batch: qa-fixtures");
  await page.getByRole("button", { name: "Keep original order" }).click();
  expect((await outputLines(page))[0]).toBe("4242424242424242|01|2029|123");
  await expect(page.locator("#toast")).toContainText("Original paste order restored");
});

test("removes invalid lines only on request and reports how many went", async ({
  page,
}) => {
  await openSorter(page);
  const input = page.getByLabel("Card records, one record per line");
  await input.fill(SAMPLE);
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");

  await page.getByRole("button", { name: "Clean all" }).click();
  await expect(page.locator("#toast")).toContainText("Cleaned 4 lines");
  expect(await outputLines(page)).toContain("# batch: qa-fixtures");
  expect(await outputLines(page)).toContain("some trailing note");

  await page.getByRole("button", { name: "Remove invalid/empty lines" }).click();
  await expect(page.locator("#toast")).toContainText("invalid or empty lines removed");
  const lines = await outputLines(page);
  expect(lines).toHaveLength(3);
  expect(lines).not.toContain("# batch: qa-fixtures");
  await expect(page.locator("#sorter-mix")).toContainText("3 records · 0 unrecognized kept");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("3");
});

test("copies, selects and downloads the cleaned result", async ({ page }) => {
  await openSorter(page);
  await page.getByLabel("Card records, one record per line").fill(SAMPLE);
  await page.getByRole("button", { name: "Clean all" }).click();
  const expected = await page.locator("#sorter-output").inputValue();
  expect(expected.split("\n")).toHaveLength(5);

  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.locator("#toast")).toContainText("5 lines copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

  await page.getByRole("button", { name: "Select all" }).click();
  const selected = await page.evaluate(() => {
    const area = document.querySelector<HTMLTextAreaElement>("#sorter-output")!;
    return area.value.slice(area.selectionStart, area.selectionEnd);
  });
  expect(selected).toBe(expected);
  expect(
    await page.evaluate(
      () => document.activeElement?.id === "sorter-output",
    ),
  ).toBe(true);

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download TXT" }).click(),
  ]).then(([event]) => event);
  expect(download.suggestedFilename()).toMatch(
    /^origen-card-sorter-\d{4}-\d{2}-\d{2}\.txt$/,
  );
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8")).toBe(expected);
  await expect(page.locator("#toast")).toContainText("downloaded");
});

test("loads text files by picker and by drag and drop, rejecting binaries", async ({
  page,
}) => {
  await openSorter(page);
  await page.locator("#sorter-file").setInputFiles({
    name: "qa-batch.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(SAMPLE),
  });
  await expect(page.locator("#toast")).toContainText("qa-batch.txt loaded locally");
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");
  await expect(page.locator("#sorter-status")).toContainText(
    "Loaded qa-batch.txt · 9 lines",
  );

  await page.getByLabel("Card records, one record per line").fill("");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["aaaa\nbbbb\n"], "dropped.txt", { type: "text/plain" }),
    );
    const zone = document.querySelector("#sorter-drop")!;
    zone.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }),
    );
    zone.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true }),
    );
  });
  await expect(page.locator("#sorter-status")).toContainText("Loaded dropped.txt · 2 lines");
  expect(await outputLines(page)).toEqual(["aaaa", "bbbb"]);

  await page.locator("#sorter-file").setInputFiles({
    name: "firmware.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x00, 0x01, 0x02, 0xff]),
  });
  await expect(page.locator("#sorter-error")).toContainText("only reads plain text");
  await expect(page.locator("#toast")).toContainText("Only plain-text files");
  expect(await outputLines(page)).toEqual(["aaaa", "bbbb"]);
});

test("keyboard shortcuts clean, sort and copy without leaving the tab", async ({
  page,
}) => {
  await openSorter(page);
  await page.getByLabel("Card records, one record per line").fill(SAMPLE);
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");

  await page.locator("#sorter-input").press("Control+Shift+U");
  await expect(page.locator("#toast")).toContainText("2 duplicate lines removed");
  await page.locator("#sorter-input").press("Control+Shift+E");
  await expect(page.locator("#toast")).toContainText("1 empty line removed");
  await page.locator("#sorter-input").press("Control+Shift+L");
  await expect(page.locator("#toast")).toContainText(/trimmed|No whitespace/);
  await page.locator("#sorter-input").press("Control+Shift+K");
  await expect(page.locator("#sorter-status")).not.toHaveText("");

  await page.locator("#sorter-input").press("Control+Shift+Digit2");
  await expect(page.locator("#sorter-status")).toContainText("Sorted by full line · Z → A");
  await page.locator("#sorter-input").press("Control+Shift+Digit4");
  await expect(page.locator("#sorter-status")).toContainText("Original paste order restored");

  await page.locator("#sorter-input").press("Control+Enter");
  await expect(page.locator("#toast")).toContainText(/Cleaned|Already clean/);

  await page.locator("#sorter-input").press("Control+Shift+X");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(await page.locator("#sorter-output").inputValue());

  // Shortcuts stay inside the Card Sorter tab.
  await page.getByRole("tab", { name: "Generator" }).click();
  await page.keyboard.press("Control+Shift+Digit3");
  await expect(page.locator("#sorter-status")).not.toContainText("Order reversed");
});

test("empty, loading and error states stay clear and recoverable", async ({
  page,
}) => {
  await openSorter(page);
  await expect(page.getByText("Nothing sorted yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy all" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download TXT" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select all" })).toBeDisabled();

  await page.getByRole("button", { name: "Remove duplicates" }).click();
  await expect(page.locator("#toast")).toContainText("Nothing to process yet");

  await page.getByLabel("Card records, one record per line").fill("# only a note");
  await expect(page.locator("#sorter-stat-input")).toHaveText("1");
  await page.getByRole("button", { name: "Remove invalid/empty lines" }).click();
  await expect(page.getByText("No lines left in the result.")).toBeVisible();
  // Removing is not reversible by sorting: the result stays empty until new text arrives.
  await page.getByRole("button", { name: "Keep original order" }).click();
  expect(await outputLines(page)).toEqual([]);
  await page.getByLabel("Card records, one record per line").fill(
    "4242424242424242|01/29|123\n# only a note",
  );
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("2");
  expect(await outputLines(page)).toEqual([
    "4242424242424242|01/29|123",
    "# only a note",
  ]);

  await page.getByRole("button", { name: "Clear paste and result" }).click();
  await expect(page.locator("#toast")).toContainText("Card Sorter cleared");
  await expect(page.getByText("Nothing sorted yet.")).toBeVisible();
  await expect(page.locator("#sorter-stat-input")).toHaveText("0");
});

test("large pastes report a loading state and finish without losing lines", async ({
  page,
}) => {
  await openSorter(page);
  const lines = Array.from(
    { length: 4000 },
    (_, index) => `424242424242${String(index).padStart(4, "0")},01,29,${String(index % 1000).padStart(3, "0")}`,
  );
  await paste(page, lines.join("\n"));
  await expect(page.locator("#sorter-stat-input")).toHaveText("4000");
  await page.getByRole("button", { name: "Clean all" }).click();
  // Large pastes report a loading state, then finish without losing a line.
  await expect(page.locator("#sorter-output-wrap")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Working through 4000 lines…")).toBeVisible();
  await expect(page.locator("#sorter-output-wrap")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sorter-after")).toHaveText("4000");
  await expect(page.locator("#sorter-stat-remaining")).toHaveText("4000");
  await expect(page.locator("#sorter-status")).toContainText("Cleaned:");
  const value = await page.locator("#sorter-output").inputValue();
  expect(value.split("\n")).toHaveLength(4000);
  expect(value.split("\n")[3999]).toMatch(/^4242424242423999\|01\/29\|\d{3}$/);
});

test("the sorter follows the workspace theme", async ({ page }) => {
  await openSorter(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#sorter-input")).toBeVisible();
  await expect(
    page.getByText("Local text processing — data is not uploaded.").first(),
  ).toBeVisible();
});

test("the sorter stays usable on small viewports", async ({ page }, testInfo) => {
  await openSorter(page);
  await page.getByLabel("Card records, one record per line").fill(SAMPLE);
  await expect(page.locator("#sorter-stat-input")).toHaveText("9");
  await page.getByRole("button", { name: "Clean all" }).click();
  await expect(page.locator("#sorter-after")).toHaveText("5");

  for (const selector of [
    "#sorter-input",
    "#sorter-clean-all",
    "#sorter-stat-remaining",
    "#sorter-output",
    "#sorter-copy-all",
    "#sorter-download",
  ]) {
    await expect(page.locator(selector)).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const output = page.locator("#sorter-output");
  const box = (await output.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(
    (page.viewportSize()?.width ?? 0) + 1,
  );
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-card-sorter.png`,
    fullPage: true,
  });
});
