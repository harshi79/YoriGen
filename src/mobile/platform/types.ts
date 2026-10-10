/**
 * Platform service contracts used by the mobile shell and its tools.
 *
 * Tools depend only on these interfaces, never on Capacitor directly, so the
 * same screens run in the Android app, in a desktop browser during
 * development, and in unit tests with in-memory fakes.
 */
export type PlatformKind = "android" | "web";

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ClipboardService {
  write(text: string): Promise<void>;
  /** Resolves with an empty string when nothing readable is on the clipboard. */
  read(): Promise<string>;
}

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

/**
 * `shared`: handed to the Android share sheet. `downloaded`: browser download.
 * `cancelled`: the user dismissed the share sheet.
 */
export type ExportOutcome = "shared" | "downloaded" | "cancelled";

export interface FileExporter {
  export(file: ExportFile): Promise<ExportOutcome>;
}

export interface NetworkMonitor {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface AppInfo {
  version: string;
  build: string;
}

export interface AppLifecycle {
  /** Registers the single handler for the hardware/gesture Back action. */
  onBack(handler: () => void): void;
  /** Leaves the app the way Android does for a root activity (moves it to the background). */
  exit(): void;
  info(): Promise<AppInfo>;
}

export interface SystemUi {
  /** Light icons on dark backgrounds when `dark` is true. */
  setDarkAppearance(dark: boolean): Promise<void>;
}

export interface PlatformServices {
  readonly kind: PlatformKind;
  readonly storage: KeyValueStorage;
  readonly clipboard: ClipboardService;
  readonly files: FileExporter;
  readonly network: NetworkMonitor;
  readonly app: AppLifecycle;
  readonly systemUi: SystemUi;
}
