import { describe, expect, it } from "vitest";
import { destinationFromHash, Navigator, type NavigationEvent } from "./navigation";

const ids = ["generator", "lookup", "sorter", "settings"];

function setup(debounceMs = 300) {
  let now = 0;
  const navigator = new Navigator(ids, "generator", { debounceMs, now: () => now });
  const events: NavigationEvent[] = [];
  navigator.subscribe((event) => events.push(event));
  return { navigator, events, advance: (ms: number) => (now += ms) };
}

describe("Navigator", () => {
  it("starts on the start destination", () => {
    const { navigator } = setup();
    expect(navigator.current).toBe("generator");
    expect(navigator.startId).toBe("generator");
  });

  it("switches destinations and reports the change", () => {
    const { navigator, events } = setup();
    expect(navigator.navigate("lookup")).toBe(true);
    expect(navigator.current).toBe("lookup");
    expect(events).toEqual([{ type: "navigate", from: "generator", to: "lookup" }]);
  });

  it("ignores unknown destinations", () => {
    const { navigator, events } = setup();
    expect(navigator.navigate("admin")).toBe(false);
    expect(navigator.current).toBe("generator");
    expect(events).toEqual([]);
  });

  it("debounces rapid repeated taps on the same destination", () => {
    const { navigator, events, advance } = setup();
    navigator.navigate("lookup");
    advance(50);
    expect(navigator.navigate("lookup")).toBe(false);
    advance(50);
    navigator.navigate("lookup");
    expect(events).toHaveLength(1);
  });

  it("reports a deliberate second tap as a reselect", () => {
    const { navigator, events, advance } = setup();
    navigator.navigate("lookup");
    advance(400);
    expect(navigator.navigate("lookup")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "reselect", id: "lookup" });
  });

  it("allows quick switches between different destinations", () => {
    const { navigator, advance } = setup();
    navigator.navigate("lookup");
    advance(10);
    expect(navigator.navigate("sorter")).toBe(true);
    expect(navigator.current).toBe("sorter");
  });

  it("never builds history: Back from any tab returns to the start destination", () => {
    const { navigator, events, advance } = setup();
    navigator.navigate("lookup");
    advance(10);
    navigator.navigate("sorter");
    advance(10);
    navigator.navigate("settings");
    expect(navigator.back()).toBe("handled");
    expect(navigator.current).toBe("generator");
    expect(events.at(-1)).toEqual({ type: "navigate", from: "settings", to: "generator" });
    expect(navigator.back()).toBe("exit");
  });

  it("does not treat Back followed by a start-tab tap as a reselect burst", () => {
    const { navigator, events } = setup();
    navigator.navigate("lookup");
    navigator.back();
    const count = events.length;
    expect(navigator.navigate("generator")).toBe(false);
    expect(events).toHaveLength(count);
  });

  it("stops notifying after unsubscribe", () => {
    const { navigator, events } = setup();
    const extra: NavigationEvent[] = [];
    const stop = navigator.subscribe((event) => extra.push(event));
    stop();
    navigator.navigate("lookup");
    expect(extra).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it("validates its destinations", () => {
    expect(() => new Navigator([], "a")).toThrow(/at least one/);
    expect(() => new Navigator(["a", "a"], "a")).toThrow(/unique/);
    expect(() => new Navigator(["a"], "b")).toThrow(/not registered/);
  });

  it("uses the real clock by default", () => {
    const navigator = new Navigator(ids, "generator");
    expect(navigator.navigate("lookup")).toBe(true);
    expect(navigator.has("sorter")).toBe(true);
  });
});

describe("destinationFromHash", () => {
  it.each([
    ["#/lookup", "lookup"],
    ["#lookup", "lookup"],
    ["#/sorter/extra", "sorter"],
    ["#/settings?x=1", "settings"],
    ["", "generator"],
    ["#/", "generator"],
    ["#/unknown", "generator"],
  ])("maps %j to %s", (hash, expected) => {
    expect(destinationFromHash(hash, ids, "generator")).toBe(expected);
  });
});
