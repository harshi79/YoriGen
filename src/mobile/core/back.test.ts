import { describe, expect, it } from "vitest";
import { BackDispatcher } from "./back";

describe("BackDispatcher", () => {
  it("consults the most recent layer first", () => {
    const calls: string[] = [];
    const back = new BackDispatcher();
    back.push(() => (calls.push("base"), true));
    back.push(() => (calls.push("sheet"), true));
    expect(back.dispatch()).toBe(true);
    expect(calls).toEqual(["sheet"]);
  });

  it("falls through layers that decline", () => {
    const calls: string[] = [];
    const back = new BackDispatcher();
    back.push(() => (calls.push("base"), true));
    back.push(() => (calls.push("passive"), false));
    expect(back.dispatch()).toBe(true);
    expect(calls).toEqual(["passive", "base"]);
  });

  it("reports unhandled when no layer consumes the action", () => {
    const back = new BackDispatcher();
    expect(back.dispatch()).toBe(false);
    back.push(() => false);
    expect(back.dispatch()).toBe(false);
  });

  it("removes a layer once, even if removal is called twice", () => {
    const back = new BackDispatcher();
    const layer = () => true;
    back.push(() => true);
    const remove = back.push(layer);
    expect(back.depth).toBe(2);
    remove();
    remove();
    expect(back.depth).toBe(1);
  });
});
