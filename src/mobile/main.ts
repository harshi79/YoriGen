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
    mountShell({
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
  } catch (error) {
    renderFatal(host, error);
  }
}

void boot();
