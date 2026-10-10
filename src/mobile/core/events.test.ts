import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./events";

describe("EventBus", () => {
  it("calls every handler and sums the counts they report", () => {
    const bus = new EventBus();
    bus.on("session:clear", () => 2);
    bus.on("session:clear", () => undefined);
    bus.on("session:clear", () => 3);
    expect(bus.emit("session:clear", undefined)).toBe(5);
  });

  it("returns zero without handlers and stops calling removed handlers", () => {
    const bus = new EventBus();
    expect(bus.emit("session:clear", undefined)).toBe(0);
    const handler = vi.fn(() => 1);
    const off = bus.on("session:clear", handler);
    off();
    expect(bus.emit("session:clear", undefined)).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports custom event maps with payloads", () => {
    const bus = new EventBus<{ ping: number }>();
    const seen: number[] = [];
    bus.on("ping", (value) => void seen.push(value));
    bus.emit("ping", 7);
    expect(seen).toEqual([7]);
  });
});
