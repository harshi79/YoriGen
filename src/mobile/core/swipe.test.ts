// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootShell, $ } from "../test-support";
import {
  attachSwipe,
  DEFAULT_SWIPE_THRESHOLD,
  shouldCommitSwipe,
  SWIPE_COMMIT_FRACTION,
  SWIPE_LOCK_SLOP,
  type SwipeOptions,
} from "./swipe";

/** Drags across `element` and releases. Coordinates are CSS px. */
function drag(
  element: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { cancel?: boolean; leave?: boolean } = {},
) {
  const fire = (type: string, x: number, y: number) =>
    element.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: true }),
    );
  fire("pointerdown", from.x, from.y);
  fire("pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2);
  if (options.cancel) fire("pointercancel", to.x, to.y);
  else if (options.leave) fire("pointerleave", to.x, to.y);
  fire("pointerup", to.x, to.y);
}

function handlers(overrides: Partial<SwipeOptions> = {}) {
  return {
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onDragCancel: vi.fn(),
    ...overrides,
  };
}

describe("shouldCommitSwipe", () => {
  const W = 400;

  it("commits once the drag covers the commit share of the screen, in either direction", () => {
    const edge = W * SWIPE_COMMIT_FRACTION;
    expect(shouldCommitSwipe({ dx: -edge, velocity: 0 }, W)).toBe(true);
    expect(shouldCommitSwipe({ dx: edge, velocity: 0 }, W)).toBe(true);
    expect(shouldCommitSwipe({ dx: -(edge - 1), velocity: 0 }, W)).toBe(false);
  });

  it("commits a short flick in the direction of travel", () => {
    expect(shouldCommitSwipe({ dx: -70, velocity: -0.8 }, W)).toBe(true);
    expect(shouldCommitSwipe({ dx: 70, velocity: 0.8 }, W)).toBe(true);
  });

  it("never commits a nudge, however fast, below the minimum travel", () => {
    expect(shouldCommitSwipe({ dx: -(DEFAULT_SWIPE_THRESHOLD - 1), velocity: -5 }, W)).toBe(false);
  });

  it("does not commit a slow short drag, nor a fast flick back toward the start", () => {
    expect(shouldCommitSwipe({ dx: -70, velocity: -0.2 }, W)).toBe(false);
    expect(shouldCommitSwipe({ dx: -70, velocity: 0.9 }, W)).toBe(false);
  });

  it("does not depend on how long the drag took: a slow long drag still commits", () => {
    expect(shouldCommitSwipe({ dx: -200, velocity: 0.01 }, W)).toBe(true);
  });

  it("falls back to a typical phone width before the host has been laid out", () => {
    expect(shouldCommitSwipe({ dx: -130, velocity: 0 }, 0)).toBe(true);
    expect(shouldCommitSwipe({ dx: -100, velocity: 0 }, 0)).toBe(false);
  });
});

describe("attachSwipe", () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    host.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, button: 0, isPrimary: true, bubbles: true, ...extra }),
    );

  it("locks as horizontal only after the slop, then reports the drag live", () => {
    const h = handlers();
    attachSwipe(host, h);
    pointer("pointerdown", 300, 100);
    pointer("pointermove", 300 - (SWIPE_LOCK_SLOP - 2), 100);
    expect(h.onDragStart).not.toHaveBeenCalled(); // a tap-sized wobble is not a drag
    pointer("pointermove", 280, 101);
    expect(h.onDragStart).toHaveBeenCalledWith("left");
    // The first offset after the lock is zero, so the card starts where it is.
    expect(h.onDragMove).toHaveBeenLastCalledWith(0);
    pointer("pointermove", 240, 101);
    expect(h.onDragMove).toHaveBeenLastCalledWith(-40);
    expect(h.onDragEnd).not.toHaveBeenCalled(); // nothing resolves mid-gesture
  });

  it("reports the release with total travel and velocity", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000) // pointerdown
      .mockReturnValueOnce(1010) // move
      .mockReturnValueOnce(1020) // move
      .mockReturnValueOnce(1030); // release
    const onDragEnd = vi.fn();
    attachSwipe(host, handlers({ onDragEnd }));
    pointer("pointerdown", 300, 100);
    pointer("pointermove", 290, 100);
    pointer("pointermove", 270, 100);
    pointer("pointerup", 240, 100);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    const [release] = onDragEnd.mock.calls[0] as [{ dx: number; velocity: number }];
    expect(release.dx).toBe(-60);
    expect(release.velocity).toBeCloseTo(-2, 5); // (240 - 300) px over 30 ms
  });

  it("hands a mostly vertical gesture back to the page without ever locking", () => {
    const h = handlers();
    attachSwipe(host, h);
    pointer("pointerdown", 200, 100);
    pointer("pointermove", 203, 120);
    pointer("pointermove", 206, 200); // vertical now clearly wins
    pointer("pointermove", 90, 201); // a later horizontal move must not revive it
    pointer("pointerup", 90, 201);
    expect(h.onDragStart).not.toHaveBeenCalled();
    expect(h.onDragMove).not.toHaveBeenCalled();
    expect(h.onDragEnd).not.toHaveBeenCalled();
  });

  it("locks when horizontal travel leads vertical by the axis ratio", () => {
    const h = handlers();
    attachSwipe(host, h);
    // 90 across, 70 down: vertical intent, so the page keeps the gesture.
    drag(host, { x: 200, y: 100 }, { x: 290, y: 170 });
    expect(h.onDragStart).not.toHaveBeenCalled();
    // 90 across, 30 down: horizontal leads by well over 1.4x, so it locks.
    drag(host, { x: 200, y: 100 }, { x: 290, y: 130 });
    expect(h.onDragStart).toHaveBeenCalledWith("right");
  });

  it("reports a cancelled drag only if it had locked", () => {
    const h = handlers();
    attachSwipe(host, h);
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 }, { cancel: true });
    expect(h.onDragCancel).toHaveBeenCalledTimes(1);
    drag(host, { x: 300, y: 100 }, { x: 301, y: 100 }, { cancel: true });
    expect(h.onDragCancel).toHaveBeenCalledTimes(1);
    expect(h.onDragEnd).not.toHaveBeenCalled();
  });

  it("abandons a pre-lock gesture that leaves the host, but keeps a locked one", () => {
    const h = handlers();
    attachSwipe(host, h);
    pointer("pointerdown", 300, 100);
    pointer("pointerleave", 300, 100);
    pointer("pointermove", 200, 100);
    pointer("pointerup", 200, 100);
    expect(h.onDragStart).not.toHaveBeenCalled();

    pointer("pointerdown", 300, 100);
    pointer("pointermove", 280, 100); // locked
    pointer("pointerleave", 250, 100); // captured: leave does not end it
    pointer("pointermove", 200, 100);
    pointer("pointerup", 200, 100);
    expect(h.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("captures the pointer on lock, so a locked drag keeps tracking", () => {
    const setPointerCapture = vi.fn();
    Object.defineProperty(host, "setPointerCapture", { value: setPointerCapture });
    attachSwipe(host, handlers());
    pointer("pointerdown", 300, 100, { pointerId: 7 });
    expect(setPointerCapture).not.toHaveBeenCalled();
    pointer("pointermove", 280, 100, { pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });

  it("ignores gestures that begin on a control, input or link", () => {
    const h = handlers();
    host.innerHTML =
      '<input id="field"><button id="btn">Go</button><a id="lnk" href="#">x</a><div id="plain"></div>';
    attachSwipe(host, h);
    for (const selector of ["#field", "#btn", "#lnk"]) {
      drag(host.querySelector<HTMLElement>(selector)!, { x: 300, y: 100 }, { x: 100, y: 100 });
    }
    expect(h.onDragStart).not.toHaveBeenCalled();
    drag(host.querySelector<HTMLElement>("#plain")!, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(h.onDragStart).toHaveBeenCalledWith("left");
  });

  it("respects the isEnabled veto", () => {
    const h = handlers();
    let enabled = false;
    attachSwipe(host, { ...h, isEnabled: () => enabled });
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(h.onDragStart).not.toHaveBeenCalled();
    enabled = true;
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(h.onDragStart).toHaveBeenCalledWith("left");
  });

  it("ignores secondary buttons and non-primary pointers", () => {
    const h = handlers();
    attachSwipe(host, h);
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 100, button: 2, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 100, button: 2, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, button: 2, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 100, button: 0, isPrimary: false, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, button: 0, isPrimary: false, bubbles: true }));
    expect(h.onDragStart).not.toHaveBeenCalled();
    expect(h.onDragEnd).not.toHaveBeenCalled();
  });

  it("ignores moves from a different pointer than the one that started the gesture", () => {
    const h = handlers();
    attachSwipe(host, h);
    pointer("pointerdown", 300, 100, { pointerId: 1 });
    pointer("pointermove", 200, 100, { pointerId: 2 });
    expect(h.onDragStart).not.toHaveBeenCalled();
  });

  it("removes every listener when detached", () => {
    const h = handlers();
    const detach = attachSwipe(host, h);
    detach();
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(h.onDragStart).not.toHaveBeenCalled();
    expect(h.onDragEnd).not.toHaveBeenCalled();
  });
});

/** Waits for the settle animation and any navigation it ends with. */
const settle = (check: () => void) => vi.waitFor(check, { timeout: 2000, interval: 16 });

describe("shell swipe navigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const host = () => $("#screens");

  it("swiping left moves to the next destination, right to the previous", async () => {
    const { shell } = bootShell();
    expect(shell.navigator.current).toBe("generator");
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 304 });
    await settle(() => expect(shell.navigator.current).toBe("lookup"));
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 304 });
    await settle(() => expect(shell.navigator.current).toBe("sorter"));
    drag(host(), { x: 60, y: 300 }, { x: 320, y: 296 });
    await settle(() => expect(shell.navigator.current).toBe("lookup"));
  });

  it("stops at both ends instead of wrapping around", async () => {
    const { shell } = bootShell();
    drag(host(), { x: 60, y: 300 }, { x: 320, y: 300 }); // before the first tab
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(shell.navigator.current).toBe("generator");
    shell.context.navigate("settings");
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 }); // after the last tab
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(shell.navigator.current).toBe("settings");
  });

  it("does not navigate on a vertical scroll gesture", async () => {
    const { shell } = bootShell();
    drag(host(), { x: 200, y: 120 }, { x: 206, y: 600 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shell.navigator.current).toBe("generator");
  });

  it("does not navigate while a sheet is open", async () => {
    const { shell } = bootShell();
    void shell.context.ui.sheets.confirm({ title: "Open?", message: "m", confirmLabel: "Yes" });
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(shell.navigator.current).toBe("generator");
  });

  it("does not hijack a swipe that starts in the sorter textarea", async () => {
    const { shell } = bootShell();
    shell.context.navigate("sorter");
    drag($("#sorter-input"), { x: 340, y: 300 }, { x: 120, y: 300 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(shell.navigator.current).toBe("sorter");
  });

  it("reveals the destination underneath while the finger is down, before any navigation", () => {
    const { shell } = bootShell();
    const element = host();
    const pointer = (type: string, x: number) =>
      element.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 300, button: 0, isPrimary: true, bubbles: true }));
    pointer("pointerdown", 340);
    pointer("pointermove", 300);
    pointer("pointermove", 220);
    // The card follows the finger and the next page is staged behind it.
    const card = $('.screen-host[data-screen="generator"]');
    const under = $('.screen-host[data-screen="lookup"]');
    expect(card.classList.contains("stack-top")).toBe(true);
    expect(card.style.transform).toContain("translate3d(");
    expect(under.classList.contains("stack-under")).toBe(true);
    expect(under.hidden).toBe(false);
    expect(shell.navigator.current).toBe("generator");
    pointer("pointerup", 220);
  });

  it("returns to rest when the drag is too short to commit", async () => {
    const { shell } = bootShell();
    drag(host(), { x: 340, y: 300 }, { x: 300, y: 300 });
    await settle(() => {
      const under = $('.screen-host[data-screen="lookup"]');
      expect(under.hidden).toBe(true);
    });
    expect(shell.navigator.current).toBe("generator");
    const card = $('.screen-host[data-screen="generator"]');
    expect(card.classList.contains("stack-top")).toBe(false);
    expect(card.style.transform).toBe("");
  });

  it("removes the stacked-card classes once a committed swipe lands", async () => {
    const { shell } = bootShell();
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
    await settle(() => expect(shell.navigator.current).toBe("lookup"));
    const incoming = $('.screen-host[data-screen="lookup"]');
    expect(incoming.hidden).toBe(false);
    expect(incoming.classList.contains("stack-under")).toBe(false);
    expect(incoming.style.transform).toBe("");
    expect(incoming.classList.contains("screen-in-forward")).toBe(false);
    expect($('.screen-host[data-screen="generator"]').hidden).toBe(true);
  });

  it("keeps the bottom navigation as the tap alternative, with its own directional entrance", () => {
    const { shell } = bootShell();
    $('.bottom-nav [data-tool="lookup"]').click();
    expect(shell.navigator.current).toBe("lookup");
    expect($('.screen-host[data-screen="lookup"]').classList.contains("screen-in-forward")).toBe(true);
  });

  it("a tap during a settling swipe takes over cleanly", async () => {
    const { shell } = bootShell();
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
    $('.bottom-nav [data-tool="settings"]').click();
    expect(shell.navigator.current).toBe("settings");
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The abandoned swipe never navigates a second time.
    expect(shell.navigator.current).toBe("settings");
    expect($('.screen-host[data-screen="lookup"]').hidden).toBe(true);
    expect($('.screen-host[data-screen="lookup"]').classList.contains("stack-under")).toBe(false);
    expect($('.screen-host[data-screen="settings"]').hidden).toBe(false);
  });

  it("reduced motion navigates on release with no preview and no entrance", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }) as never;
    try {
      const { shell } = bootShell();
      drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
      expect(shell.navigator.current).toBe("lookup");
      expect($('.screen-host[data-screen="lookup"]').classList.contains("stack-under")).toBe(false);
      expect($('.screen-host[data-screen="lookup"]').classList.contains("screen-in-forward")).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("swipe touch-action", () => {
  // The gesture depends on a CSS precondition the DOM tests above cannot see:
  // the browser resolves touch-action only up to the nearest scrollable
  // ancestor. That ancestor is .screen-scroll, not .screens, so both rules are
  // needed. Drop either and the scroller defaults to `auto`, claims the
  // horizontal travel as a pan and cancels the pointer stream before the
  // listener ever resolves a direction.
  // happy-dom gives this module an http import.meta.url, so the stylesheet is
  // read from the repository root that vitest runs in.
  const css = readFileSync(join(process.cwd(), "src/mobile/styles/mobile.css"), "utf8");

  const touchAction = (selector: string) => {
    const rule = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(css);
    expect(rule, `.${selector} rule exists in mobile.css`).not.toBeNull();
    const match = /touch-action:\s*([^;]+);/.exec(rule![1]);
    return match?.[1].trim();
  };

  it("keeps vertical panning and yields horizontal travel on both the host and the scroller", () => {
    expect(touchAction("screens")).toBe("pan-y");
    expect(touchAction("screen-scroll")).toBe("pan-y");
  });
});
