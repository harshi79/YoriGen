// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Braces } from "lucide";
import { ToolRegistry, type ToolDefinition } from "./registry";
import { createDefaultRegistry, START_TOOL } from "../tools";

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: "sample",
  navLabel: "Sample",
  title: "Sample tool",
  description: "A tool used in tests.",
  icon: Braces,
  network: "none",
  create: () => ({ root: document.createElement("div") }),
  ...overrides,
});

describe("ToolRegistry", () => {
  it("keeps registration order as navigation order", () => {
    const registry = new ToolRegistry().register(tool({ id: "first" })).register(tool({ id: "second" }));
    expect(registry.ids()).toEqual(["first", "second"]);
    expect(registry.list().map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(registry.has("second")).toBe(true);
    expect(registry.get("first").title).toBe("Sample tool");
  });

  it("rejects duplicate ids", () => {
    const registry = new ToolRegistry().register(tool());
    expect(() => registry.register(tool())).toThrow(/already registered/);
  });

  it.each(["", "A", "x", "Upper", "1tool", "has space", "has_underscore", "a".repeat(33)])(
    "rejects the unsafe id %j",
    (id) => {
      expect(() => new ToolRegistry().register(tool({ id }))).toThrow(/lowercase/);
    },
  );

  it("requires a navigation label and a title", () => {
    expect(() => new ToolRegistry().register(tool({ navLabel: " " }))).toThrow(/label and a title/);
    expect(() => new ToolRegistry().register(tool({ title: "" }))).toThrow(/label and a title/);
  });

  it("throws a clear error for unknown tools", () => {
    expect(() => new ToolRegistry().get("missing")).toThrow('Unknown tool "missing".');
  });

  it("freezes registered definitions", () => {
    const registry = new ToolRegistry().register(tool());
    expect(Object.isFrozen(registry.get("sample"))).toBe(true);
  });
});

describe("default registry", () => {
  const registry = createDefaultRegistry();

  it("registers the ORIGEN tools in navigation order", () => {
    expect(registry.ids()).toEqual(["generator", "lookup", "sorter", "settings", "help"]);
    expect(START_TOOL).toBe("generator");
  });

  it("keeps Help routable but out of the bottom navigation", () => {
    expect(registry.has("help")).toBe(true);
    expect(registry.get("help").navHidden).toBe(true);
    expect(registry.navList().map((entry) => entry.id)).toEqual(["generator", "lookup", "sorter", "settings"]);
    // Every nav-visible tool is still in the full list, in the same order.
    expect(registry.list().filter((entry) => !entry.navHidden)).toEqual(registry.navList());
  });

  it("marks only BIN Lookup as needing the network", () => {
    expect(registry.list().filter((entry) => entry.network === "required").map((entry) => entry.id)).toEqual(["lookup"]);
  });

  it("gives every tool short labels that fit the bottom bar", () => {
    for (const entry of registry.list()) {
      expect(entry.navLabel.length).toBeLessThanOrEqual(12);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });
});
