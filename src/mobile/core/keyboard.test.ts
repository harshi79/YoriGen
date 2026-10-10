// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEditable, KEYBOARD_THRESHOLD, keyboardLikelyOpen, watchKeyboard } from "./keyboard";

function el(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe("isEditable", () => {
  it.each([
    ['<input type="text">', true],
    ['<input type="tel">', true],
    ["<input>", true],
    ["<textarea></textarea>", true],
    ['<input type="checkbox">', false],
    ['<input type="file">', false],
    ["<select></select>", false],
    ["<button></button>", false],
    ["<div></div>", false],
  ])("%s → %s", (html, expected) => {
    expect(isEditable(el(html))).toBe(expected);
  });

  it("treats contenteditable as editable and null as not", () => {
    const div = el("<div></div>");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditable(div)).toBe(true);
    expect(isEditable(null)).toBe(false);
  });
});

describe("keyboardLikelyOpen", () => {
  it("needs both a focused field and a large height drop", () => {
    expect(keyboardLikelyOpen(800, 500, true)).toBe(true);
    expect(keyboardLikelyOpen(800, 500, false)).toBe(false);
    expect(keyboardLikelyOpen(800, 800 - KEYBOARD_THRESHOLD, true)).toBe(false);
    expect(keyboardLikelyOpen(800, 700, true, 50)).toBe(true);
  });
});

describe("watchKeyboard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  function fakeWindow(height: number, width = 400) {
    const target = new EventTarget();
    const win = {
      innerHeight: height,
      innerWidth: width,
      document,
      visualViewport: Object.assign(target, { height }),
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    return {
      win: win as unknown as Window,
      resize(next: number, nextWidth = win.innerWidth) {
        win.visualViewport.height = next;
        win.innerHeight = next;
        win.innerWidth = nextWidth;
        target.dispatchEvent(new Event("resize"));
      },
    };
  }

  it("reports open while a field is focused and the viewport shrinks", () => {
    vi.useFakeTimers();
    const { win, resize } = fakeWindow(900);
    const input = document.createElement("input");
    document.body.append(input);
    const changes: boolean[] = [];
    const stop = watchKeyboard((open) => changes.push(open), win);
    input.focus();
    resize(520);
    expect(changes).toEqual([true]);
    resize(900);
    expect(changes).toEqual([true, false]);
    resize(520);
    input.blur();
    resize(900);
    vi.advanceTimersByTime(60);
    expect(changes).toEqual([true, false, true, false]);
    stop();
    input.focus();
    resize(500);
    expect(changes).toHaveLength(4);
  });

  it("ignores shrinking without a focused field and rebaselines on rotation", () => {
    const { win, resize } = fakeWindow(900);
    const changes: boolean[] = [];
    watchKeyboard((open) => changes.push(open), win);
    resize(500);
    expect(changes).toEqual([]);
    // Rotation: a new width starts a new baseline.
    resize(400, 900);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    resize(380, 900);
    expect(changes).toEqual([]);
  });

  it("falls back to window height without visualViewport", () => {
    const target = new EventTarget();
    const win = {
      innerHeight: 900,
      innerWidth: 400,
      document,
      visualViewport: null,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    const changes: boolean[] = [];
    watchKeyboard((open) => changes.push(open), win as unknown as Window);
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    win.innerHeight = 500;
    target.dispatchEvent(new Event("resize"));
    expect(changes).toEqual([true]);
  });
});
