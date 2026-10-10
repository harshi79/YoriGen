/**
 * Card Sorter working state for the mobile screen.
 *
 * A thin, DOM-free coordinator over the existing, tested transforms in
 * src/sorter.ts. It mirrors the web panel's behaviour: unrecognized lines are
 * preserved unless the explicit "remove invalid" action runs, sorting is
 * stable, and every action reports exactly what it changed.
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
  type SorterEntry,
  type SorterStats,
  type SortKey,
  type TransformOutcome,
} from "../../sorter";

export type SorterActionId =
  | "clean-all"
  | "dedupe-lines"
  | "dedupe-records"
  | "remove-empty"
  | "trim"
  | "normalize"
  | "remove-invalid"
  | "reverse"
  | "original-order";

export interface SorterActionInfo {
  id: SorterActionId;
  label: string;
  description: string;
  /** Actions that only reorder lines keep the current sort indicator. */
  keepsSort?: boolean;
  /** Actions that can drop lines the user may still want. */
  destructive?: boolean;
}

export const SORTER_ACTIONS: readonly SorterActionInfo[] = [
  { id: "clean-all", label: "Clean all", description: "Trim, drop empty lines, normalize and remove duplicate records." },
  { id: "dedupe-lines", label: "Remove duplicates", description: "Drop lines that repeat the same text." },
  { id: "dedupe-records", label: "Duplicate records", description: "Drop repeated records, whatever format they use." },
  { id: "remove-empty", label: "Empty lines", description: "Drop blank lines." },
  { id: "trim", label: "Trim whitespace", description: "Remove surrounding spaces from each line." },
  { id: "normalize", label: "Normalize", description: "Rewrite records as number|MM/YY|cvv." },
  { id: "remove-invalid", label: "Remove invalid", description: "Drop empty and unrecognized lines.", destructive: true },
  { id: "reverse", label: "Reverse", description: "Reverse the current order.", keepsSort: true },
  { id: "original-order", label: "Original order", description: "Restore the paste order.", keepsSort: true },
];

export const SORT_LABELS: Record<SortKey, string> = {
  line: "full line",
  number: "first field / number prefix",
  network: "locally detected network",
  expiry: "parsed expiry",
};

export interface ActionResult {
  ok: boolean;
  /** Persistent status line shown with the result. */
  message: string;
  /** Short confirmation for a toast. */
  toast: string;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

type Transform = (entries: SorterEntry[]) => TransformOutcome;

const TRANSFORMS: Record<SorterActionId, Transform> = {
  "clean-all": cleanAll,
  "dedupe-lines": removeDuplicateLines,
  "dedupe-records": removeDuplicateRecords,
  "remove-empty": removeEmptyLines,
  trim: trimWhitespace,
  normalize: normalizeSeparators,
  "remove-invalid": removeInvalidLines,
  reverse: reverseEntries,
  "original-order": originalOrder,
};

function describe(id: SorterActionId, outcome: TransformOutcome): Omit<ActionResult, "ok"> {
  switch (id) {
    case "clean-all": {
      const { duplicatesRemoved, emptyLinesRemoved } = outcome as ReturnType<typeof cleanAll>;
      const removed = duplicatesRemoved + emptyLinesRemoved;
      return {
        message: `Cleaned: ${plural(emptyLinesRemoved, "empty line")} and ${plural(duplicatesRemoved, "duplicate record")} removed.`,
        toast: removed
          ? `Cleaned ${plural(removed, "line")} — everything else kept`
          : outcome.changed
            ? `Already clean — ${plural(outcome.changed, "line")} normalized`
            : "Already clean — nothing to change",
      };
    }
    case "dedupe-lines":
      return outcome.removed
        ? { message: `${plural(outcome.removed, "duplicate line")} removed.`, toast: `${plural(outcome.removed, "duplicate line")} removed` }
        : { message: "No duplicate lines found.", toast: "No duplicate lines found" };
    case "dedupe-records":
      return outcome.removed
        ? { message: `${plural(outcome.removed, "duplicate record")} removed (same number, expiry and CVV).`, toast: `${plural(outcome.removed, "duplicate record")} removed` }
        : { message: "Every record is distinct.", toast: "No duplicate records found" };
    case "remove-empty":
      return outcome.removed
        ? { message: `${plural(outcome.removed, "empty line")} removed.`, toast: `${plural(outcome.removed, "empty line")} removed` }
        : { message: "No empty lines found.", toast: "No empty lines found" };
    case "trim":
      return outcome.changed
        ? { message: `${plural(outcome.changed, "line")} trimmed.`, toast: `${plural(outcome.changed, "line")} trimmed` }
        : { message: "No surrounding whitespace to trim.", toast: "No whitespace to trim" };
    case "normalize":
      return outcome.changed
        ? { message: `${plural(outcome.changed, "record")} rewritten to number|MM/YY|cvv.`, toast: `${plural(outcome.changed, "record")} normalized` }
        : { message: "Separators already canonical.", toast: "Separators already canonical" };
    case "remove-invalid":
      return outcome.removed
        ? { message: `${plural(outcome.removed, "invalid or empty line")} removed.`, toast: `${plural(outcome.removed, "invalid or empty line")} removed` }
        : { message: "Nothing invalid or empty to remove.", toast: "Nothing invalid or empty to remove" };
    case "reverse":
      return { message: "Order reversed.", toast: "Order reversed" };
    case "original-order":
      return { message: "Original paste order restored.", toast: "Original paste order restored" };
  }
}

export class SorterSession {
  private sourceText = "";
  private sourceLines: string[] = [];
  private current: SorterEntry[] = [];
  private key: SortKey = "line";
  private sortDirection: SortDirection | null = null;
  private statusText = "";

  get source(): string {
    return this.sourceText;
  }
  get entries(): readonly SorterEntry[] {
    return this.current;
  }
  get sortKey(): SortKey {
    return this.key;
  }
  get direction(): SortDirection | null {
    return this.sortDirection;
  }
  get stats(): SorterStats {
    return sorterStats(this.sourceLines, this.current);
  }
  get output(): string {
    return outputText(this.current);
  }
  get hasInput(): boolean {
    return this.sourceLines.length > 0;
  }
  /** Status line: the last action's message, or a description of the result. */
  get status(): string {
    if (this.statusText) return this.statusText;
    if (!this.sourceLines.length) return "Waiting for input.";
    const stats = this.stats;
    return stats.inputLines === stats.remainingLines
      ? "Mirrors your paste."
      : "Cleaned result differs from your paste.";
  }

  /** Replaces the source text. Resets the result to mirror the new paste. */
  setSource(text: string): void {
    this.sourceText = text;
    this.sourceLines = splitLines(text);
    this.current = toEntries(this.sourceLines);
    this.sortDirection = null;
    this.statusText = "";
  }

  setSortKey(key: SortKey): void {
    this.key = key;
  }

  apply(id: SorterActionId): ActionResult {
    if (!this.current.length)
      return { ok: false, message: this.status, toast: "Nothing to process yet. Paste a few lines first." };
    const info = SORTER_ACTIONS.find((action) => action.id === id);
    const outcome = TRANSFORMS[id](this.current);
    const result = describe(id, outcome);
    if (!info?.keepsSort) this.sortDirection = null;
    this.current = outcome.entries;
    this.statusText = result.message;
    return { ok: true, ...result };
  }

  sort(key: SortKey, direction: SortDirection): ActionResult {
    if (!this.current.length)
      return { ok: false, message: this.status, toast: "Nothing to sort yet. Paste a few lines first." };
    this.key = key;
    this.sortDirection = direction;
    this.current = sortEntries(this.current, key, direction).entries;
    const arrow = direction === "asc" ? "A → Z" : "Z → A";
    this.statusText = `Sorted by ${SORT_LABELS[key]} · ${arrow}`;
    return { ok: true, message: this.statusText, toast: `Sorted by ${SORT_LABELS[key]} (${arrow})` };
  }

  exportFile(now = new Date()) {
    return sorterExport(this.current, now);
  }

  clear(): void {
    this.setSource("");
  }
}
