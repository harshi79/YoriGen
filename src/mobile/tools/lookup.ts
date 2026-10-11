/**
 * BIN Lookup — mobile screen for prefix metadata.
 *
 * Only a validated 6–8 digit prefix is ever sent, and only to the configured
 * Guison-compatible service. Offline and failed requests are reported as
 * such; nothing is cached across launches and nothing is fabricated.
 */
import { Copy, Fingerprint, History, LoaderCircle, Search, SearchX, Wifi, WifiOff, X } from "lucide";
import { validateBin } from "../../bin";
import { formatMetadata, LookupHistory, metadataEntries, type BinMetadata } from "../../guison";
import type { ToolContext } from "../core/context";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { BinServiceError } from "../services/bin-service";
import { button, card, emptyState, errorState, field } from "../ui/components";
import { h, icon, replace, scrollBehavior } from "../ui/dom";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading"; bin: string }
  | { kind: "result"; data: BinMetadata; cached: boolean }
  | { kind: "error"; bin: string; error: BinServiceError };

function createLookupScreen(context: ToolContext): ToolScreen {
  const { ui, binService, platform } = context;
  const history = new LookupHistory();
  let state: LookupState = { kind: "idle" };
  let pending: AbortController | null = null;

  const networkChip = h("span", { class: "chip", id: "lookup-network" });
  const offlineBanner = h(
    "div",
    { class: "notice notice-warning", id: "lookup-offline", role: "status", hidden: true },
    icon(WifiOff),
    h("span", {}, "You're offline. BIN Lookup needs internet; Generator and Card Sorter still work."),
  );

  const binInput = h("input", {
    id: "lookup-bin",
    class: "control mono control-lg",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "search",
    placeholder: "e.g. 457173",
    // No maxlength: a pasted full card number must be rejected, not truncated.
  });
  const binField = field({
    label: "BIN / IIN prefix",
    controlId: "lookup-bin",
    control: binInput,
    hint: `Enter 6–8 digits. Only the prefix is sent to ${binService.label}; full card numbers are rejected on this device.`,
  });
  const submit = h(
    "button",
    { type: "submit", class: "btn btn-primary btn-block", id: "lookup-submit" },
    icon(Search),
    h("span", {}, "Look up metadata"),
  );
  const form = h(
    "form",
    { class: "lookup-form", novalidate: true, role: "search", "aria-label": "BIN metadata lookup" },
    binField.element,
    submit,
  );

  const resultHost = h("div", { class: "lookup-result", id: "lookup-result", "aria-live": "polite" });
  const historyList = h("div", { class: "history-list", id: "lookup-history" });
  const historyCard = card({ title: "Recent lookups", badge: "This session", iconNode: History }, historyList);

  const scroller = h(
    "div",
    { class: "screen-scroll" },
    h(
      "div",
      { class: "status-row" },
      networkChip,
      h("span", { class: "badge" }, "Needs internet"),
    ),
    offlineBanner,
    card({ title: "Look up a prefix", iconNode: Fingerprint }, form),
    resultHost,
    historyCard,
    h("p", { class: "footnote" }, "Metadata only: scheme, issuer and country for a prefix range. This never verifies a card or account."),
  );
  const root = h("div", { class: "screen", "data-tool": "lookup" }, scroller);

  function renderNetwork(online: boolean) {
    replace(networkChip, icon(online ? Wifi : WifiOff), online ? "Online" : "Offline");
    networkChip.classList.toggle("chip-warning", !online);
    offlineBanner.hidden = online;
  }

  function setLoading(loading: boolean) {
    submit.disabled = loading;
    binInput.readOnly = loading;
    replace(
      submit,
      icon(loading ? LoaderCircle : Search, loading ? "spin" : ""),
      h("span", {}, loading ? "Looking up…" : "Look up metadata"),
    );
  }

  function render() {
    resultHost.setAttribute("aria-busy", String(state.kind === "loading"));
    switch (state.kind) {
      case "idle":
        replace(
          resultHost,
          emptyState({
            iconNode: Fingerprint,
            title: "No lookup yet",
            body: "Enter a 6–8 digit prefix to see network, issuer and country metadata. Nothing is sent until you tap Look up metadata.",
          }),
        );
        return;
      case "loading":
        replace(
          resultHost,
          h(
            "div",
            { class: "state state-loading" },
            h("div", { class: "skeleton" }, h("span", {}), h("span", {}), h("span", {})),
            h("p", { class: "state-body" }, `Requesting metadata for ${state.bin}… The service can take a few seconds to wake up.`),
            button({ label: "Cancel", iconNode: X, variant: "ghost", onClick: () => cancel() }),
          ),
        );
        return;
      case "error": {
        const { error, bin } = state;
        const notFound = error.code === "not_found";
        replace(
          resultHost,
          notFound
            ? emptyState({ iconNode: SearchX, title: `No metadata for ${bin}`, body: error.message })
            : errorState({
                title: error.code === "offline" ? "You're offline" : "Lookup failed",
                message: error.message,
                onRetry: error.retryable ? () => void lookup(bin) : undefined,
              }),
        );
        return;
      }
      case "result": {
        const { data, cached } = state;
        const rows = h("dl", { class: "meta-list" });
        for (const [label, value] of metadataEntries(data))
          rows.append(h("div", { class: "meta-row" }, h("dt", {}, label), h("dd", { class: value === "Unknown" ? "unknown" : "" }, value)));
        const json = h("pre", { class: "code", tabindex: "0", "aria-label": "BIN metadata JSON" }, formatMetadata(data, "json"));
        replace(
          resultHost,
          card(
            { title: `BIN ${data.bin}`, badge: cached ? "Session snapshot" : "Live", className: "result-card" },
            h("p", { class: "hint" }, cached ? "Saved in this session; not refreshed." : `Returned by ${binService.label} · not card verification.`),
            rows,
            h("details", { class: "details" }, h("summary", {}, "Full response (JSON)"), json),
            h(
              "div",
              { class: "btn-row" },
              button({ label: "Copy", iconNode: Copy, onClick: () => void ui.copy(formatMetadata(data, "text"), "BIN metadata copied") }),
              button({ label: "Copy JSON", iconNode: Copy, onClick: () => void ui.copy(formatMetadata(data, "json"), "BIN metadata copied as JSON") }),
            ),
          ),
        );
        return;
      }
    }
  }

  function renderHistory() {
    historyCard.hidden = !history.items.length;
    replace(
      historyList,
      ...history.items.map((entry) =>
        h(
          "button",
          {
            type: "button",
            class: "history-item",
            "aria-label": `View recent lookup ${entry.metadata.bin}`,
            onClick: () => {
              cancel();
              binInput.value = entry.metadata.bin;
              binField.setError(undefined);
              state = { kind: "result", data: entry.metadata, cached: true };
              render();
              resultHost.scrollIntoView({ block: "start", behavior: scrollBehavior() });
            },
          },
          h("strong", { class: "mono" }, entry.metadata.bin),
          h("span", {}, entry.metadata.scheme ?? "Unknown network"),
          h("time", { datetime: entry.lookedUpAt }, new Date(entry.lookedUpAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
        ),
      ),
    );
  }

  function cancel() {
    if (!pending) return;
    pending.abort();
    pending = null;
    setLoading(false);
    state = { kind: "idle" };
    render();
  }

  async function lookup(bin: string) {
    if (pending) return;
    try {
      validateBin(bin);
    } catch (error) {
      binField.setError((error as Error).message);
      binInput.focus();
      return;
    }
    binField.setError(undefined);
    binInput.blur();
    const controller = new AbortController();
    pending = controller;
    state = { kind: "loading", bin };
    setLoading(true);
    render();
    try {
      const data = await binService.lookup(bin, controller.signal);
      if (pending !== controller) return;
      history.add(data);
      state = { kind: "result", data, cached: false };
      renderHistory();
      ui.toast("BIN metadata loaded. No card or account was verified.");
    } catch (error) {
      if (pending !== controller) return;
      const serviceError = error instanceof BinServiceError ? error : new BinServiceError("unavailable", "The lookup failed unexpectedly.");
      state = serviceError.code === "cancelled" ? { kind: "idle" } : { kind: "error", bin, error: serviceError };
    } finally {
      if (pending === controller) {
        pending = null;
        setLoading(false);
        render();
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void lookup(binInput.value);
  });
  binInput.addEventListener("input", () => binField.setError(undefined));

  renderNetwork(platform.network.isOnline());
  platform.network.subscribe((online) => {
    renderNetwork(online);
    if (online && state.kind === "error" && state.error.code === "offline") ui.toast("Back online. You can retry the lookup.");
  });
  context.events.on("session:clear", () => {
    const removed = history.items.length;
    history.clear();
    if (state.kind === "result" && state.cached) state = { kind: "idle" };
    render();
    renderHistory();
    return removed;
  });
  render();
  renderHistory();

  return {
    root,
    handleBack() {
      if (pending) {
        cancel();
        return true;
      }
      return false;
    },
    reselect() {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
  };
}

export const lookupTool: ToolDefinition = {
  id: "lookup",
  navLabel: "BIN Lookup",
  title: "BIN Lookup",
  description: "Look up scheme, issuer and country metadata for a 6–8 digit prefix.",
  icon: Fingerprint,
  network: "required",
  create: createLookupScreen,
};
