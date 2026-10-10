/**
 * Services the shell hands to every tool. Tools never reach for globals:
 * storage, clipboard, file export, network state, feedback and navigation
 * all come through this context, which keeps tools independent and testable.
 */
import type { AppConfig } from "../config";
import type { PlatformServices } from "../platform/types";
import type { ExportFile } from "../platform/types";
import type { BinMetadataService } from "../services/bin-service";
import type { Sheets } from "../ui/sheet";
import type { ToastKind } from "../ui/toast";
import type { BackDispatcher } from "./back";
import type { EventBus } from "./events";
import type { ThemeController } from "./theme";

export interface UiServices {
  toast(message: string, kind?: ToastKind): void;
  sheets: Sheets;
  /** Copies text and reports the outcome with a toast. Resolves `true` on success. */
  copy(text: string, successMessage: string): Promise<boolean>;
  /** Saves or shares a file and reports the outcome with a toast. */
  exportFile(file: ExportFile, successMessage: string): Promise<boolean>;
}

export interface ToolContext {
  readonly config: AppConfig;
  readonly platform: PlatformServices;
  readonly ui: UiServices;
  readonly theme: ThemeController;
  readonly binService: BinMetadataService;
  readonly back: BackDispatcher;
  readonly events: EventBus;
  /** Lists registered tools, for screens such as Settings that describe them. */
  tools(): readonly { id: string; title: string; description: string; network: "none" | "required" }[];
  navigate(id: string): void;
}
