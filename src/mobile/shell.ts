/**
 * ORIGEN mobile shell: app bar, screen host and bottom navigation.
 *
 * The shell owns everything tools share — navigation, Back handling, the
 * keyboard-aware layout, feedback (toasts and sheets), storage-backed theme
 * and error containment — so each tool only builds its own screen.
 */
import { Braces, CircleAlert, WifiOff } from "lucide";
import type { AppConfig } from "./config";
import { BackDispatcher } from "./core/back";
import type { ToolContext, UiServices } from "./core/context";
import { EventBus } from "./core/events";
import { watchKeyboard } from "./core/keyboard";
import { destinationFromHash, Navigator } from "./core/navigation";
import type { ToolRegistry, ToolScreen } from "./core/registry";
import type { ThemeController } from "./core/theme";
import type { PlatformServices } from "./platform/types";
import type { BinMetadataService } from "./services/bin-service";
import { errorState } from "./ui/components";
import { h, icon, replace, scrollBehavior } from "./ui/dom";
import { createSheets } from "./ui/sheet";
import { createToaster } from "./ui/toast";

export interface ShellOptions {
  host: HTMLElement;
  registry: ToolRegistry;
  startId: string;
  platform: PlatformServices;
  config: AppConfig;
  theme: ThemeController;
  binService: BinMetadataService;
  /** Initial location hash, e.g. `#/lookup`. */
  hash?: string;
  /** Called when the hash should change (replaceState in the browser). */
  writeHash?: (hash: string) => void;
}

export interface Shell {
  readonly navigator: Navigator;
  readonly back: BackDispatcher;
  readonly context: ToolContext;
  /** Runs the same logic as the Android system Back action. */
  handleBack(): void;
  /** The screen for a tool, if it has been created. */
  screen(id: string): ToolScreen | undefined;
}

export function mountShell(options: ShellOptions): Shell {
  const { host, registry, platform, config, theme, binService } = options;
  const ids = registry.ids();
  const back = new BackDispatcher();
  const events = new EventBus();
  const initial = destinationFromHash(options.hash ?? "", ids, options.startId);
  const navigator = new Navigator(ids, options.startId);

  // ---------- Layout ----------
  const title = h("h1", { class: "app-title", id: "app-title" });
  const offlinePill = h(
    "span",
    { class: "offline-pill", id: "offline-pill", role: "status", hidden: true },
    icon(WifiOff),
    h("span", {}, "Offline · local tools work"),
  );
  const appBar = h(
    "header",
    { class: "app-bar" },
    h("span", { class: "brand-mark", "aria-hidden": "true" }, icon(Braces)),
    h("div", { class: "app-bar-text" }, h("span", { class: "brand-name" }, "ORIGEN"), title),
    offlinePill,
  );
  const screensHost = h("main", { class: "screens", id: "screens" });
  const navButtons = new Map<string, HTMLButtonElement>();
  const nav = h(
    "nav",
    { class: "bottom-nav", "aria-label": "Main navigation" },
    ...registry.list().map((tool) => {
      const item = h(
        "button",
        {
          type: "button",
          class: "nav-item",
          "data-tool": tool.id,
          "aria-label": tool.navLabel,
          onClick: () => go(tool.id),
        },
        h("span", { class: "nav-indicator" }, icon(tool.icon)),
        h("span", { class: "nav-label", "aria-hidden": "true" }, tool.navLabel),
      );
      navButtons.set(tool.id, item);
      return item;
    }),
  );
  const overlayHost = h("div", { class: "overlays" });
  const app = h("div", { class: "app", "data-keyboard": "closed" }, appBar, screensHost, nav, overlayHost);
  replace(host, app);

  // ---------- Shared UI services ----------
  const toaster = createToaster(overlayHost);
  const sheets = createSheets(overlayHost, back);
  const ui: UiServices = {
    toast: toaster.show,
    sheets,
    async copy(text, successMessage) {
      try {
        await platform.clipboard.write(text);
        toaster.show(successMessage);
        return true;
      } catch {
        toaster.show("Clipboard unavailable. Long-press the text to select and copy it.", "error");
        return false;
      }
    },
    async exportFile(file, successMessage) {
      try {
        const outcome = await platform.files.export(file);
        if (outcome === "cancelled") return false;
        toaster.show(successMessage);
        return true;
      } catch {
        toaster.show("Export failed. You can still copy the data instead.", "error");
        return false;
      }
    },
  };

  const context: ToolContext = {
    config,
    platform,
    ui,
    theme,
    binService,
    back,
    events,
    tools: () => registry.list().map(({ id, title, description, network }) => ({ id, title, description, network })),
    navigate: (id) => go(id),
  };

  // ---------- Screens (created lazily, kept alive to preserve input) ----------
  const screens = new Map<string, ToolScreen>();
  const containers = new Map<string, HTMLElement>();

  function container(id: string): HTMLElement {
    let element = containers.get(id);
    if (!element) {
      const tool = registry.get(id);
      element = h("section", { class: "screen-host", "data-screen": id, "aria-label": tool.title, hidden: true });
      containers.set(id, element);
      screensHost.append(element);
    }
    return element;
  }

  function ensureScreen(id: string): ToolScreen | undefined {
    const existing = screens.get(id);
    if (existing) return existing;
    const tool = registry.get(id);
    const target = container(id);
    try {
      const screen = tool.create(context);
      screens.set(id, screen);
      replace(target, screen.root);
      return screen;
    } catch (error) {
      console.error(`[origen] ${tool.id} failed to start`, error);
      replace(
        target,
        h(
          "div",
          { class: "screen-scroll" },
          errorState({
            title: `${tool.title} could not start`,
            message: "Something went wrong while opening this tool. Other tools are unaffected.",
            onRetry: () => {
              if (navigator.current === id) show(id);
            },
            retryLabel: "Reload tool",
          }),
        ),
      );
      return undefined;
    }
  }

  let visible: string | null = null;
  function show(id: string) {
    const tool = registry.get(id);
    if (visible && visible !== id) {
      screens.get(visible)?.deactivate?.();
      container(visible).hidden = true;
    }
    const screen = ensureScreen(id);
    container(id).hidden = false;
    visible = id;
    title.textContent = tool.title;
    document.title = `${tool.title} · ORIGEN`;
    for (const [toolId, item] of navButtons) {
      if (toolId === id) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
    options.writeHash?.(`#/${id}`);
    screen?.activate?.();
  }

  function go(id: string) {
    navigator.navigate(id);
  }

  navigator.subscribe((event) => {
    if (event.type === "navigate") show(event.to);
    else screens.get(event.id)?.reselect?.();
  });

  // ---------- Back handling ----------
  back.push(() => {
    const active = screens.get(navigator.current);
    if (active?.handleBack?.()) return true;
    if (navigator.back() === "exit") platform.app.exit();
    return true;
  });
  const handleBack = () => {
    back.dispatch();
  };
  platform.app.onBack(handleBack);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // An open <dialog> handles Escape itself (and removes its Back layer).
    if (overlayHost.querySelector("dialog[open]")) return;
    event.preventDefault();
    handleBack();
  });

  // ---------- Environment ----------
  watchKeyboard((open) => {
    app.dataset.keyboard = open ? "open" : "closed";
    if (open) {
      const focused = document.activeElement as HTMLElement | null;
      setTimeout(() => focused?.scrollIntoView?.({ block: "center", behavior: scrollBehavior() }), 60);
    }
  });
  const renderNetwork = (online: boolean) => {
    offlinePill.hidden = online;
  };
  renderNetwork(platform.network.isOnline());
  platform.network.subscribe(renderNetwork);

  window.addEventListener("error", (event) => {
    console.error("[origen] unhandled error", event.error);
    toaster.show("Something went wrong. Your data on this screen is unchanged.", "error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[origen] unhandled rejection", event.reason);
  });

  // Start on the requested destination without growing Back history.
  show(options.startId);
  if (initial !== options.startId) navigator.navigate(initial);

  return {
    navigator,
    back,
    context,
    handleBack,
    screen: (id) => screens.get(id),
  };
}

/** Boot-time failure screen, shown only if the shell itself cannot start. */
export function renderFatal(host: HTMLElement, error: unknown) {
  console.error("[origen] failed to start", error);
  replace(
    host,
    h(
      "div",
      { class: "fatal" },
      icon(CircleAlert),
      h("h1", {}, "ORIGEN could not start"),
      h("p", {}, "Close and reopen the app. If this keeps happening, reinstall the latest build."),
    ),
  );
}
