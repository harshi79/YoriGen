/**
 * Settings — appearance, the tools, the BIN service, privacy and About.
 *
 * Every row here maps to behaviour that exists in the app; there is no setting
 * without an implementation behind it.
 */
import { Activity, ChevronRight, CircleHelp, ExternalLink, Info, LockKeyhole, Palette, Server, SlidersHorizontal, Trash2 } from "lucide";
import type { ToolContext } from "../core/context";
import type { ThemePreference } from "../core/theme";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { BinServiceError } from "../services/bin-service";
import { card, externalLinkAttrs, segmented } from "../ui/components";
import { h, icon, plural, scrollBehavior } from "../ui/dom";

/** A row that opens a screen inside the app. */
function navigateRow(options: { id: string; label: string; detail: string; onOpen: () => void }) {
  return h(
    "button",
    { type: "button", class: "setting-row", id: options.id, onClick: options.onOpen },
    h("span", { class: "setting-row-copy" }, h("strong", {}, options.label), h("small", {}, options.detail)),
    icon(ChevronRight, "setting-row-chevron"),
  );
}

function row(label: string, value: Node | string, id?: string) {
  return h("div", { class: "meta-row" }, h("dt", {}, label), h("dd", { id }, value));
}

function link(kind: "android" | "web", href: string, label: string) {
  return h(
    "a",
    { class: "setting-row setting-row-link", href, ...externalLinkAttrs(kind) },
    h("span", { class: "setting-row-copy" }, h("strong", {}, label)),
    icon(ExternalLink, "setting-row-chevron"),
  );
}

function createSettingsScreen(context: ToolContext): ToolScreen {
  const { theme, ui, binService, platform, config } = context;

  const themeControl = segmented<ThemePreference>({
    label: "Theme",
    id: "settings-theme",
    segments: [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
      { value: "system", label: "System" },
    ],
    value: theme.preference,
    onChange: (value) => void theme.set(value),
  });

  const toolRows = h(
    "dl",
    { class: "meta-list" },
    ...context.tools().map((tool) =>
      row(
        tool.title,
        h("span", { class: tool.network === "none" ? "badge badge-good" : "badge badge-warn" }, tool.network === "none" ? "Works offline" : "Needs internet"),
      ),
    ),
  );

  const statusBadge = h("span", { class: "badge", id: "settings-api-state" }, "Not checked");
  const statusText = h("p", { class: "hint", id: "settings-api-status", "aria-live": "polite" }, "Checked only when you tap it. No BIN is sent.");
  let checking: AbortController | null = null;
  const checkButton = h(
    "button",
    {
      type: "button",
      class: "btn btn-secondary",
      id: "settings-check-api",
      onClick: async () => {
        if (checking) return;
        checking = new AbortController();
        checkButton.disabled = true;
        statusBadge.textContent = "Checking";
        statusBadge.className = "badge";
        statusText.textContent = "Checking whether the dataset is ready…";
        try {
          await binService.checkStatus(checking.signal);
          statusBadge.textContent = "Ready";
          statusBadge.className = "badge badge-good";
          statusText.textContent = "The service answered ready just now. It is not monitored in the background.";
        } catch (error) {
          statusBadge.textContent = error instanceof BinServiceError && error.code === "offline" ? "Offline" : "Unavailable";
          statusBadge.className = "badge badge-warn";
          statusText.textContent = (error as Error).message;
        } finally {
          checking = null;
          checkButton.disabled = false;
        }
      },
    },
    icon(Activity),
    h("span", {}, "Check status"),
  );

  const versionValue = h("span", { class: "mono" }, config.version);
  const buildValue = h("span", { class: "mono" }, "—");
  platform.app
    .info()
    .then((info) => {
      versionValue.textContent = info.version || config.version;
      buildValue.textContent = info.build || "—";
    })
    .catch(() => {
      /* Keep the build-time version when app info is unavailable. */
    });

  const scroller = h(
    "div",
    { class: "screen-scroll" },
    card(
      { title: "Appearance", iconNode: Palette },
      themeControl.element,
      h("p", { class: "hint" }, "System follows your phone's dark mode. This is the only choice the app saves."),
    ),

    card(
      { title: "Help", iconNode: CircleHelp },
      navigateRow({
        id: "settings-open-help",
        label: "How to use ORIGEN",
        detail: "Each tool, every setting, and what the app does not do",
        onOpen: () => context.navigate("help"),
      }),
    ),

    card(
      { title: "Tools", iconNode: SlidersHorizontal },
      toolRows,
      h("p", { class: "hint" }, "Only BIN Lookup contacts the network."),
    ),

    card(
      { title: "BIN metadata service", iconNode: Server },
      h(
        "dl",
        { class: "meta-list" },
        row("Service", binService.label),
        row("Endpoint", h("span", { class: "mono break" }, binService.origin)),
        row("Status", statusBadge),
      ),
      statusText,
      h(
        "div",
        { class: "btn-row" },
        checkButton,
        h(
          "button",
          {
            type: "button",
            class: "btn btn-ghost",
            id: "settings-clear-history",
            onClick: () => {
              const removed = context.events.emit("session:clear", undefined);
              ui.toast(removed ? `${plural(removed, "recent lookup")} cleared` : "No session history to clear");
            },
          },
          icon(Trash2),
          h("span", {}, "Clear history"),
        ),
      ),
    ),

    card(
      { title: "Privacy", iconNode: LockKeyhole },
      h(
        "ul",
        { class: "plain-list" },
        h("li", {}, "Generator and Card Sorter run on this device."),
        h("li", {}, "BIN Lookup sends a 6–8 digit prefix only — never a full number, expiry or CVV."),
        h("li", {}, "Inputs, results and recent lookups are kept in memory and cleared when the app closes. Only the theme is stored."),
        h("li", {}, "Exports go to the app's private cache and then to the share sheet. No storage permission is requested."),
        h("li", {}, "No analytics, tracking or accounts."),
      ),
    ),

    card(
      { title: "About", iconNode: Info },
      h(
        "dl",
        { class: "meta-list" },
        row("App", config.appName),
        row("Version", versionValue),
        row("Build", buildValue),
        row("Platform", platform.kind === "android" ? "Android" : "Web preview"),
      ),
      h(
        "nav",
        { class: "setting-links", "aria-label": "External links" },
        link(platform.kind, config.communityUrl, "ORIGEN channel on Telegram"),
        link(platform.kind, config.sourceUrl, "ORIGEN source on GitHub"),
      ),
      h("p", { class: "hint" }, "Synthetic test data for development and QA. Apache License 2.0. BIN data: venelinkochev/bin-list-data, CC BY 4.0, via Guison."),
    ),
  );

  const root = h("div", { class: "screen", "data-tool": "settings" }, scroller);

  theme.subscribe(() => themeControl.set(theme.preference));

  return {
    root,
    reselect() {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
  };
}

export const settingsTool: ToolDefinition = {
  id: "settings",
  navLabel: "Settings",
  title: "Settings",
  description: "Appearance, tools, the BIN service, privacy and app information.",
  icon: SlidersHorizontal,
  network: "none",
  create: createSettingsScreen,
};
