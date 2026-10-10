/**
 * In-memory platform used by the mobile unit tests. Not part of the app bundle.
 */
import { vi } from "vitest";
import { createConfig } from "./config";
import { ThemeController } from "./core/theme";
import type { ExportOutcome, PlatformServices } from "./platform/types";
import { createGuisonService, type BinMetadataService } from "./services/bin-service";
import { mountShell } from "./shell";
import { createDefaultRegistry, START_TOOL } from "./tools";
import type { ToolRegistry } from "./core/registry";

export function fakePlatform(options: { online?: boolean } = {}) {
  let online = options.online ?? true;
  const networkListeners = new Set<(value: boolean) => void>();
  const store = new Map<string, string>();
  let backHandler: (() => void) | undefined;
  const platform = {
    kind: "web" as const,
    storage: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
      remove: vi.fn(async (key: string) => void store.delete(key)),
    },
    clipboard: { write: vi.fn<(text: string) => Promise<void>>(async () => {}), read: vi.fn(async () => "") },
    files: { export: vi.fn(async (): Promise<ExportOutcome> => "shared") },
    network: {
      isOnline: () => online,
      subscribe: (listener: (value: boolean) => void) => {
        networkListeners.add(listener);
        return () => networkListeners.delete(listener);
      },
    },
    app: {
      onBack: vi.fn((handler: () => void) => void (backHandler = handler)),
      exit: vi.fn(),
      info: vi.fn(async () => ({ version: "9.9.9", build: "42" })),
    },
    systemUi: { setDarkAppearance: vi.fn<(dark: boolean) => Promise<void>>(async () => {}) },
  } satisfies PlatformServices;
  return {
    platform,
    store,
    setOnline(value: boolean) {
      online = value;
      networkListeners.forEach((listener) => listener(value));
    },
    pressSystemBack() {
      backHandler?.();
    },
  };
}

export interface BootOptions {
  online?: boolean;
  hash?: string;
  registry?: ToolRegistry;
  startId?: string;
  binService?: BinMetadataService;
}

export function bootShell(options: BootOptions = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const host = document.getElementById("app") as HTMLElement;
  const fake = fakePlatform({ online: options.online });
  const config = createConfig({}, "9.9.9");
  const theme = new ThemeController(fake.platform.storage, fake.platform.systemUi, null);
  const writeHash = vi.fn();
  const shell = mountShell({
    host,
    registry: options.registry ?? createDefaultRegistry(),
    startId: options.startId ?? START_TOOL,
    platform: fake.platform,
    config,
    theme,
    binService: options.binService ?? createGuisonService({
      origin: config.binApiOrigin,
      label: config.binApiLabel,
      network: fake.platform.network,
      retries: 0,
    }),
    hash: options.hash,
    writeHash,
  });
  return { ...fake, shell, host, writeHash, theme };
}

export const $ = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};

export function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
