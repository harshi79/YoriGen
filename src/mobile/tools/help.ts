/**
 * Help — a local reference for the app that is actually installed.
 *
 * Every instruction below describes a control, route or limit that exists in
 * this repository. Nothing is fetched to render it, so the page is identical
 * offline and online.
 */
import { ArrowLeft, CircleHelp, Fingerprint, ListFilter, LockKeyhole, Send, TriangleAlert, WifiOff, Zap } from "lucide";
import type { ToolContext } from "../core/context";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { card } from "../ui/components";
import { h, icon, scrollBehavior } from "../ui/dom";

/** Settings is the only screen that opens Help, so Back always returns there. */
const RETURN_TO = "settings";

function steps(...items: [string, string][]) {
  return h(
    "ol",
    { class: "help-steps" },
    ...items.map(([title, body]) =>
      h("li", {}, h("strong", {}, `${title}. `), body),
    ),
  );
}

function bullets(...items: string[]) {
  return h("ul", { class: "plain-list" }, ...items.map((item) => h("li", {}, item)));
}

/** A labelled row describing one control. */
function control(name: string, what: string) {
  return h("div", { class: "meta-row" }, h("dt", {}, name), h("dd", {}, what));
}

function createHelpScreen(context: ToolContext): ToolScreen {
  const { binService } = context;

  const scroller = h(
    "div",
    { class: "screen-scroll" },
    card(
      { title: "What ORIGEN does", iconNode: CircleHelp },
      h(
        "p",
        { class: "help-lede" },
        "Three tools for payment test data: build synthetic card fixtures, look up the metadata behind a card prefix, and clean up a list of records you already have. Nothing here verifies a card, checks an account, or moves money.",
      ),
      h(
        "dl",
        { class: "meta-list" },
        control("Generator", "Creates synthetic, Luhn-valid card numbers on this device."),
        control("BIN Lookup", "Fetches scheme, issuer and country for a 6–8 digit prefix. Needs internet."),
        control("Card Sorter", "Cleans, dedupes and sorts records you paste in. On this device."),
        control("Settings", "Theme, service status, session history, privacy and this page."),
      ),
      h(
        "p",
        { class: "hint" },
        "Switch tools with the bar at the bottom, or swipe left and right across the screen. Each tool keeps its own state while you move between them.",
      ),
    ),

    card(
      { title: "Generator", iconNode: Zap },
      steps(
        ["Set the prefix", "Type 6–8 digits, a masked template such as 5279109907xxxxxx where each x is filled in locally, or switch on Auto prefix to have a compatible prefix built for you."],
        ["Pick a network", "Auto detects it from the prefix. You can pin one, or choose Random compatible. Nine networks are supported."],
        ["Set expiry and CVV", "Auto builds a future date and the right CVV width — 4 digits for Amex, 3 for the rest. Custom expiry accepts a month after the current one, up to 10 years ahead."],
        ["Choose a quantity", "1 to 100, with presets for 1, 5, 10, 25, 50 and 100."],
        ["Generate", "The summary line above the button previews the run. Results appear on the Results tab."],
      ),
      h(
        "dl",
        { class: "meta-list" },
        control("Results tab", "Every fixture carries a synthetic test fixture tag. Copy one row, copy all, or export as .txt, .csv or .json."),
        control("Back", "From Results, returns to the Builder without clearing anything."),
        control("Clear results", "Asks first. Builder settings are kept."),
      ),
      h(
        "p",
        { class: "hint" },
        "Validation runs as you type, and nothing is generated while a field is invalid. A complete card number pasted into the prefix field is rejected rather than shortened.",
      ),
    ),

    card(
      { title: "BIN Lookup", iconNode: Fingerprint },
      h(
        "p",
        { class: "notice notice-warning" },
        icon(WifiOff),
        h("span", {}, "This is the only tool that uses the internet. Generator, Card Sorter and Settings work with no connection."),
      ),
      steps(
        ["Enter a prefix", "6 to 8 digits. A full card number, expiry or CVV is rejected on the device before any request is made."],
        ["Look up metadata", `Only the prefix is sent to ${binService.label}. The reply covers scheme, brand, card type, issuer, country and number length.`],
        ["Read the result", "Marked Live when it came from the service just now. Unknown fields are shown as Unknown rather than guessed."],
      ),
      h(
        "dl",
        { class: "meta-list" },
        control("Recent lookups", "Kept in memory for this session only, and never written to storage."),
        control("Cancel", "Stops a running lookup. Android Back does the same."),
        control("Offline", "The lookup fails straight away with an offline message. Nothing is queued and no metadata is invented."),
      ),
      h(
        "p",
        { class: "hint" },
        "The service runs on shared hosting, so the first request after a quiet period can take a few seconds. A prefix with no record is shown as a normal empty result, not an error.",
      ),
    ),

    card(
      { title: "Card Sorter", iconNode: ListFilter },
      steps(
        ["Add records", "Paste one record per line, use Paste to pull from the clipboard, or use Load file for a plain-text file up to 5 MB. Files are read on this device and never uploaded."],
        ["Check the overview", "Input lines, unique, duplicates, empty and remaining update as you type."],
        ["Clean", "Clean all runs every action at once, or use the individual chips. Unrecognized lines are kept unless you choose the action that removes them."],
        ["Sort", "By full line, number prefix, detected network or parsed expiry, ascending or descending."],
        ["Take the result", "Copy all, or export as a .txt file through the Android share sheet."],
      ),
      h(
        "p",
        { class: "hint" },
        "Accepted per line: number|MM|YYYY|CVV, number|MM/YY|CVV, number,MM,YYYY,CVV, number:MM:YYYY:CVV, tab or double-space variants, or a number on its own.",
      ),
    ),

    card(
      { title: "Settings", iconNode: LockKeyhole },
      h(
        "dl",
        { class: "meta-list" },
        control("Theme", "Dark, Light or System. This is the only choice the app saves."),
        control("Tools", "Which tools work offline and which need a connection."),
        control("BIN metadata service", "The endpoint in use. Check service status calls it once, only when you tap it, and sends no BIN."),
        control("Clear session history", "Empties the recent lookups list. It does not touch anything else."),
        control("Version and build", "Read from the installed package."),
      ),
    ),

    card(
      { title: "Community buttons", iconNode: Send },
      bullets(
        "The community prompt appears each time the app starts. Close or Maybe later dismisses it for that session; it returns on the next launch.",
        "Join YoriMethods and Join Chat Group hand their links to Android, which opens Telegram if it is installed and the browser if it is not.",
        "No Telegram account and no extra permission is needed to keep using ORIGEN.",
        "If nothing on the device can open the link, the prompt still closes and the app carries on.",
      ),
    ),

    card(
      { title: "Limits and privacy", iconNode: TriangleAlert },
      bullets(
        "Generated numbers pass the Luhn checksum but are not reserved test numbers, so they can coincide with real ones. Use your provider's official sandbox fixtures for gateway testing.",
        "A valid checksum never means an active account. ORIGEN does not verify cards, check balances, authorize transactions or process payments.",
        "Session data — inputs, results and recent lookups — lives in memory and is gone when the app closes. Only the theme choice is stored.",
        "The app requests internet access for BIN Lookup, and network state to report offline honestly. No storage, camera, location or contacts permission is requested.",
        "No analytics, tracking, accounts or advertising.",
        "Exports are written to the app's private cache and handed to the share sheet.",
      ),
    ),
  );

  const backRow = h(
    "div",
    { class: "action-bar action-bar-row" },
    h(
      "button",
      { type: "button", class: "btn btn-secondary btn-block", id: "help-back", onClick: () => context.navigate(RETURN_TO) },
      icon(ArrowLeft),
      h("span", {}, "Back to Settings"),
    ),
  );

  const root = h("div", { class: "screen", "data-tool": "help" }, scroller, backRow);

  return {
    root,
    handleBack() {
      context.navigate(RETURN_TO);
      return true;
    },
    reselect() {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
  };
}

export const helpTool: ToolDefinition = {
  id: "help",
  navLabel: "Help",
  title: "Help",
  description: "How each tool works, what the settings do, and what the app does not do.",
  icon: CircleHelp,
  network: "none",
  // Opened from Settings. Not a permanent bottom-navigation destination.
  navHidden: true,
  create: createHelpScreen,
};
