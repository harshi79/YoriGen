/**
 * Theme preference: dark (the ORIGEN default), light, or follow the system.
 * Only the preference itself is persisted.
 */
import type { KeyValueStorage, SystemUi } from "../platform/types";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME: ThemePreference = "dark";
const PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : DEFAULT_THEME;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export interface ColorSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
}

export class ThemeController {
  private pref: ThemePreference = DEFAULT_THEME;
  private readonly listeners = new Set<(theme: ResolvedTheme) => void>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly systemUi: SystemUi,
    private readonly query: ColorSchemeQuery | null,
    private readonly root: HTMLElement = document.documentElement,
  ) {
    query?.addEventListener("change", () => {
      if (this.pref === "system") this.apply();
    });
  }

  get preference(): ThemePreference {
    return this.pref;
  }

  get resolved(): ResolvedTheme {
    // ORIGEN is a dark-first product; without a media query, stay dark.
    return resolveTheme(this.pref, this.query?.matches ?? true);
  }

  async load(): Promise<void> {
    this.pref = parseThemePreference(await this.storage.get(THEME_STORAGE_KEY));
    this.apply();
  }

  async set(preference: ThemePreference): Promise<void> {
    this.pref = parseThemePreference(preference);
    this.apply();
    await this.storage.set(THEME_STORAGE_KEY, this.pref);
  }

  subscribe(listener: (theme: ResolvedTheme) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(): void {
    const theme = this.resolved;
    this.root.dataset.theme = theme;
    this.root.style.colorScheme = theme;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#101210" : "#f5f6f1";
    void this.systemUi.setDarkAppearance(theme === "dark").catch(() => {
      /* System bar styling is cosmetic. */
    });
    for (const listener of [...this.listeners]) listener(theme);
  }
}
