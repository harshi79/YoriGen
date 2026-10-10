/**
 * Card Sorter panel — markup and interaction for the local text organizer.
 *
 * Every action in here works on strings already in the page. No fetch, no
 * verification, no upload: the panel only reads files the developer explicitly
 * drops or selects and never sends anything anywhere.
 */
import {
  cleanAll,
  normalizeSeparators,
  originalOrder,
  outputText,
  removeDuplicateLines,
  removeDuplicateRecords,
  removeEmptyLines,
  removeInvalidLines,
  reverseEntries,
  sortEntries,
  sorterExport,
  sorterStats,
  splitLines,
  toEntries,
  trimWhitespace,
  type SortDirection,
  type SortKey,
  type SorterEntry,
  type TransformOutcome,
} from "./sorter";

export interface SorterPanelServices {
  icon: (name: string, cls?: string) => string;
  refreshIcons: () => void;
  toast: (message: string, kind?: "ok" | "error") => void;
  copy: (text: string, message: string) => Promise<void>;
  isActive: () => boolean;
}

/** Above this many lines an action reports a loading state before it runs. */
const LOADING_THRESHOLD = 2000;
/** Dropped or selected files larger than this are refused with a clear message. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SORT_LABELS: Record<SortKey, string> = {
  line: "full line",
  number: "first field / number prefix",
  network: "locally detected network",
  expiry: "parsed expiry",
};

export const sorterMarkup = `
<section id="panel-sorter" role="tabpanel" aria-labelledby="tab-sorter" tabindex="0" hidden>
  <div class="sorter-layout">
    <div class="sorter-source">
      <section class="panel" aria-labelledby="sorter-input-title">
        <div class="panel-heading"><div><i data-lucide="clipboard-paste" aria-hidden="true"></i><h2 id="sorter-input-title">Paste test records</h2></div><span class="tiny-badge" id="sorter-input-badge">LOCAL ONLY</span></div>
        <div class="sorter-local-banner"><i data-lucide="shield-check" aria-hidden="true"></i><span>Local text processing — data is not uploaded.</span></div>
        <div class="sorter-drop" id="sorter-drop">
          <label class="sr-only" for="sorter-input">Card records, one record per line</label>
          <textarea id="sorter-input" spellcheck="false" autocomplete="off" wrap="off" placeholder="Paste one card record per line" aria-describedby="sorter-format-hint sorter-preserve-hint"></textarea>
          <div class="sorter-drop-overlay" aria-hidden="true"><i data-lucide="file-up"></i><span>Drop a text file to load it locally</span></div>
        </div>
        <div class="sorter-source-toolbar">
          <button type="button" class="secondary-button" id="sorter-load"><i data-lucide="file-text" aria-hidden="true"></i>Load text file</button>
          <input id="sorter-file" class="sr-only" type="file" accept=".txt,.csv,.tsv,.log,.json,text/*" tabindex="-1" aria-hidden="true" />
          <span class="sorter-file-note">Plain text only · max 5 MB · read locally</span>
        </div>
        <p class="hint" id="sorter-format-hint">Accepted per line: <code>number|MM|YYYY|CVV</code>, <code>number|MM/YY|CVV</code>, <code>number,MM,YYYY,CVV</code>, <code>number:MM:YYYY:CVV</code>, tab or double-space variants, or a number alone.</p>
        <p class="hint" id="sorter-preserve-hint">Unrecognized lines are preserved, never silently deleted. Only “Remove invalid/empty lines” drops them, and it tells you how many went.</p>
        <div class="sorter-note"><i data-lucide="lock-keyhole" aria-hidden="true"></i>No uploads. No card verification. No external requests.</div>
      </section>
      <section class="panel" aria-labelledby="sorter-actions-title">
        <div class="panel-heading"><div><i data-lucide="wand-2" aria-hidden="true"></i><h2 id="sorter-actions-title">Cleaning actions</h2></div><span class="step-tag">01</span></div>
        <div class="sorter-actions">
          <button type="button" class="generate-button" id="sorter-clean-all" title="Trim, remove empty lines, normalize separators and remove duplicate records (Ctrl / ⌘ + Enter)"><i data-lucide="sparkles" aria-hidden="true"></i>Clean all<i data-lucide="arrow-right" aria-hidden="true"></i></button>
          <div class="sorter-group"><span class="sorter-group-title">REMOVE</span>
            <button type="button" class="sorter-action" id="sorter-dedupe" title="Shortcut: Ctrl / ⌘ + Shift + U"><i data-lucide="copy-x" aria-hidden="true"></i><span>Remove duplicates</span><kbd>⇧U</kbd></button>
            <button type="button" class="sorter-action" id="sorter-empty" title="Shortcut: Ctrl / ⌘ + Shift + E"><i data-lucide="rows-3" aria-hidden="true"></i><span>Remove empty lines</span><kbd>⇧E</kbd></button>
            <button type="button" class="sorter-action" id="sorter-records" title="Drops lines that repeat the same record in any accepted format"><i data-lucide="layers" aria-hidden="true"></i><span>Remove exact duplicate records</span><kbd>⇧R</kbd></button>
            <button type="button" class="sorter-action" id="sorter-invalid"><i data-lucide="circle-slash" aria-hidden="true"></i><span>Remove invalid/empty lines</span></button>
          </div>
          <div class="sorter-group"><span class="sorter-group-title">FORMAT</span>
            <button type="button" class="sorter-action" id="sorter-trim" title="Shortcut: Ctrl / ⌘ + Shift + L"><i data-lucide="text-cursor-input" aria-hidden="true"></i><span>Trim whitespace</span><kbd>⇧L</kbd></button>
            <button type="button" class="sorter-action" id="sorter-normalize" title="Shortcut: Ctrl / ⌘ + Shift + K"><i data-lucide="braces" aria-hidden="true"></i><span>Normalize separators</span><kbd>⇧K</kbd></button>
          </div>
          <div class="sorter-group"><span class="sorter-group-title">ORDER</span>
            <label class="sr-only" for="sorter-sort-key">Sort by</label>
            <div class="select-wrap no-icon"><select id="sorter-sort-key"><option value="line">Sort by · Full line</option><option value="number">Sort by · First field / number prefix</option><option value="network">Sort by · Network (detected locally)</option><option value="expiry">Sort by · Expiry (when parseable)</option></select><i data-lucide="chevron-down" aria-hidden="true"></i></div>
            <button type="button" class="sorter-action" id="sorter-sort-asc" title="Shortcut: Ctrl / ⌘ + Shift + 1" aria-label="Sort A to Z"><i data-lucide="sort-asc" aria-hidden="true"></i><span>Sort A → Z</span><kbd>⇧1</kbd></button>
            <button type="button" class="sorter-action" id="sorter-sort-desc" title="Shortcut: Ctrl / ⌘ + Shift + 2" aria-label="Sort Z to A"><i data-lucide="sort-desc" aria-hidden="true"></i><span>Sort Z → A</span><kbd>⇧2</kbd></button>
            <button type="button" class="sorter-action" id="sorter-reverse" title="Shortcut: Ctrl / ⌘ + Shift + 3"><i data-lucide="arrow-down-up" aria-hidden="true"></i><span>Reverse order</span><kbd>⇧3</kbd></button>
            <button type="button" class="sorter-action" id="sorter-original" title="Shortcut: Ctrl / ⌘ + Shift + 4"><i data-lucide="list-restart" aria-hidden="true"></i><span>Keep original order</span><kbd>⇧4</kbd></button>
          </div>
          <details class="sorter-shortcuts"><summary><i data-lucide="terminal" aria-hidden="true"></i>Keyboard shortcuts</summary>
            <ul>
              <li><kbd>⌘ / Ctrl</kbd><kbd>↵</kbd><span>Clean all</span></li>
              <li><kbd>⇧</kbd><kbd>U</kbd><span>Remove duplicates</span></li>
              <li><kbd>⇧</kbd><kbd>E</kbd><span>Remove empty lines</span></li>
              <li><kbd>⇧</kbd><kbd>L</kbd><span>Trim whitespace</span></li>
              <li><kbd>⇧</kbd><kbd>K</kbd><span>Normalize separators</span></li>
              <li><kbd>⇧</kbd><kbd>1</kbd><span>Sort A → Z</span></li>
              <li><kbd>⇧</kbd><kbd>2</kbd><span>Sort Z → A</span></li>
              <li><kbd>⇧</kbd><kbd>3</kbd><span>Reverse order</span></li>
              <li><kbd>⇧</kbd><kbd>4</kbd><span>Keep original order</span></li>
              <li><kbd>⇧</kbd><kbd>X</kbd><span>Copy all</span></li>
            </ul>
            <p class="hint">Hold <kbd>⌘</kbd> on macOS, <kbd>Ctrl</kbd> elsewhere.</p>
          </details>
        </div>
      </section>
    </div>
    <section class="panel sorter-result-panel" aria-labelledby="sorter-result-title">
      <div class="panel-heading"><div><i data-lucide="list-filter" aria-hidden="true"></i><h2 id="sorter-result-title">Cleaned result</h2><span class="count-badge" id="sorter-count">0</span></div><div class="sorter-before-after"><span>Before</span><strong id="sorter-before">0</strong><i data-lucide="arrow-right" aria-hidden="true"></i><span>After</span><strong id="sorter-after">0</strong></div></div>
      <div class="sorter-banner"><i data-lucide="shield-check" aria-hidden="true"></i><span>LOCAL TEXT PROCESSING — DATA IS NOT UPLOADED</span><span class="banner-dot"></span></div>
      <dl class="sorter-stats" aria-label="Live statistics">
        <div><dt title="Lines in the paste area">Input lines</dt><dd id="sorter-stat-input">0</dd></div>
        <div><dt title="Distinct lines in the paste area, ignoring surrounding whitespace">Unique lines</dt><dd id="sorter-stat-unique">0</dd></div>
        <div><dt title="Duplicate lines detected in the paste area">Duplicates removed</dt><dd id="sorter-stat-duplicates">0</dd></div>
        <div><dt title="Blank lines detected in the paste area">Empty lines removed</dt><dd id="sorter-stat-empty">0</dd></div>
        <div><dt title="Lines in the cleaned result">Remaining lines</dt><dd id="sorter-stat-remaining">0</dd></div>
      </dl>
      <div class="sorter-status-row"><p id="sorter-status" role="status" aria-live="polite">Waiting for input.</p><span class="sorter-mix" id="sorter-mix">0 records · 0 unrecognized kept</span></div>
      <p id="sorter-error" class="error" role="alert" hidden></p>
      <div class="sorter-output-wrap" id="sorter-output-wrap">
        <label class="sr-only" for="sorter-output">Cleaned result, one record per line</label>
        <textarea id="sorter-output" readonly wrap="off" spellcheck="false" aria-describedby="sorter-status"></textarea>
      </div>
      <div class="sorter-output-toolbar">
        <div class="sorter-output-actions">
          <button type="button" class="secondary-button" id="sorter-select-all"><i data-lucide="text-cursor-input" aria-hidden="true"></i>Select all</button>
          <button type="button" class="secondary-button" id="sorter-copy-all" title="Shortcut: Ctrl / ⌘ + Shift + X"><i data-lucide="copy" aria-hidden="true"></i>Copy all</button>
          <button type="button" class="secondary-button" id="sorter-download"><i data-lucide="download" aria-hidden="true"></i>Download TXT</button>
          <button type="button" class="subtle-button" id="sorter-clear" aria-label="Clear paste and result"><i data-lucide="trash-2" aria-hidden="true"></i><span>Clear</span></button>
        </div>
      </div>
    </section>
  </div>
  <p class="attribution">Card Sorter is a local organizer for test data you already have. It never verifies, authorizes, checks or looks up a card, and it makes no network requests.</p>
</section>`;

export function mountSorterPanel(services: SorterPanelServices): { focusInput: () => void } {
  const { icon, refreshIcons, toast, copy, isActive } = services;
  const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const input = $<HTMLTextAreaElement>("#sorter-input");
  const output = $<HTMLTextAreaElement>("#sorter-output");
  const sortKeySelect = $<HTMLSelectElement>("#sorter-sort-key");
  let source = "";
  let sourceLines: string[] = [];
  let entries: SorterEntry[] = [];
  let sortKey: SortKey = "line";
  let direction: SortDirection | null = null;
  let status = "";
  let busy = false;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const lineCount = (value: string) => splitLines(value).length;

  const RESULT_BUTTONS = new Set([
    "sorter-select-all",
    "sorter-copy-all",
    "sorter-download",
  ]);

  function setBusy(value: boolean) {
    busy = value;
    document
      .querySelectorAll<HTMLButtonElement>("#panel-sorter button")
      .forEach((button) => {
        button.disabled =
          value || (RESULT_BUTTONS.has(button.id) && !entries.length);
      });
  }

  function render() {
    const stats = sorterStats(sourceLines, entries);
    $<HTMLElement>("#sorter-stat-input").textContent = String(stats.inputLines);
    $<HTMLElement>("#sorter-stat-unique").textContent = String(stats.uniqueLines);
    $<HTMLElement>("#sorter-stat-duplicates").textContent = String(stats.duplicatesRemoved);
    $<HTMLElement>("#sorter-stat-empty").textContent = String(stats.emptyLinesRemoved);
    $<HTMLElement>("#sorter-stat-remaining").textContent = String(stats.remainingLines);
    $<HTMLElement>("#sorter-before").textContent = String(stats.inputLines);
    $<HTMLElement>("#sorter-after").textContent = String(stats.remainingLines);
    $<HTMLElement>("#sorter-count").textContent = String(stats.remainingLines);
    $<HTMLElement>("#sorter-mix").textContent = `${stats.recognized} records · ${stats.unrecognized} unrecognized kept`;
    $<HTMLElement>("#sorter-status").textContent =
      status ||
      (!sourceLines.length
        ? "Waiting for input."
        : stats.inputLines === stats.remainingLines
          ? "Mirrors your paste."
          : "Cleaned result differs from your paste.");
    $<HTMLElement>("#sorter-input-badge").textContent = sourceLines.length
      ? `${sourceLines.length} LINES`
      : "LOCAL ONLY";
    const text = outputText(entries);
    if (output.value !== text) output.value = text;
    $<HTMLElement>("#sorter-output-wrap").setAttribute("aria-busy", String(busy));
    const wrap = $("#sorter-output-wrap");
    const previous = wrap.querySelector(".sorter-output-state");
    if (previous) previous.remove();
    output.hidden = !entries.length;
    if (busy || !entries.length) {
      const state = document.createElement("div");
      state.className = `sorter-output-state${busy ? " is-loading" : ""}`;
      state.innerHTML = busy
        ? `${icon("loader-circle", "spin")}<h3>Working through ${stats.inputLines} lines…</h3><p>Everything stays in this tab.</p>`
        : sourceLines.length
          ? `${icon("list-filter")}<h3>No lines left in the result.</h3><p>Re-paste the text, or use <strong>Clear</strong> to start over.</p>`
          : `${icon("clipboard-paste")}<h3>Nothing sorted yet.</h3><p>Paste records on the left, or drop a text file. Cleaning happens instantly and locally.</p><div class="empty-code"><span>$</span> origen.cardSorter() <span class="cursor">▌</span></div>`;
      wrap.append(state);
      refreshIcons();
    }
    setBusy(busy);
  }

  function syncFromInput() {
    source = input.value;
    sourceLines = splitLines(source);
    entries = toEntries(sourceLines);
    direction = null;
    status = "";
    render();
  }

  function flushPending() {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
    syncFromInput();
  }

  function decorate(outcome: TransformOutcome, message: string) {
    entries = outcome.entries;
    status = message;
    render();
  }

  async function run<T extends TransformOutcome>(
    transform: (current: SorterEntry[]) => T,
    describe: (outcome: T) => { message: string; toast: string; kind?: "ok" | "error" },
    options: { keepsSort?: boolean } = {},
  ) {
    if (busy) return;
    flushPending();
    if (!entries.length) {
      toast("Nothing to process yet. Paste a few lines first.", "error");
      return;
    }
    const heavy = entries.length >= LOADING_THRESHOLD;
    if (heavy) {
      busy = true;
      render();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    try {
      const outcome = transform(entries);
      const { message, toast: toastMessage, kind } = describe(outcome);
      if (!options.keepsSort) direction = null;
      decorate(outcome, message);
      toast(toastMessage, kind ?? "ok");
    } catch {
      showError("That action could not be completed. Your text is unchanged.");
    } finally {
      if (heavy) {
        busy = false;
        render();
      }
    }
  }

  function showError(message: string) {
    const box = $("#sorter-error");
    box.textContent = message;
    box.hidden = false;
  }

  function hideError() {
    $("#sorter-error").hidden = true;
  }

  function plural(count: number, singular: string, pluralForm = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
  }

  function applySort(nextKey: SortKey, nextDirection: SortDirection) {
    if (!entries.length) {
      toast("Nothing to sort yet. Paste a few lines first.", "error");
      return;
    }
    sortKey = nextKey;
    direction = nextDirection;
    const outcome = sortEntries(entries, sortKey, nextDirection);
    entries = outcome.entries;
    const arrow = nextDirection === "asc" ? "A → Z" : "Z → A";
    status = `Sorted by ${SORT_LABELS[sortKey]} · ${arrow}`;
    render();
    toast(`Sorted by ${SORT_LABELS[sortKey]} (${arrow})`);
  }

  // --- source events -------------------------------------------------------
  input.addEventListener("input", () => {
    hideError();
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      syncFromInput();
    }, 120);
  });

  // --- file loading (drag & drop and file picker) --------------------------
  const drop = $("#sorter-drop");
  const fileInput = $<HTMLInputElement>("#sorter-file");
  let dragDepth = 0;

  function isTextFile(file: File) {
    return (
      file.type.startsWith("text/") ||
      /\.(txt|csv|tsv|log|json|dat|list)$/i.test(file.name)
    );
  }

  async function loadFile(file: File) {
    hideError();
    if (!isTextFile(file)) {
      showError(`“${file.name}” looks like a binary file. Card Sorter only reads plain text.`);
      toast("Only plain-text files can be loaded.", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError("That file is larger than 5 MB. Split it, or paste the part you need.");
      toast("File is too large to load (5 MB limit).", "error");
      return;
    }
    try {
      const text = await file.text();
      if (text.includes("\0")) {
        showError(`“${file.name}” looks like a binary file. Card Sorter only reads plain text.`);
        toast("Only plain-text files can be loaded.", "error");
        return;
      }
      input.value = text;
      syncFromInput();
      status = `Loaded ${file.name} · ${plural(lineCount(text), "line")}`;
      render();
      toast(`${file.name} loaded locally (${plural(lineCount(text), "line")})`);
    } catch {
      showError("That file could not be read. Paste its contents instead.");
      toast("File could not be read.", "error");
    }
  }

  $<HTMLButtonElement>("#sorter-load").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void loadFile(file);
  });
  drop.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    drop.classList.add("dragging");
  });
  drop.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  drop.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove("dragging");
  });
  drop.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dragDepth = 0;
    drop.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  });
  window.addEventListener("dragend", () => {
    dragDepth = 0;
    drop.classList.remove("dragging");
  });

  // --- cleaning actions ----------------------------------------------------
  $<HTMLButtonElement>("#sorter-clean-all").addEventListener("click", () =>
    run(cleanAll, (outcome) => {
      const removed = outcome.duplicatesRemoved + outcome.emptyLinesRemoved;
      return {
        message: `Cleaned: ${plural(outcome.emptyLinesRemoved, "empty line")} and ${plural(outcome.duplicatesRemoved, "duplicate record")} removed.`,
        toast: removed
          ? `Cleaned ${plural(removed, "line")} — everything else kept`
          : outcome.changed
            ? `Already clean — ${plural(outcome.changed, "line")} normalized`
            : "Already clean — nothing to change",
      };
    }),
  );
  $<HTMLButtonElement>("#sorter-dedupe").addEventListener("click", () =>
    run(removeDuplicateLines, (outcome) => ({
      message: outcome.removed
        ? `${plural(outcome.removed, "duplicate line")} removed.`
        : "No duplicate lines found.",
      toast: outcome.removed
        ? `${plural(outcome.removed, "duplicate line")} removed`
        : "No duplicate lines found",
    })),
  );
  $<HTMLButtonElement>("#sorter-empty").addEventListener("click", () =>
    run(removeEmptyLines, (outcome) => ({
      message: outcome.removed
        ? `${plural(outcome.removed, "empty line")} removed.`
        : "No empty lines found.",
      toast: outcome.removed
        ? `${plural(outcome.removed, "empty line")} removed`
        : "No empty lines found",
    })),
  );
  $<HTMLButtonElement>("#sorter-records").addEventListener("click", () =>
    run(removeDuplicateRecords, (outcome) => ({
      message: outcome.removed
        ? `${plural(outcome.removed, "duplicate record")} removed (same number, expiry and CVV).`
        : "Every record is distinct.",
      toast: outcome.removed
        ? `${plural(outcome.removed, "duplicate record")} removed`
        : "No duplicate records found",
    })),
  );
  $<HTMLButtonElement>("#sorter-invalid").addEventListener("click", () =>
    run(removeInvalidLines, (outcome) => ({
      message: outcome.removed
        ? `${plural(outcome.removed, "invalid or empty line")} removed.`
        : "Nothing invalid or empty to remove.",
      toast: outcome.removed
        ? `${plural(outcome.removed, "invalid or empty line")} removed`
        : "Nothing invalid or empty to remove",
    })),
  );
  $<HTMLButtonElement>("#sorter-trim").addEventListener("click", () =>
    run(trimWhitespace, (outcome) => ({
      message: outcome.changed
        ? `${plural(outcome.changed, "line")} trimmed.`
        : "No surrounding whitespace to trim.",
      toast: outcome.changed
        ? `${plural(outcome.changed, "line")} trimmed`
        : "No whitespace to trim",
    })),
  );
  $<HTMLButtonElement>("#sorter-normalize").addEventListener("click", () =>
    run(normalizeSeparators, (outcome) => ({
      message: outcome.changed
        ? `${plural(outcome.changed, "record")} rewritten to number|MM/YY|cvv.`
        : "Separators already canonical.",
      toast: outcome.changed
        ? `${plural(outcome.changed, "record")} normalized to number|MM/YY|cvv`
        : "Separators already canonical",
    })),
  );
  $<HTMLButtonElement>("#sorter-reverse").addEventListener("click", () =>
    run(
      reverseEntries,
      () => ({ message: "Order reversed.", toast: "Order reversed" }),
      { keepsSort: true },
    ),
  );
  $<HTMLButtonElement>("#sorter-original").addEventListener("click", () =>
    run(
      originalOrder,
      () => ({
        message: "Original paste order restored.",
        toast: "Original paste order restored",
      }),
      { keepsSort: true },
    ),
  );
  $<HTMLButtonElement>("#sorter-sort-asc").addEventListener("click", () =>
    applySort(sortKey, "asc"),
  );
  $<HTMLButtonElement>("#sorter-sort-desc").addEventListener("click", () =>
    applySort(sortKey, "desc"),
  );
  sortKeySelect.addEventListener("change", () => {
    const next = sortKeySelect.value as SortKey;
    if (direction) applySort(next, direction);
    else {
      sortKey = next;
      render();
    }
  });

  // --- result actions ------------------------------------------------------
  $<HTMLButtonElement>("#sorter-select-all").addEventListener("click", () => {
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
  });
  $<HTMLButtonElement>("#sorter-copy-all").addEventListener("click", () => {
    if (!entries.length) return;
    void copy(outputText(entries), `${plural(entries.length, "line")} copied`);
  });
  $<HTMLButtonElement>("#sorter-download").addEventListener("click", () => {
    if (!entries.length) return;
    const file = sorterExport(entries);
    try {
      const url = URL.createObjectURL(
        new Blob([file.content], { type: `${file.mime};charset=utf-8` }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${file.filename} downloaded`);
    } catch {
      showError("Download unavailable in this browser. Use Copy all instead.");
      toast("Download unavailable. Use Copy all instead.", "error");
    }
  });
  $<HTMLButtonElement>("#sorter-clear").addEventListener("click", () => {
    flushPending();
    input.value = "";
    source = "";
    sourceLines = [];
    entries = [];
    direction = null;
    status = "";
    hideError();
    render();
    toast("Card Sorter cleared — paste and result are both empty");
  });

  // --- keyboard shortcuts --------------------------------------------------
  function shortcut(event: KeyboardEvent): (() => void) | null {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return null;
    if (!event.shiftKey && (event.key === "Enter" || event.code === "NumpadEnter"))
      return () => void $<HTMLButtonElement>("#sorter-clean-all").click();
    if (!event.shiftKey) return null;
    if (event.code === "Digit1") return () => applySort(sortKey, "asc");
    if (event.code === "Digit2") return () => applySort(sortKey, "desc");
    if (event.code === "Digit3")
      return () => $<HTMLButtonElement>("#sorter-reverse").click();
    if (event.code === "Digit4")
      return () => $<HTMLButtonElement>("#sorter-original").click();
    const key = event.key.toLowerCase();
    const map: Record<string, string> = {
      u: "sorter-dedupe",
      e: "sorter-empty",
      l: "sorter-trim",
      k: "sorter-normalize",
      r: "sorter-records",
      x: "sorter-copy-all",
    };
    const id = map[key];
    return id ? () => $<HTMLButtonElement>(`#${id}`).click() : null;
  }

  document.addEventListener("keydown", (event) => {
    if (!isActive() || busy) return;
    const action = shortcut(event);
    if (!action) return;
    event.preventDefault();
    action();
  });

  syncFromInput();
  return { focusInput: () => input.focus() };
}
