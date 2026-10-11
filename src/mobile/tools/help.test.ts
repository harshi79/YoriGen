// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, bootShell, flush } from "../test-support";

afterEach(() => {
  document.body.innerHTML = "";
});

const helpText = () => $('[data-tool="help"]').textContent ?? "";

async function openHelp(hash = "#/settings") {
  const booted = bootShell({ hash });
  await flush();
  if (hash === "#/settings") $("#settings-open-help").click();
  return booted;
}

describe("Help page", () => {
  it("is reachable from Settings and reachable directly by hash", async () => {
    const { shell } = await openHelp();
    expect(shell.navigator.current).toBe("help");

    const deep = bootShell({ hash: "#/help" });
    await flush();
    expect(deep.shell.navigator.current).toBe("help");
    expect($("#app-title").textContent).toBe("Help");
  });

  it("explains what ORIGEN does and covers all four tools by name", async () => {
    await openHelp();
    const text = helpText();
    for (const tool of ["Generator", "BIN Lookup", "Card Sorter", "Settings"]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain("synthetic");
  });

  it("documents the Generator using the controls that exist", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("6–8 digits");
    expect(text).toContain("5279109907xxxxxx"); // the masked template the input accepts
    expect(text).toContain("Auto prefix");
    expect(text).toContain("1 to 100");
    expect(text).toContain("4 digits for Amex, 3 for the rest");
    expect(text).toContain("10 years ahead");
    for (const format of [".txt", ".csv", ".json"]) expect(text).toContain(format);
  });

  it("states plainly that BIN Lookup needs a connection and sends only the prefix", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("the only tool that uses the internet");
    expect(text).toContain("Only the prefix is sent");
    expect(text).toContain("rejected on the device before any request");
    expect(text).toContain("Nothing is queued and no metadata is invented");
  });

  it("documents the Card Sorter limits that are actually enforced", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("5 MB"); // MAX_FILE_BYTES in tools/sorter.ts
    expect(text).toContain("never uploaded");
    expect(text).toContain("Unrecognized lines are kept");
    expect(text).toContain("number|MM|YYYY|CVV");
  });

  it("describes every real setting and nothing that is not implemented", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("Dark, Light or System");
    expect(text).toContain("the only choice the app saves");
    expect(text).toContain("Check service status");
    expect(text).toContain("Clear session history");
    // Settings that do not exist must not be documented.
    for (const absent of ["notifications", "default network", "currency", "language setting", "auto-update"]) {
      expect(text.toLowerCase()).not.toContain(absent);
    }
  });

  it("explains the community buttons and that they need no account", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("each time the app starts");
    expect(text).toContain("opens Telegram if it is installed and the browser if it is not");
    expect(text).toContain("No Telegram account");
    expect(text).toContain("the prompt still closes and the app carries on");
  });

  it("keeps the safety limits rather than trimming them for neatness", async () => {
    await openHelp();
    const text = helpText();
    expect(text).toContain("Luhn checksum");
    expect(text).toContain("not reserved test numbers");
    expect(text).toContain("does not verify cards");
    expect(text).toContain("No analytics, tracking, accounts or advertising");
    expect(text).toContain("gone when the app closes");
  });

  it("renders offline without contacting any host", async () => {
    const { shell, platform } = bootShell({ online: false, hash: "#/help" });
    await flush();
    expect(shell.navigator.current).toBe("help");
    expect(helpText()).toContain("Generator");
    expect($("#offline-pill").hidden).toBe(false);
    // The Help screen holds no request-bearing control of its own.
    expect($('[data-tool="help"]').querySelectorAll("form, input, textarea")).toHaveLength(0);
    expect(platform.network.isOnline()).toBe(false);
  });

  it("returns to Settings from the visible button and from Back", async () => {
    const { shell, pressSystemBack } = await openHelp();
    $("#help-back").click();
    expect(shell.navigator.current).toBe("settings");
    $("#settings-open-help").click();
    pressSystemBack();
    expect(shell.navigator.current).toBe("settings");
  });

  it("scrolls back to the top when Help is re-selected", async () => {
    const { shell } = bootShell({ hash: "#/help" });
    await flush();
    const scroller = $('[data-tool="help"] .screen-scroll') as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
    // Past the navigation debounce, re-selecting the current destination.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    shell.context.navigate("help");
    expect(shell.navigator.current).toBe("help");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: expect.any(String) });
    vi.restoreAllMocks();
  });

  it("has no bottom-navigation tab of its own", async () => {
    await openHelp();
    expect(document.querySelector('.bottom-nav [data-tool="help"]')).toBeNull();
    expect(document.querySelectorAll(".bottom-nav .nav-item")).toHaveLength(4);
  });
});
