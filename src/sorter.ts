/**
 * Card Sorter — local test-data/text organizer.
 *
 * Pure, dependency-free text processing. Nothing in this module performs a
 * network request, verifies a card, or contacts any payment service. It only
 * cleans, deduplicates and sorts text the developer pasted or dropped in.
 */
import { compatibleNetworks, NETWORKS, type Network } from "./generator";

export type SortKey = "line" | "number" | "network" | "expiry";
export type SortDirection = "asc" | "desc";

/** One line of the working set. `source` keeps the original paste order. */
export interface SorterEntry {
  text: string;
  source: number;
  seq: number;
}

export interface RecognizedRecord {
  recognized: true;
  /** Original text of the line. */
  raw: string;
  /** Number with spaces/hyphens removed. */
  number: string;
  /** Two digit month, "01"–"12". */
  month: string;
  /** Year exactly as supplied: two or four digits. */
  year: string;
  /** Empty when the line carried no CVV. */
  cvv: string;
  /** Locally detected from the number's prefix, or null when unknown. */
  network: Network | null;
  /** Canonical pipe form: `number|MM/YY|cvv`. */
  canonical: string;
}

export interface UnrecognizedLine {
  recognized: false;
  raw: string;
}

export type LineAnalysis = RecognizedRecord | UnrecognizedLine;

export interface TransformOutcome {
  entries: SorterEntry[];
  /** Lines dropped by the transform. */
  removed: number;
  /** Lines whose text was rewritten by the transform. */
  changed: number;
}

export interface SorterStats {
  inputLines: number;
  uniqueLines: number;
  duplicatesRemoved: number;
  emptyLinesRemoved: number;
  remainingLines: number;
  recognized: number;
  unrecognized: number;
}

const NUMERIC_NUMBER = /^\d{12,19}$/;
const FIELD_SPLIT = /[|,;:\t]+|\s{2,}/;
const MONTH_ONLY = /^\d{1,2}$/;
const YEAR_ONLY = /^\d{2}$|^\d{4}$/;
const EXPIRY = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/;
const CVV = /^\d{3,4}$/;

const MAX_PREFIX_CACHE = 4096;
const prefixNetworkCache = new Map<string, Network | null>();
const MAX_ANALYSIS_CACHE = 30_000;
const lineAnalysisCache = new Map<string, LineAnalysis>();

/** Split pasted text into lines, tolerating CRLF/CR and a final newline. */
export function splitLines(text: string): string[] {
  if (typeof text !== "string" || !text) return [];
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = cleaned.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Whitespace-insensitive identity of a raw line, used for line duplicates. */
export function lineIdentity(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/\u200B/g, "").trim();
}

function compactNumber(value: string): string {
  return value.replace(/[\s\u200B-]/g, "");
}

function padMonth(value: string): string | null {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return String(month).padStart(2, "0");
}

function twoDigitYear(year: string): string {
  return year.length === 4 ? year.slice(-2) : year;
}

/** Expand a two digit card-expiry year to the current century for sorting. */
function centuryYear(year: string): number {
  if (year.length === 4) return Number(year);
  return 2000 + Number(year);
}

export function detectNetwork(number: string): Network | null {
  if (typeof number !== "string") return null;
  const digits = compactNumber(number);
  if (!NUMERIC_NUMBER.test(digits)) return null;
  const prefix = digits.slice(0, 6);
  const cached = prefixNetworkCache.get(prefix);
  if (cached !== undefined) return cached;
  const detected = compatibleNetworks(prefix)[0] ?? null;
  if (prefixNetworkCache.size >= MAX_PREFIX_CACHE) prefixNetworkCache.clear();
  prefixNetworkCache.set(prefix, detected);
  return detected;
}

function record(
  number: string,
  month: string,
  year: string,
  cvv: string,
  raw: string,
): RecognizedRecord {
  return {
    recognized: true,
    raw,
    number,
    month,
    year,
    cvv,
    network: detectNetwork(number),
    canonical: month
      ? `${number}|${month}/${twoDigitYear(year)}${cvv ? `|${cvv}` : ""}`
      : number,
  };
}

/**
 * Parse one line as a development/test card record. Supported shapes:
 * `number|MM|YYYY|CVV`, `number|MM/YY|CVV`, `number,MM,YYYY,CVV`,
 * `number:MM:YYYY:CVV`, tab/semicolon or double-space variants, and a bare
 * number on its own line. Anything else is returned as unrecognized so it can
 * be preserved instead of silently deleted.
 */
function parseExpiryField(value: string): { month: string; year: string } | null {
  const match = EXPIRY.exec(value);
  if (!match) return null;
  const month = padMonth(match[1]);
  return month ? { month, year: match[2] } : null;
}

export function analyzeLine(line: string): LineAnalysis {
  const raw = typeof line === "string" ? line : String(line ?? "");
  const cached = lineAnalysisCache.get(raw);
  if (cached !== undefined) return cached;
  const result = computeLineAnalysis(raw);
  if (lineAnalysisCache.size >= MAX_ANALYSIS_CACHE) lineAnalysisCache.clear();
  lineAnalysisCache.set(raw, result);
  return result;
}

function computeLineAnalysis(raw: string): LineAnalysis {
  const fields = raw
    .replace(/\u200B/g, "")
    .split(FIELD_SPLIT)
    .map((field) => field.trim());
  while (fields.length > 1 && fields[fields.length - 1] === "") fields.pop();
  if (!fields.length || fields.every((field) => field === "")) {
    return { recognized: false, raw };
  }
  const number = compactNumber(fields[0]);
  if (!NUMERIC_NUMBER.test(number)) return { recognized: false, raw };
  const rest = fields.slice(1);
  if (!rest.length) return record(number, "", "", "", raw);
  if (rest.length === 1) {
    const expiry = parseExpiryField(rest[0]);
    return expiry
      ? record(number, expiry.month, expiry.year, "", raw)
      : { recognized: false, raw };
  }
  const cvv = rest[rest.length - 1];
  const cvvAccepted = cvv === "" || CVV.test(cvv);
  if (rest.length === 2) {
    const expiry = parseExpiryField(rest[0]);
    if (expiry && cvvAccepted)
      return record(number, expiry.month, expiry.year, cvv, raw);
    const month = MONTH_ONLY.test(rest[0]) ? padMonth(rest[0]) : null;
    if (month && YEAR_ONLY.test(rest[1]))
      return record(number, month, rest[1], "", raw);
    return { recognized: false, raw };
  }
  if (rest.length === 3) {
    const month = MONTH_ONLY.test(rest[0]) ? padMonth(rest[0]) : null;
    if (!month || !YEAR_ONLY.test(rest[1]) || !cvvAccepted)
      return { recognized: false, raw };
    return record(number, month, rest[1], cvv, raw);
  }
  return { recognized: false, raw };
}

/** Identity used by "Remove exact duplicate records". */
export function recordIdentity(analysis: LineAnalysis, text: string): string {
  return analysis.recognized
    ? `record:${analysis.canonical}`
    : `text:${lineIdentity(text)}`;
}

export function toEntries(lines: string[]): SorterEntry[] {
  return lines.map((text, index) => ({ text, source: index, seq: index }));
}

/** Canonical one-record-per-line output. */
export function outputText(entries: SorterEntry[]): string {
  return entries.map((entry) => entry.text).join("\n");
}

export function sorterStats(
  sourceLines: string[],
  entries: SorterEntry[],
): SorterStats {
  const identities = new Set<string>();
  let emptyLinesRemoved = 0;
  for (const line of sourceLines) {
    if (line.trim() === "") emptyLinesRemoved++;
    else identities.add(lineIdentity(line));
  }
  const uniqueLines = identities.size;
  let recognized = 0;
  for (const entry of entries) if (analyzeLine(entry.text).recognized) recognized++;
  return {
    inputLines: sourceLines.length,
    uniqueLines,
    duplicatesRemoved: Math.max(0, sourceLines.length - emptyLinesRemoved - uniqueLines),
    emptyLinesRemoved,
    remainingLines: entries.length,
    recognized,
    unrecognized: entries.length - recognized,
  };
}

export function trimWhitespace(entries: SorterEntry[]): TransformOutcome {
  let changed = 0;
  const result = entries.map((entry) => {
    const text = entry.text.replace(/\u200B/g, "").trim();
    if (text !== entry.text) changed++;
    return { ...entry, text };
  });
  return { entries: result, removed: 0, changed };
}

export function removeEmptyLines(entries: SorterEntry[]): TransformOutcome {
  const result = entries.filter((entry) => entry.text.trim() !== "");
  return { entries: result, removed: entries.length - result.length, changed: 0 };
}

function dedupe(
  entries: SorterEntry[],
  identity: (entry: SorterEntry) => string,
): TransformOutcome {
  const seen = new Set<string>();
  const result: SorterEntry[] = [];
  for (const entry of entries) {
    const key = identity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return { entries: result, removed: entries.length - result.length, changed: 0 };
}

/** Drops lines that repeat the same text (surrounding whitespace ignored). */
export function removeDuplicateLines(entries: SorterEntry[]): TransformOutcome {
  return dedupe(entries, (entry) => lineIdentity(entry.text));
}

/** Drops lines that repeat the same record, whatever format it was pasted in. */
export function removeDuplicateRecords(entries: SorterEntry[]): TransformOutcome {
  return dedupe(entries, (entry) => recordIdentity(analyzeLine(entry.text), entry.text));
}

/**
 * Rewrites recognized records to ORIGEN's canonical `number|MM/YY|cvv` pipe
 * form. Unrecognized lines are left exactly as they were pasted.
 */
export function normalizeSeparators(entries: SorterEntry[]): TransformOutcome {
  let changed = 0;
  const result = entries.map((entry) => {
    const analysis = analyzeLine(entry.text);
    if (!analysis.recognized) return entry;
    if (analysis.canonical === entry.text) return entry;
    changed++;
    return { ...entry, text: analysis.canonical };
  });
  return { entries: result, removed: 0, changed };
}

/** Explicit action only: drops blank and unrecognized lines. */
export function removeInvalidLines(entries: SorterEntry[]): TransformOutcome {
  const result = entries.filter((entry) => {
    if (entry.text.trim() === "") return false;
    return analyzeLine(entry.text).recognized;
  });
  return { entries: result, removed: entries.length - result.length, changed: 0 };
}

interface SortValue {
  has: boolean;
  key: string | number | bigint;
}

function sortValue(entry: SorterEntry, key: SortKey): SortValue {
  const analysis = analyzeLine(entry.text);
  if (key === "line") return { has: true, key: entry.text.toLowerCase() };
  if (!analysis.recognized) return { has: false, key: "" };
  if (key === "number" && analysis.number)
    return { has: true, key: BigInt(analysis.number) };
  if (key === "network" && analysis.network)
    return { has: true, key: NETWORKS.indexOf(analysis.network) };
  if (key === "expiry" && analysis.month)
    return { has: true, key: centuryYear(analysis.year) * 100 + Number(analysis.month) };
  return { has: false, key: "" };
}

function compareValues(a: string | number | bigint, b: string | number | bigint): number {
  if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Stable sort by line, number prefix, locally detected network or expiry.
 * Lines without a value for the chosen key stay at the end, untouched in
 * relative order, so nothing is ever dropped by sorting.
 */
export function sortEntries(
  entries: SorterEntry[],
  key: SortKey,
  direction: SortDirection = "asc",
): TransformOutcome {
  const directionFactor = direction === "asc" ? 1 : -1;
  const indexed = entries.map((entry, index) => ({
    entry,
    index,
    value: sortValue(entry, key),
  }));
  indexed.sort((a, b) => {
    if (a.value.has !== b.value.has) return a.value.has ? -1 : 1;
    if (a.value.has && b.value.has) {
      const comparison = compareValues(a.value.key, b.value.key);
      if (comparison !== 0) return comparison * directionFactor;
    }
    return a.index - b.index;
  });
  return { entries: indexed.map((item) => item.entry), removed: 0, changed: 0 };
}

export function reverseEntries(entries: SorterEntry[]): TransformOutcome {
  return { entries: [...entries].reverse(), removed: 0, changed: 0 };
}

/** Restores the paste order of the current lines without reviving removed ones. */
export function originalOrder(entries: SorterEntry[]): TransformOutcome {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) =>
    a.entry.source === b.entry.source
      ? a.index - b.index
      : a.entry.source - b.entry.source,
  );
  return { entries: indexed.map((item) => item.entry), removed: 0, changed: 0 };
}

export interface CleanAllOutcome extends TransformOutcome {
  duplicatesRemoved: number;
  emptyLinesRemoved: number;
}

/** One-click pipeline: trim, drop blanks, normalize, dedupe, restore order. */
export function cleanAll(entries: SorterEntry[]): CleanAllOutcome {
  const trimmed = trimWhitespace(entries);
  const nonEmpty = removeEmptyLines(trimmed.entries);
  const normalized = normalizeSeparators(nonEmpty.entries);
  const deduped = removeDuplicateRecords(normalized.entries);
  const ordered = originalOrder(deduped.entries);
  return {
    entries: ordered.entries,
    removed: nonEmpty.removed + deduped.removed,
    // Lines that survived and read differently than the line that was pasted.
    changed: ordered.entries.filter(
      (entry) => entry.text !== entries[entry.source]?.text,
    ).length,
    duplicatesRemoved: deduped.removed,
    emptyLinesRemoved: nonEmpty.removed,
  };
}

export function sorterFilename(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `origen-card-sorter-${stamp}.txt`;
}

/** Plain-text download payload: one record per line, no header. */
export function sorterExport(
  entries: SorterEntry[],
  now = new Date(),
): { filename: string; mime: string; content: string } {
  return {
    filename: sorterFilename(now),
    mime: "text/plain",
    content: entries.map((entry) => entry.text).join("\n"),
  };
}
