// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Braces } from "lucide";
import { ToolRegistry } from "./core/registry";
import { renderFatal } from "./shell";
import { $, bootShell, flush, typeInto } from "./test-support";

const visibleScreen = () => document.querySelector<HTMLElement>(".screen-host:not([hidden])")?.dataset.screen;

describe("mobile shell", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(async () => {
      throw new TypeError("network disabled in tests");
    });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts fully offline without contacting any host", async () => {
    const { shell } = bootShell({ online: false });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect($("#app-title").textContent).toBe("Generator");
    expect($("#offline-pill").hidden).toBe(false);
    expect(visibleScreen()).toBe("generator");
    // Only the start tool is built at launch.
    expect(shell.screen("generator")).toBeDefined();
    expect(shell.screen("lookup")).toBeUndefined();
  });

  it("renders a labelled bottom navigation for every registered tool", () => {
    bootShell();
    const items = [...document.querySelectorAll<HTMLButtonElement>(".bottom-nav .nav-item")];
    expect(items.map((item) => item.dataset.tool)).toEqual(["generator", "lookup", "sorter", "settings"]);
    expect(items.map((item) => item.querySelector(".nav-label")?.textContent)).toEqual(["Generator", "BIN Lookup", "Sorter", "Settings"]);
    expect(items.every((item) => item.querySelector("svg"))).toBe(true);
    expect(items[0].getAttribute("aria-current")).toBe("page");
    expect(items.filter((item) => item.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("switches tabs from the bottom bar and keeps the URL hash in step", () => {
    const { writeHash } = bootShell();
    $('.bottom-nav [data-tool="sorter"]').click();
    expect(visibleScreen()).toBe("sorter");
    expect($("#app-title").textContent).toBe("Card Sorter");
    expect($('.bottom-nav [data-tool="sorter"]').getAttribute("aria-current")).toBe("page");
    expect(writeHash).toHaveBeenLastCalledWith("#/sorter");
    expect(document.title).toBe("Card Sorter · ORIGEN");
  });

  it("ignores a rapid double tap instead of navigating twice", () => {
    const { shell } = bootShell();
    const events: string[] = [];
    shell.navigator.subscribe((event) => events.push(event.type));
    const lookup = $('.bottom-nav [data-tool="lookup"]');
    lookup.click();
    lookup.click();
    lookup.click();
    expect(events).toEqual(["navigate"]);
  });

  it("opens the destination from the launch hash without adding Back history", () => {
    const { shell, platform, writeHash } = bootShell({ hash: "#/settings" });
    expect(visibleScreen()).toBe("settings");
    expect(writeHash).toHaveBeenLastCalledWith("#/settings");
    shell.handleBack();
    expect(visibleScreen()).toBe("generator");
    expect(platform.app.exit).not.toHaveBeenCalled();
    shell.handleBack();
    expect(platform.app.exit).toHaveBeenCalledTimes(1);
  });

  it("falls back to the start tool for unknown hashes", () => {
    bootShell({ hash: "#/admin" });
    expect(visibleScreen()).toBe("generator");
  });

  it("wires the Android Back action through the platform", () => {
    const { pressSystemBack, platform } = bootShell({ hash: "#/lookup" });
    expect(platform.app.onBack).toHaveBeenCalledTimes(1);
    pressSystemBack();
    expect(visibleScreen()).toBe("generator");
  });

  it("keeps typed input when switching tabs", () => {
    bootShell();
    const prefix = $<HTMLInputElement>("#gen-prefix");
    typeInto(prefix, "457173");
    $('.bottom-nav [data-tool="sorter"]').click();
    typeInto($<HTMLTextAreaElement>("#sorter-input"), "4111111111111111|12|2030|123");
    $('.bottom-nav [data-tool="generator"]').click();
    expect($<HTMLInputElement>("#gen-prefix")).toBe(prefix);
    expect(prefix.value).toBe("457173");
    $('.bottom-nav [data-tool="sorter"]').click();
    expect($<HTMLTextAreaElement>("#sorter-input").value).toBe("4111111111111111|12|2030|123");
  });

  it("lets the active tool consume Back before navigation (Results → Builder)", () => {
    const { platform } = bootShell();
    typeInto($<HTMLInputElement>("#gen-prefix"), "411111");
    $("#gen-generate").click();
    expect($("#gen-results").hidden).toBe(false);
    expect(document.querySelectorAll("#gen-results-list .fixture").length).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect($("#gen-results").hidden).toBe(true);
    expect($("#gen-builder").hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(platform.app.exit).toHaveBeenCalled();
  });

  it("closes an open sheet on Back before anything else", async () => {
    const { shell } = bootShell({ hash: "#/settings" });
    const sheet = shell.context.ui.sheets.open({ title: "Test sheet" });
    expect(sheet.element.open).toBe(true);
    expect(shell.back.depth).toBe(2);
    shell.handleBack();
    expect(await sheet.closed).toBeUndefined();
    expect(visibleScreen()).toBe("settings");
    expect(shell.back.depth).toBe(1);
  });

  it("resolves confirmation sheets only for the confirm action", async () => {
    const { shell } = bootShell();
    const confirmed = shell.context.ui.sheets.confirm({ title: "Clear?", message: "Really?", confirmLabel: "Clear", destructive: true });
    $<HTMLButtonElement>("[data-confirm]").click();
    expect(await confirmed).toBe(true);
    const cancelled = shell.context.ui.sheets.confirm({ title: "Clear?", message: "Really?", confirmLabel: "Clear" });
    shell.handleBack();
    expect(await cancelled).toBe(false);
  });

  it("shows the offline pill as connectivity changes", () => {
    const { setOnline } = bootShell();
    expect($("#offline-pill").hidden).toBe(true);
    setOnline(false);
    expect($("#offline-pill").hidden).toBe(false);
    setOnline(true);
    expect($("#offline-pill").hidden).toBe(true);
  });

  it("reports BIN lookups honestly while offline and never invents data", async () => {
    bootShell({ online: false, hash: "#/lookup" });
    typeInto($<HTMLInputElement>("#lookup-bin"), "457173");
    $<HTMLButtonElement>("#lookup-submit").click();
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    const result = $("#lookup-result");
    expect(result.querySelector(".state-error")).not.toBeNull();
    expect(result.textContent).toMatch(/offline/i);
    expect(result.querySelector(".meta-list")).toBeNull();
  });

  it("rejects full card numbers on the device before any request", async () => {
    bootShell({ hash: "#/lookup" });
    typeInto($<HTMLInputElement>("#lookup-bin"), "4111111111111111");
    $<HTMLButtonElement>("#lookup-submit").click();
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect($<HTMLInputElement>("#lookup-bin").getAttribute("aria-invalid")).toBe("true");
  });

  it("reports clipboard and export outcomes", async () => {
    const { shell, platform } = bootShell();
    expect(await shell.context.ui.copy("x", "Copied")).toBe(true);
    expect(platform.clipboard.write).toHaveBeenCalledWith("x");
    expect(document.querySelector(".toast")?.textContent).toContain("Copied");
    expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe("Copied");
    platform.clipboard.write.mockRejectedValueOnce(new Error("denied"));
    expect(await shell.context.ui.copy("x", "Copied")).toBe(false);
    expect(document.querySelector(".toast")?.classList.contains("toast-error")).toBe(true);

    const file = { filename: "a.txt", mime: "text/plain", content: "a" };
    expect(await shell.context.ui.exportFile(file, "Exported")).toBe(true);
    platform.files.export.mockResolvedValueOnce("cancelled");
    expect(await shell.context.ui.exportFile(file, "Exported")).toBe(false);
    platform.files.export.mockRejectedValueOnce(new Error("disk"));
    expect(await shell.context.ui.exportFile(file, "Exported")).toBe(false);
  });

  it("contains a failing tool behind an error boundary with a retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const registry = new ToolRegistry()
      .register({ id: "home", navLabel: "Home", title: "Home", description: "Start tool for tests", icon: Braces, network: "none", create: () => ({ root: document.createElement("div") }) })
      .register({
        id: "flaky",
        navLabel: "Flaky",
        title: "Flaky",
        description: "Fails the first time",
        icon: Braces,
        network: "none",
        create: () => {
          attempts++;
          if (attempts === 1) throw new Error("boom");
          const root = document.createElement("div");
          root.id = "flaky-ok";
          return { root };
        },
      });
    bootShell({ registry, startId: "home" });
    $('.bottom-nav [data-tool="flaky"]').click();
    expect(document.querySelector('[data-screen="flaky"] .state-error')?.textContent).toContain("Flaky could not start");
    expect(document.querySelector('.bottom-nav [data-tool="home"]')).not.toBeNull();
    $<HTMLButtonElement>('[data-screen="flaky"] .state-error button').click();
    expect(document.querySelector("#flaky-ok")).not.toBeNull();
  });

  it("calls tool lifecycle hooks", () => {
    const calls: string[] = [];
    const registry = new ToolRegistry()
      .register({ id: "one", navLabel: "One", title: "One", description: "First test tool", icon: Braces, network: "none", create: () => ({ root: document.createElement("div"), activate: () => calls.push("one:on"), deactivate: () => calls.push("one:off"), reselect: () => calls.push("one:again") }) })
      .register({ id: "two", navLabel: "Two", title: "Two", description: "Second test tool", icon: Braces, network: "none", create: () => ({ root: document.createElement("div"), activate: () => calls.push("two:on") }) });
    const { shell } = bootShell({ registry, startId: "one" });
    shell.context.navigate("two");
    shell.handleBack();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    shell.context.navigate("one");
    expect(calls).toEqual(["one:on", "one:off", "two:on", "one:on", "one:again"]);
    expect(shell.context.tools().map((tool) => tool.id)).toEqual(["one", "two"]);
  });

  it("clears session history from Settings across tools", async () => {
    const { shell } = bootShell({ hash: "#/settings" });
    const removed = shell.context.events.emit("session:clear", undefined);
    expect(removed).toBe(0);
  });

  it("shows About details from the installed package", async () => {
    bootShell({ hash: "#/settings" });
    await flush();
    expect(document.body.textContent).toContain("9.9.9");
    expect(document.body.textContent).toContain("Apache");
  });

  it("renders a fatal screen if the shell cannot start", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = '<div id="app"></div>';
    renderFatal($("#app"), new Error("boom"));
    expect($(".fatal").textContent).toContain("ORIGEN could not start");
  });
});

describe("mobile shell environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("marks the layout while the soft keyboard is open and keeps the field in view", () => {
    vi.useFakeTimers();
    bootShell();
    const app = $(".app");
    const input = $<HTMLInputElement>("#gen-prefix");
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    const target: EventTarget = window.visualViewport ?? window;
    const setHeight = (value: number) => {
      Object.defineProperty(window, "innerHeight", { value, configurable: true });
      if (window.visualViewport) Object.defineProperty(window.visualViewport, "height", { value, configurable: true });
      target.dispatchEvent(new Event("resize"));
    };
    setHeight(900);
    input.focus();
    setHeight(500);
    expect(app.dataset.keyboard).toBe("open");
    vi.advanceTimersByTime(80);
    expect(scrollIntoView).toHaveBeenCalled();
    setHeight(900);
    expect(app.dataset.keyboard).toBe("closed");
  });

  it("turns unexpected errors into a calm message instead of a crash", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    bootShell();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
    expect(document.querySelector(".toast")?.textContent).toContain("Your data on this screen is unchanged");
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("later") }));
    expect(error).toHaveBeenCalledWith("[origen] unhandled rejection", expect.any(Error));
  });

  it("scrolls the active tool to the top when its tab is tapped again", () => {
    const { shell } = bootShell();
    for (const id of ["generator", "lookup", "sorter", "settings"]) {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
      shell.context.navigate(id);
      const scroller = document.querySelector<HTMLElement>(`[data-screen="${id}"] .screen-scroll`) as HTMLElement;
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20_000);
      shell.context.navigate(id);
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: expect.any(String) });
      vi.restoreAllMocks();
    }
  });

  it("does not treat Escape inside an open dialog as Back", () => {
    const { shell } = bootShell({ hash: "#/sorter" });
    shell.context.ui.sheets.open({ title: "Open" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(shell.navigator.current).toBe("sorter");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(shell.navigator.current).toBe("sorter");
  });
});
