/**
 * Browser implementations of the platform services. Used when the mobile
 * shell runs outside the Android app (development, previews, tests).
 */
import type {
  AppInfo,
  ClipboardService,
  ExportFile,
  FileExporter,
  KeyValueStorage,
  NetworkMonitor,
  PlatformServices,
} from "./types";

export class LocalStorageAdapter implements KeyValueStorage {
  constructor(private readonly prefix = "origen.") {}
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(this.prefix + key);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch {
      /* Storage is optional; preferences fall back to defaults. */
    }
  }
  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch {
      /* Storage is optional. */
    }
  }
}

export class BrowserClipboard implements ClipboardService {
  async write(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "clipboard-proxy";
    document.body.append(area);
    area.select();
    const success = document.execCommand("copy");
    area.remove();
    previous?.focus();
    if (!success) throw new Error("Clipboard unavailable");
  }
  async read(): Promise<string> {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard reading unavailable");
    return navigator.clipboard.readText();
  }
}

export class BrowserDownloadExporter implements FileExporter {
  async export(file: ExportFile) {
    const url = URL.createObjectURL(
      new Blob([file.content], { type: `${file.mime};charset=utf-8` }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded" as const;
  }
}

export class BrowserNetworkMonitor implements NetworkMonitor {
  isOnline(): boolean {
    return navigator.onLine !== false;
  }
  subscribe(listener: (online: boolean) => void): () => void {
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }
}

export function createWebPlatform(appInfo: AppInfo): PlatformServices {
  return {
    kind: "web",
    storage: new LocalStorageAdapter(),
    clipboard: new BrowserClipboard(),
    files: new BrowserDownloadExporter(),
    network: new BrowserNetworkMonitor(),
    app: {
      onBack: () => {
        /* Browsers have no system Back hook; the shell maps Escape instead. */
      },
      exit: () => {
        /* A browser tab cannot be closed by script. */
      },
      info: async () => appInfo,
    },
    systemUi: { setDarkAppearance: async () => {} },
  };
}
