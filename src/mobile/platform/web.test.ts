// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserClipboard, BrowserDownloadExporter, BrowserNetworkMonitor, createWebPlatform, LocalStorageAdapter } from "./web";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("LocalStorageAdapter", () => {
  it("namespaces keys", async () => {
    const storage = new LocalStorageAdapter();
    await storage.set("theme", "light");
    expect(localStorage.getItem("origen.theme")).toBe("light");
    expect(await storage.get("theme")).toBe("light");
    await storage.remove("theme");
    expect(await storage.get("theme")).toBeNull();
  });

  it("degrades quietly when storage is blocked", async () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    const storage = new LocalStorageAdapter("x.");
    await expect(storage.set("a", "b")).resolves.toBeUndefined();
    await expect(storage.get("a")).resolves.toBeNull();
    await expect(storage.remove("a")).resolves.toBeUndefined();
  });
});

describe("BrowserClipboard", () => {
  it("uses the async clipboard API when available", async () => {
    const writeText = vi.fn(async () => {});
    const readText = vi.fn(async () => "pasted");
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText, readText } });
    const clipboard = new BrowserClipboard();
    await clipboard.write("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(await clipboard.read()).toBe("pasted");
  });

  it("falls back to a temporary text area and reports failure", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const clipboard = new BrowserClipboard();
    await clipboard.write("hello");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector(".clipboard-proxy")).toBeNull();
    exec.mockReturnValueOnce(false);
    await expect(clipboard.write("again")).rejects.toThrow(/unavailable/);
    await expect(clipboard.read()).rejects.toThrow(/unavailable/);
  });
});

describe("BrowserDownloadExporter", () => {
  it("downloads a text file through a temporary link", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const outcome = await new BrowserDownloadExporter().export({ filename: "a.csv", mime: "text/csv", content: "x" });
    expect(outcome).toBe("downloaded");
    expect(click).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    vi.useRealTimers();
  });
});

describe("BrowserNetworkMonitor", () => {
  it("follows online and offline events until unsubscribed", () => {
    const monitor = new BrowserNetworkMonitor();
    expect(typeof monitor.isOnline()).toBe("boolean");
    const seen: boolean[] = [];
    const stop = monitor.subscribe((online) => seen.push(online));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    stop();
    window.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([false, true]);
  });
});

describe("createWebPlatform", () => {
  it("provides browser services with harmless lifecycle stubs", async () => {
    const platform = createWebPlatform({ version: "1.0.0", build: "" });
    expect(platform.kind).toBe("web");
    expect(await platform.app.info()).toEqual({ version: "1.0.0", build: "" });
    expect(() => platform.app.onBack(() => {})).not.toThrow();
    expect(() => platform.app.exit()).not.toThrow();
    await expect(platform.systemUi.setDarkAppearance(true)).resolves.toBeUndefined();
  });
});
