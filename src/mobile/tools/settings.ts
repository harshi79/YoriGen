/**
 * Settings — appearance, connectivity, privacy and About.
 */
import { BookOpen, Activity, ExternalLink, Info, LockKeyhole, Palette, Server, SlidersHorizontal, Trash2 } from "lucide";
import type { ToolContext } from "../core/context";
import type { ThemePreference } from "../core/theme";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { BinServiceError } from "../services/bin-service";
import { button, card, segmented } from "../ui/components";
import { h, icon, plural, scrollBehavior } from "../ui/dom";

function link(href: string, label: string) {
  return h("a", { class: "list-link", href, target: "_blank", rel: "noopener noreferrer" }, h("span", {}, label), icon(ExternalLink));
}

function row(label: string, value: Node | string, id?: string) {
  return h("div", { class: "meta-row" }, h("dt", {}, label), h("dd", { id }, value));
}

function guideContent() {
  return [
    h(
      "ol",
      { class: "guide" },
      h("li", {}, h("strong", {}, "Set your BIN. "), "Type 6–8 prefix digits, a masked template such as 5279109907xxxxxx, or turn on Auto. Visible digits are kept and each x is filled locally."),
      h("li", {}, h("strong", {}, "Choose expiry and CVV. "), "Auto builds synthetic future dates and network-correct CVV widths. Custom values stay on this device."),
      h("li", {}, h("strong", {}, "Generate up to 100 fixtures. "), "Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, Maestro and RuPay, each with a Luhn check digit and labelled SYNTHETIC TEST FIXTURE."),
      h("li", {}, h("strong", {}, "Copy or export. "), "Pipe, CSV or JSON. JSON includes synthetic: true."),
    ),
    h(
      "p",
      { class: "notice notice-warning" },
      "A valid checksum does not mean an active account. These numbers are not reserved test numbers and may coincide with real ones. Never submit them to live payment systems; use your provider's official sandbox fixtures for gateway testing.",
    ),
    h(
      "p",
      { class: "hint" },
      "ORIGEN never processes payments, authorizes transactions, checks balances, verifies cards or accounts, or stores card data. BIN Lookup sends only a 6–8 digit prefix for range metadata.",
    ),
  ];
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
      row(tool.title, h("span", { class: tool.network === "none" ? "badge badge-good" : "badge badge-warn" }, tool.network === "none" ? "WORKS OFFLINE" : "NEEDS INTERNET")),
    ),
  );

  const statusBadge = h("span", { class: "badge", id: "settings-api-state" }, "NOT CHECKED");
  const statusText = h("p", { class: "hint", id: "settings-api-status" }, "Status is checked only when you ask. No BIN is sent.");
  let checking: AbortController | null = null;
  const checkButton = button({
    label: "Check service status",
    iconNode: Activity,
    id: "settings-check-api",
    onClick: async () => {
      if (checking) return;
      checking = new AbortController();
      checkButton.disabled = true;
      statusBadge.textContent = "CHECKING";
      statusBadge.className = "badge";
      statusText.textContent = "Checking dataset readiness…";
      try {
        await binService.checkStatus(checking.signal);
        statusBadge.textContent = "READY";
        statusBadge.className = "badge badge-good";
        statusText.textContent = "The service answered ready just now. It is not monitored continuously.";
      } catch (error) {
        statusBadge.textContent = error instanceof BinServiceError && error.code === "offline" ? "OFFLINE" : "UNAVAILABLE";
        statusBadge.className = "badge badge-warn";
        statusText.textContent = (error as Error).message;
      } finally {
        checking = null;
        checkButton.disabled = false;
      }
    },
  });

  const versionValue = h("span", { class: "mono" }, config.version);
  const buildValue = h("span", { class: "mono" }, "—");
  void platform.app.info().then((info) => {
    versionValue.textContent = info.version || config.version;
    buildValue.textContent = info.build || "—";
  });

  const scroller = h(
    "div",
    { class: "screen-scroll" },
    card({ title: "Appearance", iconNode: Palette }, themeControl.element, h("p", { class: "hint" }, "Dark is the default. System follows your phone's dark-mode setting. Only this choice is saved.")),
    card({ title: "Tools", iconNode: SlidersHorizontal }, toolRows, h("p", { class: "hint" }, "Local tools need no connection. BIN Lookup contacts the metadata service below.")),
    card(
      { title: "BIN metadata service", iconNode: Server },
      h("dl", { class: "meta-list" }, row("Service", binService.label), row("Endpoint", h("span", { class: "mono break" }, binService.origin)), row("Status", statusBadge)),
      statusText,
      h(
        "div",
        { class: "btn-row" },
        checkButton,
        button({
          label: "Clear session history",
          iconNode: Trash2,
          variant: "ghost",
          id: "settings-clear-history",
          onClick: () => {
            const removed = context.events.emit("session:clear", undefined);
            ui.toast(removed ? `${plural(removed, "recent lookup")} cleared` : "No session history to clear");
          },
        }),
      ),
    ),
    card(
      { title: "Privacy", iconNode: LockKeyhole },
      h(
        "ul",
        { class: "plain-list" },
        h("li", {}, "Generator and Card Sorter run entirely on this device."),
        h("li", {}, "Only your theme choice is stored. Inputs, results and recent lookups are kept in memory and cleared when the app closes."),
        h("li", {}, "BIN Lookup sends a 6–8 digit prefix only — never a full number, expiry or CVV."),
        h("li", {}, "Exports are written to the app's private cache and handed to the share sheet. No storage permission is requested."),
      ),
    ),
    card(
      { title: "About", iconNode: Info },
      h("dl", { class: "meta-list" }, row("App", config.appName), row("Version", versionValue), row("Build", buildValue), row("Platform", platform.kind === "android" ? "Android" : "Web preview")),
      button({ label: "How ORIGEN works", iconNode: BookOpen, id: "settings-guide", onClick: () => ui.sheets.open({ title: "A small tool for better tests", content: guideContent() }) }),
      h("nav", { class: "link-list", "aria-label": "External links" }, link(config.communityUrl, "Join the ORIGEN channel on Telegram"), link(config.sourceUrl, "Source code")),
      h("p", { class: "hint" }, "Synthetic test data for development and QA only. Licensed under the Apache License 2.0. BIN data: venelinkochev/bin-list-data (CC BY 4.0) via Guison."),
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
  description: "Appearance, connectivity, privacy and app information.",
  icon: SlidersHorizontal,
  network: "none",
  create: createSettingsScreen,
};
