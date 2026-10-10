/**
 * Card Sorter — mobile screen for the local test-data organizer.
 *
 * Text is parsed, cleaned and sorted on the device by the shared transforms
 * in src/sorter.ts. Nothing is uploaded, verified or looked up, and
 * unrecognized lines are kept unless the user explicitly removes them.
 */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ClipboardPaste, Copy, FileText, ListFilter, Share2, ShieldCheck, Sparkles, Trash2 } from "lucide";
import type { SortKey } from "../../sorter";
import type { ToolContext } from "../core/context";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import { SORT_LABELS, SORTER_ACTIONS, SorterSession, type SorterActionId } from "../logic/sorter-session";
import { button, card, emptyState, iconButton, segmented, selectControl } from "../ui/components";
import { h, icon, plural, replace, scrollBehavior } from "../ui/dom";

/** At or above this many lines an action shows a working state before it runs. */
export const LOADING_THRESHOLD = 2000;
/** Files larger than this are refused with a clear message. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
type View = "input" | "result";

export function isPlainTextFile(file: Pick<File, "type" | "name">): boolean {
  return file.type.startsWith("text/") || /\.(txt|csv|tsv|log|json|dat|list)$/i.test(file.name);
}

function createSorterScreen(context: ToolContext): ToolScreen {
  const { ui, platform } = context;
  const session = new SorterSession();
  let view: View = "input";
  let busy = false;
  let pending: ReturnType<typeof setTimeout> | undefined;

  // ---------- Input view ----------
  const input = h("textarea", {
    id: "sorter-input",
    class: "control textarea mono",
    rows: "9",
    wrap: "off",
    spellcheck: "false",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    placeholder: "Paste one card record per line",
    "aria-label": "Card records, one record per line",
    "aria-describedby": "sorter-format-hint sorter-preserve-hint",
  });
  const fileInput = h("input", {
    type: "file",
    id: "sorter-file",
    class: "visually-hidden",
    accept: ".txt,.csv,.tsv,.log,.json,text/*",
    tabindex: "-1",
    "aria-hidden": "true",
  });
  const inputError = h("p", { class: "field-error", id: "sorter-error", role: "alert", hidden: true });
  const lineBadge = h("span", { class: "badge", id: "sorter-line-badge" }, "LOCAL ONLY");

  const statValue = (id: string) => h("strong", { id }, "0");
  const stats = {
    input: statValue("sorter-stat-input"),
    unique: statValue("sorter-stat-unique"),
    duplicates: statValue("sorter-stat-duplicates"),
    empty: statValue("sorter-stat-empty"),
    remaining: statValue("sorter-stat-remaining"),
  };
  const mix = h("p", { class: "hint", id: "sorter-mix" });
  const statsGrid = h(
    "dl",
    { class: "stats" },
    ...([
      ["Input lines", stats.input],
      ["Unique", stats.unique],
      ["Duplicates", stats.duplicates],
      ["Empty", stats.empty],
      ["Remaining", stats.remaining],
    ] as const).map(([label, value]) => h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value))),
  );

  const inputView = h(
    "div",
    { class: "view", id: "sorter-input-view" },
    h("div", { class: "notice" }, icon(ShieldCheck), h("span", {}, "Local text processing — data is not uploaded.")),
    card(
      { title: "Paste test records", className: "sorter-source" },
      h("div", { class: "card-head-extra" }, lineBadge),
      input,
      fileInput,
      inputError,
      h(
        "div",
        { class: "btn-row" },
        button({ label: "Paste", iconNode: ClipboardPaste, id: "sorter-paste", onClick: () => void pasteFromClipboard() }),
        button({ label: "Load file", iconNode: FileText, id: "sorter-load", onClick: () => fileInput.click() }),
        iconButton({ label: "Clear input and result", iconNode: Trash2, onClick: () => void clearAll() }),
      ),
      h(
        "p",
        { class: "hint", id: "sorter-format-hint" },
        "Accepted per line: number|MM|YYYY|CVV, number|MM/YY|CVV, number,MM,YYYY,CVV, number:MM:YYYY:CVV, tab or double-space variants, or a number alone.",
      ),
      h(
        "p",
        { class: "hint", id: "sorter-preserve-hint" },
        "Unrecognized lines are kept. Only “Remove invalid” drops them, and it tells you how many went.",
      ),
    ),
    card({ title: "Overview" }, statsGrid, mix),
    h("p", { class: "footnote" }, "No uploads. No card verification. No external requests. Plain-text files up to 5 MB are read on this device."),
  );

  // ---------- Result view ----------
  const status = h("p", { class: "results-meta", id: "sorter-status", "aria-live": "polite" });
  const beforeAfter = h("p", { class: "hint", id: "sorter-before-after" });
  const output = h("textarea", {
    id: "sorter-output",
    class: "control textarea mono",
    rows: "12",
    wrap: "off",
    readonly: true,
    spellcheck: "false",
    "aria-label": "Sorted result, one record per line",
  });
  const outputState = h("div", { class: "sorter-output-state" });

  const actionButtons = SORTER_ACTIONS.filter((action) => action.id !== "clean-all").map((action) =>
    h(
      "button",
      {
        type: "button",
        class: `chip-btn${action.destructive ? " chip-btn-danger" : ""}`,
        "data-action": action.id,
        title: action.description,
        onClick: () => void run(action.id),
      },
      action.label,
    ),
  );
  const sortKeySelect = selectControl<SortKey>(
    "sorter-sort-key",
    (Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({ value: key, label: `Sort by ${SORT_LABELS[key]}` })),
    session.sortKey,
  );
  const sortAsc = iconButton({ label: "Sort ascending", iconNode: ArrowUpNarrowWide, onClick: () => applySort("asc") });
  const sortDesc = iconButton({ label: "Sort descending", iconNode: ArrowDownWideNarrow, onClick: () => applySort("desc") });

  const resultBody = h("div", { class: "results-body" });
  const resultView = h(
    "div",
    { class: "view", id: "sorter-result-view", hidden: true },
    card(
      { title: "Clean & sort", iconNode: ListFilter },
      button({ label: "Clean all", iconNode: Sparkles, variant: "primary", id: "sorter-clean-all", className: "btn-block", onClick: () => void run("clean-all") }),
      h("div", { class: "chips", role: "group", "aria-label": "Cleaning actions" }, ...actionButtons),
      h("div", { class: "field-row sort-row" }, h("label", { class: "visually-hidden", for: "sorter-sort-key" }, "Sort key"), sortKeySelect, sortAsc, sortDesc),
    ),
    resultBody,
  );

  const inputBar = h(
    "div",
    { class: "action-bar action-bar-row" },
    button({ label: "Clean all", iconNode: Sparkles, variant: "primary", id: "sorter-quick-clean", onClick: () => void run("clean-all") }),
    button({ label: "View result", iconNode: ListFilter, id: "sorter-view-result", onClick: () => showView("result") }),
  );
  const resultBar = h(
    "div",
    { class: "action-bar action-bar-row", hidden: true },
    button({ label: "Copy all", iconNode: Copy, variant: "primary", id: "sorter-copy-all", onClick: () => copyAll() }),
    button({ label: "Export", iconNode: Share2, id: "sorter-export", onClick: () => void exportResult() }),
  );

  const viewTabs = segmented<View>({
    label: "Card Sorter view",
    id: "sorter-view",
    segments: [
      { value: "input", label: "Input" },
      { value: "result", label: "Result" },
    ],
    value: "input",
    onChange: (next) => showView(next),
  });
  const resultTab = viewTabs.element.querySelector<HTMLButtonElement>('[data-value="result"]')!;
  const scroller = h("div", { class: "screen-scroll" }, h("div", { class: "screen-sticky" }, viewTabs.element), inputView, resultView);
  const root = h("div", { class: "screen", "data-tool": "sorter" }, scroller, inputBar, resultBar);

  // ---------- Behaviour ----------
  function showError(message: string) {
    inputError.textContent = message;
    inputError.hidden = false;
  }
  function hideError() {
    inputError.hidden = true;
  }

  function render() {
    const current = session.stats;
    stats.input.textContent = String(current.inputLines);
    stats.unique.textContent = String(current.uniqueLines);
    stats.duplicates.textContent = String(current.duplicatesRemoved);
    stats.empty.textContent = String(current.emptyLinesRemoved);
    stats.remaining.textContent = String(current.remainingLines);
    mix.textContent = session.hasInput
      ? `${plural(current.recognized, "record")} recognized · ${current.unrecognized} unrecognized kept`
      : "Statistics appear as soon as you paste.";
    lineBadge.textContent = session.hasInput ? `${current.inputLines} LINES` : "LOCAL ONLY";
    resultTab.textContent = session.hasInput ? `Result · ${current.remainingLines}` : "Result";
    status.textContent = session.status;
    beforeAfter.textContent = `Before ${current.inputLines} → after ${current.remainingLines} lines`;

    const text = session.output;
    if (output.value !== text) output.value = text;
    resultBody.setAttribute("aria-busy", String(busy));
    if (busy) {
      replace(outputState, h("div", { class: "state state-loading" }, h("div", { class: "skeleton" }, h("span", {}), h("span", {}), h("span", {})), h("p", { class: "state-body" }, `Working through ${current.inputLines} lines on this device…`)));
      replace(resultBody, outputState);
    } else if (!session.entries.length) {
      replace(
        resultBody,
        emptyState(
          session.hasInput
            ? { iconNode: ListFilter, title: "No lines left in the result", body: "Edit the input to start again, or clear everything." }
            : {
                iconNode: ClipboardPaste,
                title: "Nothing sorted yet",
                body: "Paste records or load a text file on the Input tab. Cleaning happens instantly on this device.",
                action: button({ label: "Go to input", iconNode: ClipboardPaste, onClick: () => showView("input") }),
              },
        ),
      );
    } else {
      replace(resultBody, card({ title: "Result", badge: `${current.remainingLines} LINES` }, status, beforeAfter, output));
    }
    const hasEntries = session.entries.length > 0;
    for (const control of root.querySelectorAll<HTMLButtonElement>("[data-action], #sorter-clean-all, #sorter-quick-clean")) control.disabled = busy || !hasEntries;
    sortAsc.disabled = sortDesc.disabled = busy || !hasEntries;
    for (const id of ["sorter-copy-all", "sorter-export"]) root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = busy || !hasEntries;
    sortAsc.setAttribute("aria-pressed", String(session.direction === "asc"));
    sortDesc.setAttribute("aria-pressed", String(session.direction === "desc"));
  }

  function syncFromInput() {
    session.setSource(input.value);
    render();
  }
  function flushPending() {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
    syncFromInput();
  }

  function showView(next: View) {
    flushPending();
    view = next;
    viewTabs.set(next);
    inputView.hidden = next !== "input";
    resultView.hidden = next !== "result";
    inputBar.hidden = next !== "input";
    resultBar.hidden = next !== "result";
    scroller.scrollTop = 0;
  }

  async function run(id: SorterActionId) {
    if (busy) return;
    flushPending();
    if (!session.entries.length) {
      ui.toast("Nothing to process yet. Paste a few lines first.", "error");
      return;
    }
    const heavy = session.entries.length >= LOADING_THRESHOLD;
    if (view !== "result") showView("result");
    if (heavy) {
      busy = true;
      render();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    try {
      const result = session.apply(id);
      ui.toast(result.toast, result.ok ? "ok" : "error");
    } catch {
      ui.toast("That action could not be completed. Your text is unchanged.", "error");
    } finally {
      busy = false;
      render();
    }
  }

  function applySort(direction: "asc" | "desc") {
    flushPending();
    const result = session.sort(sortKeySelect.value as SortKey, direction);
    ui.toast(result.toast, result.ok ? "ok" : "error");
    render();
  }

  function copyAll() {
    if (!session.entries.length) return;
    void ui.copy(session.output, `${plural(session.entries.length, "line")} copied`);
  }

  async function exportResult() {
    if (!session.entries.length) return;
    const file = session.exportFile();
    await ui.exportFile(file, `${file.filename} ready`);
  }

  async function pasteFromClipboard() {
    hideError();
    let text = "";
    try {
      text = await platform.clipboard.read();
    } catch {
      ui.toast("Clipboard reading is unavailable. Long-press the text box and choose Paste.", "error");
      return;
    }
    if (!text) {
      ui.toast("The clipboard has no text to paste.", "error");
      return;
    }
    if (input.value && !(await ui.sheets.confirm({ title: "Replace current input?", message: "The clipboard text will replace what is in the input box.", confirmLabel: "Replace" }))) return;
    input.value = text;
    syncFromInput();
    ui.toast(`${plural(session.stats.inputLines, "line")} pasted`);
  }

  async function loadFile(file: File) {
    hideError();
    if (!isPlainTextFile(file)) {
      showError(`“${file.name}” is not a plain-text file. Card Sorter only reads text.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError("That file is larger than 5 MB. Split it, or paste the part you need.");
      return;
    }
    try {
      const text = await file.text();
      if (text.includes("\0")) {
        showError(`“${file.name}” looks like a binary file. Card Sorter only reads plain text.`);
        return;
      }
      input.value = text;
      syncFromInput();
      ui.toast(`${file.name} loaded locally (${plural(session.stats.inputLines, "line")})`);
    } catch {
      showError("That file could not be read. Paste its contents instead.");
    }
  }

  async function clearAll() {
    flushPending();
    if (!input.value) return;
    const confirmed = await ui.sheets.confirm({
      title: "Clear Card Sorter?",
      message: "The pasted input and the result will both be emptied. This cannot be undone.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!confirmed) return;
    input.value = "";
    hideError();
    syncFromInput();
    showView("input");
    ui.toast("Card Sorter cleared");
  }

  input.addEventListener("input", () => {
    hideError();
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      syncFromInput();
    }, 120);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void loadFile(file);
  });
  sortKeySelect.addEventListener("change", () => {
    session.setSortKey(sortKeySelect.value as SortKey);
    if (session.direction) applySort(session.direction);
  });

  syncFromInput();
  showView("input");

  return {
    root,
    handleBack() {
      if (view === "result") {
        showView("input");
        return true;
      }
      return false;
    },
    deactivate: flushPending,
    reselect() {
      scroller.scrollTo({ top: 0, behavior: scrollBehavior() });
    },
  };
}

export const sorterTool: ToolDefinition = {
  id: "sorter",
  navLabel: "Sorter",
  title: "Card Sorter",
  description: "Clean, dedupe and sort pasted test records on this device.",
  icon: ListFilter,
  network: "none",
  create: createSorterScreen,
};
