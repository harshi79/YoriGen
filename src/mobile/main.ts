/**
 * Entry point of the ORIGEN Android app (and its browser preview).
 * Everything needed to start is bundled; no remote host is contacted at launch.
 */
import "./styles/mobile.css";
import { appConfig } from "./config";
import { ThemeController } from "./core/theme";
import { createPlatform } from "./platform";
import { createGuisonService } from "./services/bin-service";
import { mountShell, renderFatal } from "./shell";
import { createCommunityPrompt } from "./ui/community";
import { createDefaultRegistry, START_TOOL } from "./tools";

async function boot() {
  const host = document.getElementById("app");
  if (!host) return;
  try {
    const platform = createPlatform({ version: appConfig.version, build: "" });
    const theme = new ThemeController(
      platform.storage,
      platform.systemUi,
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null,
    );
    await theme.load().catch(() => {
      /* Defaults apply if preferences cannot be read. */
    });
    const shell = mountShell({
      host,
      registry: createDefaultRegistry(),
      startId: START_TOOL,
      platform,
      config: appConfig,
      theme,
      binService: createGuisonService({
        origin: appConfig.binApiOrigin,
        label: appConfig.binApiLabel,
        network: platform.network,
      }),
      hash: window.location.hash,
      writeHash: (hash) => {
        if (window.location.hash !== hash) history.replaceState(null, "", hash);
      },
    });
    document.documentElement.classList.add("ready");
    // Community is a launch prompt, not a tool or a navigation destination.
    // It is local startup logic: no storage read, no network, nothing to await,
    // so the shell is already usable by the time it opens.
    createCommunityPrompt(shell.context.ui.sheets, platform.kind).showIfNeeded();
  } catch (error) {
    renderFatal(host, error);
  }
}

void boot();
