import { describe, expect, it } from "vitest";
import {
  analyzeLine,
  cleanAll,
  detectNetwork,
  lineIdentity,
  normalizeSeparators,
  originalOrder,
  outputText,
  recordIdentity,
  removeDuplicateLines,
  removeDuplicateRecords,
  removeEmptyLines,
  removeInvalidLines,
  reverseEntries,
  sortEntries,
  sorterExport,
  sorterFilename,
  sorterStats,
  splitLines,
  toEntries,
  trimWhitespace,
  type SorterEntry,
} from "./sorter";

const entries = (...lines: string[]): SorterEntry[] => toEntries(lines);
const texts = (list: SorterEntry[]) => list.map((entry) => entry.text);

describe("line splitting", () => {
  it("handles LF, CRLF, CR and a trailing newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("a\rb")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(splitLines("")).toEqual([]);
  });
  it("strips a leading byte-order mark without touching the lines", () => {
    expect(splitLines("\uFEFF4242424242424242|01|29|123")).toEqual([
      "4242424242424242|01|29|123",
    ]);
  });
});

describe("record recognition", () => {
  it.each([
    ["4242424242424242|01|2029|123", "4242424242424242", "01", "2029", "123"],
    ["4242424242424242|01/29|123", "4242424242424242", "01", "29", "123"],
    ["4242424242424242,01,2029,123", "4242424242424242", "01", "2029", "123"],
    ["4242424242424242:01:2029:123", "4242424242424242", "01", "2029", "123"],
    ["4242424242424242;01;29;123", "4242424242424242", "01", "29", "123"],
    ["4242424242424242\t01\t29\t123", "4242424242424242", "01", "29", "123"],
    ["4242424242424242  01  29  123", "4242424242424242", "01", "29", "123"],
    ["4242424242424242 | 01/29 | 123", "4242424242424242", "01", "29", "123"],
    ["4242 4242 4242 4242|01|29|123", "4242424242424242", "01", "29", "123"],
    ["4242424242424242|01-29|123", "4242424242424242", "01", "29", "123"],
  ])("accepts %s", (line, number, month, year, cvv) => {
    const analysis = analyzeLine(line);
    expect(analysis.recognized).toBe(true);
    if (!analysis.recognized) return;
    expect(analysis).toMatchObject({ number, month, year, cvv });
  });
  it("accepts a bare number line and the generator's own output", () => {
    const bare = analyzeLine("378282246310005");
    expect(bare.recognized && bare.number).toBe("378282246310005");
    const generated = analyzeLine("4242424242424242 | 01/29 | 007");
    expect(generated.recognized && generated.canonical).toBe(
      "4242424242424242|01/29|007",
    );
  });
  it("accepts a record with a missing CVV but rejects an invalid one", () => {
    for (const line of ["4242424242424242|01|2029", "4242424242424242|01/29", "4242424242424242|01/29|"]) {
      const analysis = analyzeLine(line);
      expect(analysis.recognized).toBe(true);
      if (analysis.recognized) expect(analysis.cvv).toBe("");
    }
    expect(analyzeLine("4242424242424242|01|29|12x").recognized).toBe(false);
    expect(analyzeLine("4242424242424242|13|2029").recognized).toBe(false);
  });
  it.each([
    "",
    "   ",
    "# test batch 4 — sandbox",
    "not a card at all",
    "4242|01/29|123",
    "4242424242424242|13|29|123",
    "4242424242424242|00|29|123",
    "4242424242424242|01|29.5|123",
    "4242424242424242|01|29|123456",
    "https://example.invalid/4242424242424242",
  ])("keeps %s as an unrecognized line", (line) => {
    expect(analyzeLine(line).recognized).toBe(false);
  });
});

describe("local network detection", () => {
  it.each([
    ["4242424242424242", "Visa"],
    ["5555555555554444", "Mastercard"],
    ["2223003122003222", "Mastercard"],
    ["378282246310005", "American Express"],
    ["6011111111111117", "Discover"],
    ["6221260000000000", "Discover"],
    ["3530111234567890", "JCB"],
    ["30569309025904", "Diners Club"],
    ["6212345678901232", "UnionPay"],
    ["6759649826438453", "Maestro"],
  ] as const)("detects %s locally as %s", (number, network) => {
    expect(detectNetwork(number)).toBe(network);
  });
  it("prefers the narrower original scheme on an overlapping prefix", () => {
    // 6011 and 65 are valid RuPay ranges too; Discover keeps precedence.
    expect(detectNetwork("6011111111111117")).toBe("Discover");
    expect(detectNetwork("6500000000000002")).toBe("Discover");
    // 51–55 is also a Maestro range; Mastercard keeps precedence.
    expect(detectNetwork("5555555555554444")).toBe("Mastercard");
  });
  it("never guesses a network it cannot detect", () => {
    expect(detectNetwork("9999999999999999")).toBeNull();
    expect(detectNetwork("1234")).toBeNull();
    expect(detectNetwork("not-a-number")).toBeNull();
  });
});

describe("duplicate removal", () => {
  it("removes repeated lines and keeps the first occurrence", () => {
    const outcome = removeDuplicateLines(
      entries(
        "4242424242424242|01/29|123",
        "4242424242424242|01/29|123",
        "5555555555554444|02/30|456",
      ),
    );
    expect(texts(outcome.entries)).toEqual([
      "4242424242424242|01/29|123",
      "5555555555554444|02/30|456",
    ]);
    expect(outcome.removed).toBe(1);
  });
  it("treats lines that differ only in surrounding whitespace as duplicates", () => {
    expect(
      removeDuplicateLines(entries("  4242424242424242|01/29|123", "4242424242424242|01/29|123"))
        .removed,
    ).toBe(1);
    expect(lineIdentity(" 4242\u200B ")).toBe("4242");
  });
  it("keeps unrecognized lines in play instead of dropping them", () => {
    const outcome = removeDuplicateLines(entries("# batch", "# batch", "nope"));
    expect(texts(outcome.entries)).toEqual(["# batch", "nope"]);
    expect(outcome.removed).toBe(1);
  });
  it("collapses the same record pasted in different formats", () => {
    const outcome = removeDuplicateRecords(
      entries(
        "4242424242424242|01|2029|123",
        "4242424242424242,01,29,123",
        "4242424242424242:01:2029:123",
        "4242424242424242|01/29|124",
      ),
    );
    expect(texts(outcome.entries)).toEqual([
      "4242424242424242|01|2029|123",
      "4242424242424242|01/29|124",
    ]);
    expect(outcome.removed).toBe(2);
  });
  it("leaves genuinely different records alone", () => {
    const outcome = removeDuplicateRecords(
      entries("4242424242424242|01/29|123", "4242424242424243|01/29|123"),
    );
    expect(outcome.removed).toBe(0);
    expect(outcome.entries).toHaveLength(2);
  });
  it("deduplicates unrecognized text by exact identity", () => {
    expect(recordIdentity(analyzeLine("hello"), " hello ")).toBe(
      recordIdentity(analyzeLine("hello"), "hello"),
    );
  });
});

describe("empty-line removal", () => {
  it("drops blank and whitespace-only lines and reports the count", () => {
    const outcome = removeEmptyLines(
      entries("4242424242424242|01/29|123", "", "   ", "\t", "5555555555554444|02/30|456"),
    );
    expect(texts(outcome.entries)).toEqual([
      "4242424242424242|01/29|123",
      "5555555555554444|02/30|456",
    ]);
    expect(outcome.removed).toBe(3);
    expect(outcome.changed).toBe(0);
  });
  it("is a no-op when every line carries content", () => {
    const outcome = removeEmptyLines(entries("a", "b"));
    expect(outcome.removed).toBe(0);
    expect(texts(outcome.entries)).toEqual(["a", "b"]);
  });
});

describe("whitespace trimming", () => {
  it("trims each line and counts the lines it touched", () => {
    const outcome = trimWhitespace(entries("  4242424242424242|01/29|123  ", "\t# batch\t", "plain"));
    expect(texts(outcome.entries)).toEqual([
      "4242424242424242|01/29|123",
      "# batch",
      "plain",
    ]);
    expect(outcome.changed).toBe(2);
    expect(outcome.removed).toBe(0);
  });
  it("removes zero-width characters that survive a copy/paste", () => {
    expect(texts(trimWhitespace(entries("4242\u200B4242")).entries)).toEqual(["42424242"]);
  });
  it("keeps inner spacing so nothing inside a line is rewritten", () => {
    expect(texts(trimWhitespace(entries("  a   b  ")).entries)).toEqual(["a   b"]);
  });
});

describe("separator normalization", () => {
  it.each([
    ["4242424242424242,01,2029,123", "4242424242424242|01/29|123"],
    ["4242424242424242:01:2029:123", "4242424242424242|01/29|123"],
    ["4242424242424242;01;29;123", "4242424242424242|01/29|123"],
    ["4242 4242 4242 4242 | 01 | 29 | 123", "4242424242424242|01/29|123"],
    ["4242424242424242|1|29|123", "4242424242424242|01/29|123"],
  ])("rewrites %s to the canonical pipe form", (line, expected) => {
    expect(texts(normalizeSeparators(entries(line)).entries)).toEqual([expected]);
  });
  it("counts only the lines it actually rewrote", () => {
    const outcome = normalizeSeparators(
      entries("4242424242424242|01/29|123", "5555555555554444,02,2030,456"),
    );
    expect(outcome.changed).toBe(1);
    expect(texts(outcome.entries)[0]).toBe("4242424242424242|01/29|123");
  });
  it("never touches unrecognized lines", () => {
    const outcome = normalizeSeparators(entries("# batch: 4 records", "one, two, three"));
    expect(texts(outcome.entries)).toEqual(["# batch: 4 records", "one, two, three"]);
    expect(outcome.changed).toBe(0);
  });
});

describe("invalid-line removal is explicit and reported", () => {
  it("removes blanks and unrecognized lines together", () => {
    const outcome = removeInvalidLines(
      entries("4242424242424242|01/29|123", "", "# batch", "junk", "5555555555554444|02/30|456"),
    );
    expect(texts(outcome.entries)).toEqual([
      "4242424242424242|01/29|123",
      "5555555555554444|02/30|456",
    ]);
    expect(outcome.removed).toBe(3);
  });
  it("keeps every unrecognized line when it is not requested", () => {
    const source = entries("4242424242424242|01/29|123", "# batch", "junk", "");
    const cleaned = cleanAll(source);
    expect(texts(cleaned.entries)).toEqual(["4242424242424242|01/29|123", "# batch", "junk"]);
    expect(cleaned.emptyLinesRemoved).toBe(1);
  });
});

describe("order preservation", () => {
  it("keeps the paste order through every cleaning step", () => {
    const cleaned = cleanAll(
      entries(
        "# batch",
        "5555555555554444|02/30|456",
        "",
        "4242424242424242|01/29|123",
        "5555555555554444|02/30|456",
      ),
    );
    expect(texts(cleaned.entries)).toEqual([
      "# batch",
      "5555555555554444|02/30|456",
      "4242424242424242|01/29|123",
    ]);
    expect(cleaned.duplicatesRemoved).toBe(1);
    expect(cleaned.emptyLinesRemoved).toBe(1);
    expect(cleaned.changed).toBe(0);
  });
  it("restores the original paste order after sorting, without reviving removed lines", () => {
    const shuffled = sortEntries(entries("c", "a", "", "b"), "line", "asc");
    expect(texts(shuffled.entries)).toEqual(["", "a", "b", "c"]);
    const restored = originalOrder(shuffled.entries);
    expect(texts(restored.entries)).toEqual(["c", "a", "", "b"]);
    const deduped = removeDuplicateLines(entries("b", "a", "b"));
    expect(texts(originalOrder(sortEntries(deduped.entries, "line", "desc").entries).entries)).toEqual([
      "b",
      "a",
    ]);
  });
  it("reverse order flips the current result and leaves the source untouched", () => {
    const source = entries("a", "b", "c");
    const reversed = reverseEntries(source);
    expect(texts(reversed.entries)).toEqual(["c", "b", "a"]);
    expect(texts(source)).toEqual(["a", "b", "c"]);
  });
});

describe("sorting", () => {
  const sample = entries(
    "5555555555554444|01/30|456",
    "unrecognized footer",
    "4242424242424242|02/29|123",
    "378282246310005|01/29|1234",
    "5555555555554444|12/28|999",
  );

  it("sorts by full line A → Z and Z → A", () => {
    expect(texts(sortEntries(sample, "line", "asc").entries)).toEqual([
      "378282246310005|01/29|1234",
      "4242424242424242|02/29|123",
      "5555555555554444|01/30|456",
      "5555555555554444|12/28|999",
      "unrecognized footer",
    ]);
    expect(texts(sortEntries(sample, "line", "desc").entries).at(-1)).toBe(
      "378282246310005|01/29|1234",
    );
  });
  it("sorts by number prefix numerically, not alphabetically", () => {
    const sorted = sortEntries(
      entries("5555555555554444|01/30|456", "4242424242424242|02/29|123", "378282246310005|01/29|1234"),
      "number",
      "asc",
    );
    expect(texts(sorted.entries)).toEqual([
      "378282246310005|01/29|1234",
      "4242424242424242|02/29|123",
      "5555555555554444|01/30|456",
    ]);
  });
  it("sorts by locally detected network then puts undetectable lines last", () => {
    const sorted = sortEntries(
      entries(
        "6011111111111117|01/30|456",
        "378282246310005|01/29|1234",
        "9999999999999999|01/30|456",
        "4242424242424242|02/29|123",
        "5555555555554444|12/28|999",
      ),
      "network",
      "asc",
    );
    expect(texts(sorted.entries)).toEqual([
      "4242424242424242|02/29|123",
      "5555555555554444|12/28|999",
      "378282246310005|01/29|1234",
      "6011111111111117|01/30|456",
      "9999999999999999|01/30|456",
    ]);
  });
  it("sorts by parsed expiry chronologically and keeps unparseable lines last", () => {
    const sorted = sortEntries(sample, "expiry", "asc");
    expect(texts(sorted.entries)).toEqual([
      "5555555555554444|12/28|999",
      "378282246310005|01/29|1234",
      "4242424242424242|02/29|123",
      "5555555555554444|01/30|456",
      "unrecognized footer",
    ]);
    expect(texts(sortEntries(sample, "expiry", "desc").entries)[0]).toBe(
      "5555555555554444|01/30|456",
    );
  });
  it("never drops or duplicates a line while sorting, and stays stable on ties", () => {
    const sorted = sortEntries(
      entries("b one", "a two", "b three", "a four", "# note"),
      "line",
      "asc",
    );
    expect(texts(sorted.entries)).toEqual(["# note", "a four", "a two", "b one", "b three"]);
    expect(sorted.entries).toHaveLength(5);
    expect(sorted.removed).toBe(0);
  });
});

describe("live statistics", () => {
  it("reports input, unique, duplicate, empty and remaining counts", () => {
    const sourceLines = ["a", "a", "", "b", "   ", "c"];
    const stats = sorterStats(sourceLines, toEntries(sourceLines));
    expect(stats).toMatchObject({
      inputLines: 6,
      uniqueLines: 3,
      duplicatesRemoved: 1,
      emptyLinesRemoved: 2,
      remainingLines: 6,
    });
  });
  it("counts how many result lines are recognized records or kept unknowns", () => {
    const lines = ["4242424242424242|01/29|123", "# batch", "5555555555554444|02/30|456"];
    const stats = sorterStats(lines, toEntries(lines));
    expect(stats.recognized).toBe(2);
    expect(stats.unrecognized).toBe(1);
  });
  it("tracks the before/after gap as the developer cleans", () => {
    const lines = ["a", "a", "", "b"];
    const cleaned = cleanAll(toEntries(lines));
    const stats = sorterStats(lines, cleaned.entries);
    expect(stats.inputLines).toBe(4);
    expect(stats.remainingLines).toBe(2);
  });
});

describe("output and export", () => {
  it("writes one record per line with no header", () => {
    const payload = sorterExport(
      entries("4242424242424242|01/29|123", "5555555555554444|02/30|456"),
      new Date(2026, 8, 29),
    );
    expect(payload.filename).toBe("origen-card-sorter-2026-09-29.txt");
    expect(payload.mime).toBe("text/plain");
    expect(payload.content).toBe(
      "4242424242424242|01/29|123\n5555555555554444|02/30|456",
    );
    expect(payload.content.split("\n")).toHaveLength(2);
  });
  it("downloads an empty result without inventing records", () => {
    expect(sorterExport([], new Date(2026, 0, 2)).content).toBe("");
    expect(sorterFilename(new Date(2026, 0, 2))).toBe("origen-card-sorter-2026-01-02.txt");
  });
  it("output text mirrors the working set exactly", () => {
    expect(outputText(entries("a", "b"))).toBe("a\nb");
    expect(outputText([])).toBe("");
  });
});

describe("large pastes stay correct and fast", () => {
  const uniqueRecord = (index: number) => {
    const rows = index % 3;
    const base = rows === 0 ? "4242" : rows === 1 ? "5555" : "378282";
    const length = rows === 2 ? 15 : 16;
    const number = base + String(index).padStart(length - base.length, "0");
    const month = String((index % 12) + 1).padStart(2, "0");
    const year = 26 + (index % 5);
    const cvv = String(index % 1000).padStart(3, "0");
    return `${number},${month},20${year},${cvv}`;
  };
  const records = Array.from({ length: 20_000 }, (_, index) =>
    index % 40 === 0 ? `# batch marker ${index}` : uniqueRecord(index),
  );
  const source = [...records, ...records.slice(0, 500), "", "   "];

  it("cleans 20k+ lines without losing a line or hanging", () => {
    const start = performance.now();
    const cleaned = cleanAll(toEntries(source));
    const duration = performance.now() - start;
    expect(source.length).toBe(20_502);
    expect(cleaned.entries).toHaveLength(20_000);
    expect(cleaned.duplicatesRemoved).toBe(500);
    expect(cleaned.emptyLinesRemoved).toBe(2);
    expect(cleaned.changed).toBe(19_500);
    expect(duration).toBeLessThan(4000);
  });
  it("sorts and reports on a large set in one pass", () => {
    const cleaned = cleanAll(toEntries(source));
    const sorted = sortEntries(cleaned.entries, "expiry", "asc");
    const stats = sorterStats(source, sorted.entries);
    expect(sorted.entries).toHaveLength(20_000);
    expect(stats.inputLines).toBe(20_502);
    expect(stats.remainingLines).toBe(20_000);
    expect(stats.unrecognized).toBe(500);
    expect(stats.duplicatesRemoved).toBe(500);
    expect(outputText(sorted.entries).split("\n")).toHaveLength(20_000);
    expect(analyzeLine(sorted.entries[0].text).recognized).toBe(true);
    expect(texts(originalOrder(sorted.entries).entries)[0]).toBe(records[0]);
  });
  it("handles unexpected non-string inputs defensively without throwing", () => {
    expect(splitLines(null as unknown as string)).toEqual([]);
    expect(lineIdentity(undefined as unknown as string)).toBe("");
    expect(detectNetwork(null as unknown as string)).toBeNull();
    expect(analyzeLine(null as unknown as string)).toEqual({
      recognized: false,
      raw: "",
    });
  });
});
