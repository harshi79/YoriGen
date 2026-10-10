import { describe, expect, it } from "vitest";
import { SORTER_ACTIONS, SorterSession } from "./sorter-session";

const SAMPLE = [
  "4111111111111111|12|2030|123",
  "  4111111111111111|12|2030|123  ",
  "",
  "5555555555554444,01,2029,999",
  "not a record",
].join("\n");

describe("SorterSession", () => {
  it("mirrors the paste until an action runs", () => {
    const session = new SorterSession();
    expect(session.status).toBe("Waiting for input.");
    expect(session.hasInput).toBe(false);
    session.setSource(SAMPLE);
    expect(session.hasInput).toBe(true);
    expect(session.source).toBe(SAMPLE);
    expect(session.status).toBe("Mirrors your paste.");
    expect(session.stats.inputLines).toBe(5);
    expect(session.output).toBe(SAMPLE);
  });

  it("refuses to act on empty input with a helpful toast", () => {
    const session = new SorterSession();
    expect(session.apply("clean-all")).toMatchObject({ ok: false, toast: expect.stringMatching(/Paste/) });
    expect(session.sort("line", "asc")).toMatchObject({ ok: false, toast: expect.stringMatching(/Paste/) });
  });

  it("clean all keeps unrecognized lines and says what it removed", () => {
    const session = new SorterSession();
    session.setSource(SAMPLE);
    const result = session.apply("clean-all");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Cleaned: 1 empty line and 1 duplicate record removed.");
    expect(result.toast).toBe("Cleaned 2 lines — everything else kept");
    expect(session.output).toContain("not a record");
    expect(session.status).toBe(result.message);
  });

  it("reports when everything is already clean", () => {
    const session = new SorterSession();
    session.setSource("4111111111111111|12/30|123");
    expect(session.apply("clean-all").toast).toBe("Already clean — nothing to change");
    session.setSource("4111111111111111,12,2030,123");
    expect(session.apply("clean-all").toast).toMatch(/^Already clean — 1 line normalized$/);
  });

  it("only removes unrecognized lines through the explicit action", () => {
    const session = new SorterSession();
    session.setSource("4111111111111111|12|2030|123\n\nnot a record\n5555555555554444|01|2029|999");
    const result = session.apply("remove-invalid");
    expect(result.message).toBe("2 invalid or empty lines removed.");
    expect(session.output).not.toContain("not a record");
    expect(SORTER_ACTIONS.find((action) => action.id === "remove-invalid")?.destructive).toBe(true);
  });

  it("describes every action, including no-op outcomes", () => {
    const session = new SorterSession();
    for (const action of SORTER_ACTIONS) {
      session.setSource(SAMPLE);
      const first = session.apply(action.id);
      expect(first.ok).toBe(true);
      expect(first.message.length).toBeGreaterThan(5);
      const second = session.apply(action.id);
      expect(second.toast.length).toBeGreaterThan(5);
    }
  });

  it("sorts stably and remembers key and direction until content changes", () => {
    const session = new SorterSession();
    session.setSource("b\na\nc");
    const result = session.sort("line", "desc");
    expect(result.toast).toBe("Sorted by full line (Z → A)");
    expect(session.output).toBe("c\nb\na");
    expect(session.direction).toBe("desc");
    session.apply("reverse");
    expect(session.direction).toBe("desc");
    session.apply("dedupe-lines");
    expect(session.direction).toBeNull();
    session.sort("line", "asc");
    expect(session.status).toBe("Sorted by full line · A → Z");
  });

  it("tracks the selected sort key", () => {
    const session = new SorterSession();
    session.setSortKey("expiry");
    expect(session.sortKey).toBe("expiry");
  });

  it("describes a cleaned result that differs from the paste", () => {
    const session = new SorterSession();
    session.setSource("a\n\nb");
    session.apply("remove-empty");
    session.setSortKey("number");
    expect(session.stats.remainingLines).toBe(2);
    expect(session.entries).toHaveLength(2);
    // The persistent status keeps the last action message.
    expect(session.status).toBe("1 empty line removed.");
  });

  it("exports the current result and clears everything", () => {
    const session = new SorterSession();
    session.setSource("4111111111111111|12|2030|123");
    const file = session.exportFile(new Date("2026-01-02T03:04:05Z"));
    expect(file.content).toContain("4111111111111111");
    expect(file.filename).toMatch(/\.txt$/);
    session.clear();
    expect(session.hasInput).toBe(false);
    expect(session.output).toBe("");
  });
});
