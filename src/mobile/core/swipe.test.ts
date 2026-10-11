// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootShell, $ } from "../test-support";
import { attachSwipe, resolveSwipe, DEFAULT_SWIPE_THRESHOLD } from "./swipe";

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

describe("resolveSwipe", () => {
  it("reads direction from the sign of horizontal travel", () => {
    expect(resolveSwipe({ dx: -120, dy: 4, durationMs: 200 })).toBe("left");
    expect(resolveSwipe({ dx: 120, dy: 4, durationMs: 200 })).toBe("right");
  });

  it("ignores travel below the threshold", () => {
    expect(resolveSwipe({ dx: DEFAULT_SWIPE_THRESHOLD - 1, dy: 0, durationMs: 100 })).toBeNull();
    expect(resolveSwipe({ dx: -(DEFAULT_SWIPE_THRESHOLD - 1), dy: 0, durationMs: 100 })).toBeNull();
    expect(resolveSwipe({ dx: 0, dy: 0, durationMs: 100 })).toBeNull();
  });

  it("hands a mostly vertical gesture back to the page", () => {
    // Long, but nearly straight down: a scroll, not a swipe.
    expect(resolveSwipe({ dx: 90, dy: 80, durationMs: 200 })).toBeNull();
    expect(resolveSwipe({ dx: 90, dy: 400, durationMs: 200 })).toBeNull();
    // Same horizontal travel with the vertical component under the axis ratio.
    expect(resolveSwipe({ dx: 90, dy: 60, durationMs: 200 })).toBe("right");
  });

  it("treats a slow drag as a scroll rather than a swipe", () => {
    expect(resolveSwipe({ dx: 200, dy: 0, durationMs: 5000 })).toBeNull();
    expect(resolveSwipe({ dx: 200, dy: 0, durationMs: 5000 }, { maxDurationMs: 10_000 })).toBe("right");
  });

  it("honours custom rules", () => {
    expect(resolveSwipe({ dx: 20, dy: 0, durationMs: 100 }, { threshold: 12 })).toBe("right");
    expect(resolveSwipe({ dx: 20, dy: 0, durationMs: 100 }, { threshold: 40 })).toBeNull();
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

  it("reports a confirmed swipe only on release", () => {
    const onSwipe = vi.fn();
    attachSwipe(host, { onSwipe });
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 100, button: 0, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 180, clientY: 104, isPrimary: true, bubbles: true }));
    expect(onSwipe).not.toHaveBeenCalled(); // nothing commits mid-gesture
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 180, clientY: 104, button: 0, isPrimary: true, bubbles: true }));
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  it("does nothing for a short gesture", () => {
    const onSwipe = vi.fn();
    attachSwipe(host, { onSwipe });
    drag(host, { x: 300, y: 100 }, { x: 280, y: 100 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("ignores a vertical drag, so scrolling is never blocked", () => {
    const onSwipe = vi.fn();
    attachSwipe(host, { onSwipe });
    drag(host, { x: 200, y: 100 }, { x: 210, y: 500 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("abandons a cancelled or abandoned gesture", () => {
    const onSwipe = vi.fn();
    attachSwipe(host, { onSwipe });
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 }, { cancel: true });
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 }, { leave: true });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("ignores gestures that begin on a control, input or link", () => {
    const onSwipe = vi.fn();
    host.innerHTML =
      '<input id="field"><button id="btn">Go</button><a id="lnk" href="#">x</a><div id="plain"></div>';
    attachSwipe(host, { onSwipe });
    for (const selector of ["#field", "#btn", "#lnk"]) {
      drag(host.querySelector<HTMLElement>(selector)!, { x: 300, y: 100 }, { x: 100, y: 100 });
    }
    expect(onSwipe).not.toHaveBeenCalled();
    drag(host.querySelector<HTMLElement>("#plain")!, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  it("respects the isEnabled veto", () => {
    const onSwipe = vi.fn();
    let enabled = false;
    attachSwipe(host, { onSwipe, isEnabled: () => enabled });
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(onSwipe).not.toHaveBeenCalled();
    enabled = true;
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  it("ignores secondary buttons and non-primary pointers", () => {
    const onSwipe = vi.fn();
    attachSwipe(host, { onSwipe });
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 100, button: 2, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, button: 2, isPrimary: true, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 100, button: 0, isPrimary: false, bubbles: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, button: 0, isPrimary: false, bubbles: true }));
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("removes every listener when detached", () => {
    const onSwipe = vi.fn();
    const detach = attachSwipe(host, { onSwipe });
    detach();
    drag(host, { x: 300, y: 100 }, { x: 100, y: 100 });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe("shell swipe navigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const host = () => $("#screens");

  it("swiping left moves to the next destination, right to the previous", () => {
    const { shell } = bootShell();
    expect(shell.navigator.current).toBe("generator");
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 304 });
    expect(shell.navigator.current).toBe("lookup");
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 304 });
    expect(shell.navigator.current).toBe("sorter");
    drag(host(), { x: 60, y: 300 }, { x: 320, y: 296 });
    expect(shell.navigator.current).toBe("lookup");
  });

  it("stops at both ends instead of wrapping around", () => {
    const { shell } = bootShell();
    drag(host(), { x: 60, y: 300 }, { x: 320, y: 300 }); // before the first tab
    expect(shell.navigator.current).toBe("generator");
    shell.context.navigate("settings");
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 }); // after the last tab
    expect(shell.navigator.current).toBe("settings");
  });

  it("does not navigate on a vertical scroll gesture", () => {
    const { shell } = bootShell();
    drag(host(), { x: 200, y: 120 }, { x: 206, y: 600 });
    expect(shell.navigator.current).toBe("generator");
  });

  it("does not navigate while a sheet is open", async () => {
    const { shell } = bootShell();
    void shell.context.ui.sheets.confirm({ title: "Open?", message: "m", confirmLabel: "Yes" });
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
    expect(shell.navigator.current).toBe("generator");
  });

  it("does not hijack a swipe that starts in the sorter textarea", () => {
    const { shell } = bootShell();
    shell.context.navigate("sorter");
    drag($("#sorter-input"), { x: 340, y: 300 }, { x: 120, y: 300 });
    expect(shell.navigator.current).toBe("sorter");
  });

  it("plays a directional transition and removes the class when it ends", () => {
    const { shell } = bootShell();
    drag(host(), { x: 340, y: 300 }, { x: 120, y: 300 });
    expect(shell.navigator.current).toBe("lookup");
    const incoming = $('.screen-host[data-screen="lookup"]');
    expect(incoming.classList.contains("screen-in-forward")).toBe(true);
    incoming.dispatchEvent(new Event("animationend"));
    expect(incoming.classList.contains("screen-in-forward")).toBe(false);
    // The screen is left visible and usable once the transition is cleaned up.
    expect(incoming.hidden).toBe(false);
  });

  it("marks a rightward swipe with the backward transition", () => {
    const { shell } = bootShell();
    shell.context.navigate("sorter");
    drag(host(), { x: 60, y: 300 }, { x: 320, y: 300 });
    expect($('.screen-host[data-screen="lookup"]').classList.contains("screen-in-backward")).toBe(true);
  });

  it("keeps the bottom navigation working as the non-swipe alternative", () => {
    const { shell } = bootShell();
    $('.bottom-nav [data-tool="settings"]').click();
    expect(shell.navigator.current).toBe("settings");
    $('.bottom-nav [data-tool="generator"]').click();
    expect(shell.navigator.current).toBe("generator");
    expect(document.querySelectorAll(".bottom-nav .nav-item")).toHaveLength(4);
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
