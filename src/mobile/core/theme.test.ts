// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, parseThemePreference, resolveTheme, ThemeController, THEME_STORAGE_KEY, type ColorSchemeQuery } from "./theme";
import type { KeyValueStorage } from "../platform/types";

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

function query(matches: boolean) {
  const listeners: (() => void)[] = [];
  const q: ColorSchemeQuery & { fire(next: boolean): void } = {
    matches,
    addEventListener: (_type, listener) => void listeners.push(listener),
    fire(next) {
      (q as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
  };
  return q;
}

describe("theme helpers", () => {
  it("defaults to dark, the ORIGEN identity", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(parseThemePreference(null)).toBe("dark");
    expect(parseThemePreference("neon")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("resolves system preference from the media query", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("ThemeController", () => {
  let storage: MemoryStorage;
  const systemUi = { setDarkAppearance: vi.fn<(dark: boolean) => Promise<void>>(async () => {}) };

  beforeEach(() => {
    storage = new MemoryStorage();
    systemUi.setDarkAppearance.mockClear();
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    delete document.documentElement.dataset.theme;
  });

  it("applies dark before any preference is stored", async () => {
    const controller = new ThemeController(storage, systemUi, query(false));
    await controller.load();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#101210");
    expect(systemUi.setDarkAppearance).toHaveBeenLastCalledWith(true);
  });

  it("loads, applies and persists only the preference", async () => {
    storage.values.set(THEME_STORAGE_KEY, "light");
    const controller = new ThemeController(storage, systemUi, query(true));
    await controller.load();
    expect(controller.preference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#f5f6f1");
    await controller.set("dark");
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("dark");
    expect([...storage.values.keys()]).toEqual([THEME_STORAGE_KEY]);
  });

  it("follows the system only when asked to", async () => {
    const q = query(true);
    const controller = new ThemeController(storage, systemUi, q);
    const seen: string[] = [];
    controller.subscribe((theme) => seen.push(theme));
    await controller.set("system");
    q.fire(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    await controller.set("dark");
    q.fire(true);
    q.fire(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(seen).toEqual(["dark", "light", "dark"]);
  });

  it("stays dark without a media query and survives system-bar failures", async () => {
    const failing = { setDarkAppearance: vi.fn(async () => Promise.reject(new Error("no bars"))) };
    const controller = new ThemeController(storage, failing, null);
    await controller.set("system");
    expect(controller.resolved).toBe("dark");
    const stop = controller.subscribe(() => {
      throw new Error("should not be called after unsubscribe");
    });
    stop();
    await controller.set("light");
    expect(controller.resolved).toBe("light");
  });
});
