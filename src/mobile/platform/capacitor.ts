/**
 * Android implementations of the platform services, backed by official
 * Capacitor plugins. No plugin here requests a runtime permission:
 * preferences live in SharedPreferences, exports go to the app cache and are
 * handed to the system share sheet, and network status uses the normal
 * ACCESS_NETWORK_STATE permission.
 */
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import type {
  AppInfo,
  ExportFile,
  ExportOutcome,
  KeyValueStorage,
  NetworkMonitor,
  PlatformServices,
} from "./types";

class PreferencesStorage implements KeyValueStorage {
  async get(key: string) {
    return (await Preferences.get({ key })).value;
  }
  async set(key: string, value: string) {
    await Preferences.set({ key, value });
  }
  async remove(key: string) {
    await Preferences.remove({ key });
  }
}

class CapacitorNetworkMonitor implements NetworkMonitor {
  private online = navigator.onLine !== false;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor() {
    void Network.getStatus()
      .then((status) => this.update(status.connected))
      .catch(() => {
        /* Keep the navigator.onLine estimate. */
      });
    void Network.addListener("networkStatusChange", (status) =>
      this.update(status.connected),
    );
  }
  private update(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    for (const listener of [...this.listeners]) listener(online);
  }
  isOnline() {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Share sheet dismissal is reported by the plugin as a rejected call. */
function isShareCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel/i.test(message);
}

async function shareFile(file: ExportFile): Promise<ExportOutcome> {
  const written = await Filesystem.writeFile({
    path: `exports/${file.filename}`,
    data: file.content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  try {
    await Share.share({
      title: file.filename,
      files: [written.uri],
      dialogTitle: "Save or share synthetic test data",
    });
    return "shared";
  } catch (error) {
    if (isShareCancel(error)) return "cancelled";
    throw error;
  }
}

export function createCapacitorPlatform(fallbackInfo: AppInfo): PlatformServices {
  return {
    kind: "android",
    storage: new PreferencesStorage(),
    clipboard: {
      write: async (text) => {
        await Clipboard.write({ string: text });
      },
      read: async () => {
        const { type, value } = await Clipboard.read();
        return type.startsWith("text") ? value : "";
      },
    },
    files: { export: shareFile },
    network: new CapacitorNetworkMonitor(),
    app: {
      onBack: (handler) => {
        void App.addListener("backButton", () => handler());
      },
      exit: () => {
        void App.minimizeApp();
      },
      info: async () => {
        try {
          const info = await App.getInfo();
          return { version: info.version, build: info.build };
        } catch {
          return fallbackInfo;
        }
      },
    },
    systemUi: {
      setDarkAppearance: async (dark) => {
        // SystemBarsStyle.Dark means light icons for dark backgrounds.
        await SystemBars.setStyle({
          style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        });
      },
    },
  };
}
