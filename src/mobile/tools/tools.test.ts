// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMetadata, type BinMetadata } from "../../guison";
import { BinServiceError, type BinMetadataService } from "../services/bin-service";
import { createConfig } from "../config";
import { $, bootShell, flush, typeInto } from "../test-support";
import { defaultGeneratorValues, generatorOptionsFor } from "./generator";
import { isPlainTextFile, LOADING_THRESHOLD, MAX_FILE_BYTES } from "./sorter";

const sample = (bin = "457173"): BinMetadata =>
  parseMetadata(
    { iin: bin, scheme: "visa", type: "debit", brand: "Visa Classic", number: { length: 16, luhn: true }, country: { alpha2: "GB", name: "United Kingdom", currency: "GBP" }, bank: { name: "Example Bank" } },
    bin,
  );

function stubService(overrides: Partial<BinMetadataService> = {}): BinMetadataService {
  return {
    origin: "https://bin.example.com",
    label: "Example BIN API",
    lookup: vi.fn(async (bin: string) => sample(bin)),
    checkStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

const click = (selector: string) => $<HTMLButtonElement>(selector).click();
const toastText = () => document.querySelector(".toast")?.textContent ?? "";
const confirmSheet = () => click("dialog[open] [data-confirm]");
const cancelSheet = () => click("dialog[open] .btn-ghost");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network disabled in tests"))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Generator tool", () => {
  it("maps builder values onto generator options", () => {
    const values = defaultGeneratorValues(new Date(2026, 9, 10));
    expect(values).toMatchObject({ month: 10, year: 2027, quantity: 10, binMode: "manual" });
    expect(generatorOptionsFor({ ...values, binMode: "auto", prefix: "411111" }).prefix).toBe("");
  });

  it("blocks generation with a clear error until the form is valid", () => {
    bootShell();
    click("#gen-generate");
    expect($("#gen-form-error").hidden).toBe(false);
    expect(document.querySelectorAll("#gen-results-list .fixture")).toHaveLength(0);
    typeInto($<HTMLInputElement>("#gen-prefix"), "4111111111111111");
    click("#gen-generate");
    expect($<HTMLInputElement>("#gen-prefix").getAttribute("aria-invalid")).toBe("true");
  });

  it("explains masked templates and unsupported prefixes", () => {
    bootShell();
    const prefix = $<HTMLInputElement>("#gen-prefix");
    typeInto(prefix, "5279109907xxxxxx");
    expect($("#gen-detected").textContent).toContain("masked positions filled locally");
    typeInto(prefix, "111111");
    expect($("#gen-detected").textContent).toBe("No supported network matches");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    prefix.focus();
    prefix.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(prefix);
  });

  it("detects the network as the prefix is typed", () => {
    bootShell();
    typeInto($<HTMLInputElement>("#gen-prefix"), "378282");
    expect($("#gen-detected").textContent).toMatch(/American Express|Amex/);
  });

  it("generates the chosen quantity of labelled synthetic fixtures", () => {
    bootShell();
    typeInto($<HTMLInputElement>("#gen-prefix"), "411111");
    click('[data-quantity="5"]');
    expect($<HTMLInputElement>("#gen-quantity").value).toBe("5");
    click("#gen-generate");
    const rows = document.querySelectorAll("#gen-results-list .fixture");
    expect(rows).toHaveLength(5);
    expect([...rows].every((row) => row.textContent?.includes("SYNTHETIC TEST FIXTURE"))).toBe(true);
    expect(toastText()).toContain("5 synthetic test fixtures generated");
    expect($("#gen-results-meta").textContent).toContain("Luhn");
  });

  it("steps quantity within limits and supports auto prefix, custom expiry and CVV", () => {
    bootShell();
    const quantity = $<HTMLInputElement>("#gen-quantity");
    click('[data-quantity="100"]');
    click('[aria-label="Increase quantity"]');
    expect(quantity.value).toBe("100");
    click('[data-quantity="1"]');
    click('[aria-label="Decrease quantity"]');
    expect(quantity.value).toBe("1");
    typeInto(quantity, "3");

    const auto = $<HTMLInputElement>("#gen-bin-auto");
    auto.checked = true;
    auto.dispatchEvent(new Event("change", { bubbles: true }));
    expect($<HTMLInputElement>("#gen-prefix").disabled).toBe(true);

    click('#gen-expiry-mode [data-value="custom"]');
    const year = $<HTMLSelectElement>("#gen-year");
    year.value = year.options[year.options.length - 1].value;
    year.dispatchEvent(new Event("change", { bubbles: true }));
    click('#gen-cvv-mode [data-value="custom"]');
    typeInto($<HTMLInputElement>("#gen-cvv"), "12");
    click("#gen-generate");
    expect($("#gen-form-error").hidden).toBe(false);
    typeInto($<HTMLInputElement>("#gen-cvv"), "123");
    const network = $<HTMLSelectElement>("#gen-network");
    network.value = "Visa";
    network.dispatchEvent(new Event("change", { bubbles: true }));
    click("#gen-generate");
    const rows = [...document.querySelectorAll("#gen-results-list .fixture")];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.textContent?.includes("CVV 123"))).toBe(true);
  });

  it("copies, re-formats, exports and clears results", async () => {
    const { platform } = bootShell();
    typeInto($<HTMLInputElement>("#gen-prefix"), "411111");
    click('[data-quantity="1"]');
    click("#gen-generate");
    click("#gen-copy-all");
    await flush();
    expect(platform.clipboard.write.mock.calls.at(-1)?.[0]).toMatch(/^4111\d{12} \| \d{2}\/\d{2} \| \d{3}$/);

    const format = $<HTMLSelectElement>("#gen-format");
    format.value = "json";
    format.dispatchEvent(new Event("change", { bubbles: true }));
    click('[aria-label="Copy synthetic test fixture 1"]');
    await flush();
    expect(platform.clipboard.write.mock.calls.at(-1)?.[0]).toContain('"synthetic": true');

    click("#gen-export");
    click('dialog[open] [data-export="csv"]');
    await flush();
    expect(platform.files.export).toHaveBeenCalledWith(expect.objectContaining({ mime: expect.stringContaining("csv") }));

    click('[aria-label="Clear results"]');
    cancelSheet();
    await flush();
    expect(document.querySelectorAll("#gen-results-list .fixture")).toHaveLength(1);
    click('[aria-label="Clear results"]');
    confirmSheet();
    await flush();
    expect(document.querySelectorAll("#gen-results-list .fixture")).toHaveLength(0);
    expect($("#gen-builder").hidden).toBe(false);
  });

  it("switches between builder and results views", () => {
    const { shell } = bootShell();
    click('#gen-view [data-value="results"]');
    expect($("#gen-results").hidden).toBe(false);
    expect($("#gen-results").textContent).toMatch(/No fixtures|Nothing|yet/i);
    click('#gen-view [data-value="builder"]');
    expect($("#gen-builder").hidden).toBe(false);
    expect(shell.screen("generator")?.handleBack?.()).toBe(false);
  });
});

describe("BIN Lookup tool", () => {
  it("shows metadata from the service, labelled as metadata only", async () => {
    const service = stubService();
    const { platform } = bootShell({ hash: "#/lookup", binService: service });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    await flush();
    expect(service.lookup).toHaveBeenCalledWith("457173", expect.any(AbortSignal));
    const result = $("#lookup-result");
    expect(result.textContent).toContain("Example Bank");
    // The service label keeps the casing it is configured with: caps in the UI
    // come from CSS, never from the source string or from .toUpperCase().
    expect(result.textContent).toContain("Example BIN API");
    expect(result.textContent).not.toContain("EXAMPLE BIN API");
    expect(result.textContent).toContain("not card verification");
    expect(toastText()).toContain("No card or account was verified");

    const [copy, copyJson] = result.querySelectorAll<HTMLButtonElement>(".btn-row .btn");
    copy.click();
    copyJson.click();
    await flush();
    expect(platform.clipboard.write.mock.calls.at(-1)?.[0]).toContain('"iin": "457173"');
  });

  it("keeps recent lookups for this session and reopens them as snapshots", async () => {
    const service = stubService();
    const { shell } = bootShell({ hash: "#/lookup", binService: service });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    await flush();
    typeInto($<HTMLInputElement>("#lookup-bin"), "411111");
    click("#lookup-submit");
    await flush();
    const items = document.querySelectorAll<HTMLButtonElement>("#lookup-history .history-item");
    expect(items).toHaveLength(2);
    [...items].find((item) => item.textContent?.includes("457173"))?.click();
    expect($("#lookup-result").textContent).toContain("Session snapshot");
    expect($<HTMLInputElement>("#lookup-bin").value).toBe("457173");
    expect(service.lookup).toHaveBeenCalledTimes(2);

    shell.context.navigate("settings");
    click("#settings-clear-history");
    expect(toastText()).toContain("2 recent lookups cleared");
    expect(document.querySelectorAll("#lookup-history .history-item")).toHaveLength(0);
    click("#settings-clear-history");
    expect(toastText()).toContain("No session history to clear");
  });

  it("shows not-found as a normal empty result without retry", async () => {
    const service = stubService({ lookup: vi.fn(async () => Promise.reject(new BinServiceError("not_found", "No metadata was found for this BIN / IIN."))) });
    bootShell({ hash: "#/lookup", binService: service });
    typeInto($<HTMLInputElement>("#lookup-bin"), "999999");
    click("#lookup-submit");
    await flush();
    expect($("#lookup-result .state-empty").textContent).toContain("No metadata for 999999");
    expect(document.querySelector("#lookup-result button")).toBeNull();
  });

  it("offers retry for transient failures and recovers", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new BinServiceError("timeout", "Guison did not answer in time."))
      .mockImplementation(async (bin: string) => sample(bin));
    bootShell({ hash: "#/lookup", binService: stubService({ lookup }) });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    await flush();
    expect($("#lookup-result .state-error").textContent).toContain("Guison did not answer in time.");
    click("#lookup-result .state-error button");
    await flush();
    expect($("#lookup-result").textContent).toContain("Example Bank");
  });

  it("treats unexpected errors as failures, not data", async () => {
    bootShell({ hash: "#/lookup", binService: stubService({ lookup: vi.fn(async () => Promise.reject(new Error("weird"))) }) });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    await flush();
    expect($("#lookup-result .state-error").textContent).toContain("failed unexpectedly");
  });

  it("cancels a pending request with Back or the Cancel button", async () => {
    let signal: AbortSignal | undefined;
    const lookup = vi.fn(
      (_bin: string, s?: AbortSignal) =>
        new Promise<BinMetadata>((_resolve, reject) => {
          signal = s;
          s?.addEventListener("abort", () => reject(new BinServiceError("cancelled", "Lookup cancelled.")));
        }),
    );
    const { shell } = bootShell({ hash: "#/lookup", binService: stubService({ lookup }) });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    expect($<HTMLButtonElement>("#lookup-submit").disabled).toBe(true);
    expect($("#lookup-result").getAttribute("aria-busy")).toBe("true");
    // A second submit while loading is ignored.
    click("#lookup-submit");
    expect(lookup).toHaveBeenCalledTimes(1);
    shell.handleBack();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(shell.navigator.current).toBe("lookup");
    expect($<HTMLButtonElement>("#lookup-submit").disabled).toBe(false);
    expect($("#lookup-result .state-empty")).toBeTruthy();

    click("#lookup-submit");
    click("#lookup-result .state-loading button");
    await flush();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect($("#lookup-result .state-empty")).toBeTruthy();
  });

  it("follows connectivity and announces when it comes back", async () => {
    const service = stubService({ lookup: vi.fn(async () => Promise.reject(new BinServiceError("offline", "You're offline."))) });
    const { setOnline } = bootShell({ hash: "#/lookup", binService: service, online: false });
    expect($("#lookup-offline").hidden).toBe(false);
    expect($("#lookup-network").textContent).toBe("Offline");
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    click("#lookup-submit");
    await flush();
    setOnline(true);
    expect($("#lookup-offline").hidden).toBe(true);
    expect(toastText()).toContain("Back online");
  });
});

describe("Card Sorter tool", () => {
  const RECORDS = "4111111111111111|12|2030|123\n4111111111111111|12|2030|123\n\n5555555555554444|01|2029|999";

  async function paste(text: string) {
    typeInto($<HTMLTextAreaElement>("#sorter-input"), text);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  it("validates file types and sizes", () => {
    expect(isPlainTextFile({ type: "text/plain", name: "a" })).toBe(true);
    expect(isPlainTextFile({ type: "", name: "cards.CSV" })).toBe(true);
    expect(isPlainTextFile({ type: "image/png", name: "a.png" })).toBe(false);
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(LOADING_THRESHOLD).toBeGreaterThan(100);
  });

  it("counts lines live and cleans without dropping unrecognized lines", async () => {
    bootShell({ hash: "#/sorter" });
    await paste(`${RECORDS}\nnot a record`);
    expect($("#sorter-stat-input").textContent).toBe("5");
    expect($("#sorter-line-badge").textContent).toBe("5 lines");
    click("#sorter-quick-clean");
    await flush();
    expect($("#sorter-result-view").hidden).toBe(false);
    expect($<HTMLTextAreaElement>("#sorter-output").value).toContain("not a record");
    expect($("#sorter-status").textContent).toContain("removed");
    expect(toastText()).toContain("everything else kept");
  });

  it("runs chip actions, sorts both ways and returns to input on Back", async () => {
    const { shell, platform } = bootShell({ hash: "#/sorter" });
    await paste("b|1\na|2\nc|3");
    click("#sorter-view-result");
    click('[data-action="reverse"]');
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-output").value).toBe("c|3\na|2\nb|1");
    click('[aria-label="Sort ascending"]');
    expect($<HTMLTextAreaElement>("#sorter-output").value).toBe("a|2\nb|1\nc|3");
    const key = $<HTMLSelectElement>("#sorter-sort-key");
    key.value = "line";
    key.dispatchEvent(new Event("change", { bubbles: true }));
    click('[aria-label="Sort descending"]');
    expect($<HTMLTextAreaElement>("#sorter-output").value).toBe("c|3\nb|1\na|2");

    click("#sorter-copy-all");
    await flush();
    expect(platform.clipboard.write).toHaveBeenLastCalledWith("c|3\nb|1\na|2");
    click("#sorter-export");
    await flush();
    expect(platform.files.export).toHaveBeenCalled();

    shell.handleBack();
    expect($("#sorter-input-view").hidden).toBe(false);
    expect(shell.navigator.current).toBe("sorter");
    shell.handleBack();
    expect(shell.navigator.current).toBe("generator");
  });

  it("removes invalid lines only from the result, keeping the paste recoverable", async () => {
    bootShell({ hash: "#/sorter" });
    await paste("4111111111111111|12|2030|123\nnot a record");
    click("#sorter-view-result");
    click('[data-action="remove-invalid"]');
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-output").value).not.toContain("not a record");
    expect(toastText()).toContain("1 invalid or empty line removed");
    expect($<HTMLTextAreaElement>("#sorter-input").value).toContain("not a record");
  });

  it("refuses to run actions on empty input", async () => {
    bootShell({ hash: "#/sorter" });
    expect($<HTMLButtonElement>("#sorter-quick-clean").disabled).toBe(true);
    click("#sorter-view-result");
    expect($("#sorter-result-view").textContent).toMatch(/Paste|Nothing/);
  });

  it("pastes from the clipboard and asks before replacing input", async () => {
    const { platform } = bootShell({ hash: "#/sorter" });
    platform.clipboard.read.mockResolvedValueOnce("");
    click("#sorter-paste");
    await flush();
    expect(toastText()).toContain("no text");
    platform.clipboard.read.mockRejectedValueOnce(new Error("denied"));
    click("#sorter-paste");
    await flush();
    expect(toastText()).toContain("unavailable");

    platform.clipboard.read.mockResolvedValue("a\nb");
    click("#sorter-paste");
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("a\nb");
    platform.clipboard.read.mockResolvedValue("c");
    click("#sorter-paste");
    await flush();
    cancelSheet();
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("a\nb");
    click("#sorter-paste");
    await flush();
    confirmSheet();
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("c");
  });

  it("loads plain-text files locally and rejects other files", async () => {
    bootShell({ hash: "#/sorter" });
    const fileInput = $<HTMLInputElement>("#sorter-file");
    const choose = async (file: File) => {
      Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event("change"));
      await flush();
      await flush();
    };
    await choose(new File(["\u0089PNG"], "photo.png", { type: "image/png" }));
    expect($("#sorter-error").textContent).toContain("not a plain-text file");
    await choose(new File(["a\0b"], "data.txt", { type: "text/plain" }));
    expect($("#sorter-error").textContent).toContain("binary");
    const big = new File(["x"], "big.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    await choose(big);
    expect($("#sorter-error").textContent).toContain("5 MB");
    await choose(new File(["one\ntwo"], "list.txt", { type: "text/plain" }));
    expect($("#sorter-error").hidden).toBe(true);
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("one\ntwo");
    expect(toastText()).toContain("list.txt loaded locally (2 lines)");
    const broken = new File(["x"], "broken.txt", { type: "text/plain" });
    Object.defineProperty(broken, "text", { value: () => Promise.reject(new Error("io")) });
    await choose(broken);
    expect($("#sorter-error").textContent).toContain("could not be read");
  });

  it("clears input only after confirmation", async () => {
    bootShell({ hash: "#/sorter" });
    await paste("a\nb");
    click('[aria-label="Clear input and result"]');
    await flush();
    cancelSheet();
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("a\nb");
    click('[aria-label="Clear input and result"]');
    await flush();
    confirmSheet();
    await flush();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("");
    expect(toastText()).toContain("Card Sorter cleared");
  });

  it("shows a working state for very large inputs", async () => {
    bootShell({ hash: "#/sorter" });
    const lines = Array.from({ length: LOADING_THRESHOLD }, (_, index) => `4111111111111111|12|2030|${String(index % 1000).padStart(3, "0")}`);
    await paste(lines.join("\n"));
    click("#sorter-quick-clean");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect($("#sorter-stat-remaining").textContent).toBe("1000");
  });

  it("flushes pending typing when leaving the tab", () => {
    const { shell } = bootShell({ hash: "#/sorter" });
    typeInto($<HTMLTextAreaElement>("#sorter-input"), "x\ny");
    shell.context.navigate("generator");
    expect($("#sorter-stat-input").textContent).toBe("2");
  });
});

describe("Settings tool", () => {
  it("changes and persists the theme", async () => {
    const { store, theme } = bootShell({ hash: "#/settings" });
    click('#settings-theme [data-value="light"]');
    await flush();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(store.get("theme")).toBe("light");
    await theme.set("dark");
    expect($('#settings-theme [data-value="dark"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("lists which tools work offline", () => {
    bootShell({ hash: "#/settings" });
    const text = $('[data-tool="settings"]').textContent ?? "";
    expect(text).toContain("Works offline");
    expect(text).toContain("Needs internet");
  });

  it("checks service status only on request", async () => {
    const checkStatus = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new BinServiceError("offline", "You're offline.")).mockRejectedValueOnce(new Error("Guison is not ready."));
    bootShell({ hash: "#/settings", binService: stubService({ checkStatus }) });
    expect(checkStatus).not.toHaveBeenCalled();
    expect($("#settings-api-state").textContent).toBe("Not checked");
    click("#settings-check-api");
    click("#settings-check-api");
    await flush();
    expect(checkStatus).toHaveBeenCalledTimes(1);
    expect($("#settings-api-state").textContent).toBe("Ready");
    click("#settings-check-api");
    await flush();
    expect($("#settings-api-state").textContent).toBe("Offline");
    click("#settings-check-api");
    await flush();
    expect($("#settings-api-state").textContent).toBe("Unavailable");
    expect($("#settings-api-status").textContent).toBe("Guison is not ready.");
  });

  it("shows About details, the guide and safe external links", async () => {
    bootShell({ hash: "#/settings" });
    await flush();
    const text = $('[data-tool="settings"]').textContent ?? "";
    expect(text).toContain("9.9.9");
    expect(text).toContain("42");
    expect(text).toContain("Web preview");
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-tool="settings"] a')];
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
      expect(link.href).toMatch(/^https:\/\//);
    }
    // Every public link the config ships is reachable from Settings. A config
    // entry that is never rendered is dead weight, so pin the rendered set to it.
    const config = createConfig({}, "9.9.9");
    expect(links.map((link) => link.href)).toEqual([config.communityUrl, config.sourceUrl]);
  });

  it("opens the Help page from Settings", async () => {
    const { shell } = bootShell({ hash: "#/settings" });
    await flush();
    expect($("#settings-open-help").textContent).toContain("How to use ORIGEN");
    click("#settings-open-help");
    expect(shell.navigator.current).toBe("help");
    expect($("#app-title").textContent).toBe("Help");
    // Help never claims a bottom-navigation tab.
    expect(document.querySelector('.bottom-nav [data-tool="help"]')).toBeNull();
    expect(document.querySelectorAll(".bottom-nav .nav-item")).toHaveLength(4);
  });

  it("returns to Settings from Help by button and by Back", async () => {
    const { shell, pressSystemBack } = bootShell({ hash: "#/settings" });
    await flush();
    click("#settings-open-help");
    expect(shell.navigator.current).toBe("help");
    click("#help-back");
    expect(shell.navigator.current).toBe("settings");

    click("#settings-open-help");
    pressSystemBack();
    expect(shell.navigator.current).toBe("settings");
  });
});
