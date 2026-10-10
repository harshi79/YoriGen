// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Braces } from "lucide";
import { BackDispatcher } from "../core/back";
import { button, card, emptyState, errorState, field, iconButton, segmented, selectControl, toggle } from "./components";
import { h, plural, prefersReducedMotion, scrollBehavior } from "./dom";
import { createSheets } from "./sheet";
import { createToaster } from "./toast";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("toasts", () => {
  it("announce through a persistent live region and disappear on their own", () => {
    vi.useFakeTimers();
    const toaster = createToaster(document.body, 1000);
    toaster.show("Saved");
    expect(toaster.element.hidden).toBe(false);
    expect(toaster.element.getAttribute("aria-hidden")).toBe("true");
    expect(toaster.live.textContent).toBe("Saved");
    vi.advanceTimersByTime(1000);
    expect(toaster.element.hidden).toBe(true);
    expect(toaster.live.textContent).toBe("");
  });

  it("keep errors on screen longer and replace earlier messages", () => {
    vi.useFakeTimers();
    const toaster = createToaster(document.body, 1000);
    toaster.show("First");
    toaster.show("Broken", "error");
    expect(toaster.element.classList.contains("toast-error")).toBe(true);
    expect(toaster.element.textContent).toBe("Broken");
    vi.advanceTimersByTime(1000);
    expect(toaster.element.hidden).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(toaster.element.hidden).toBe(true);
  });
});

describe("sheets", () => {
  it("close from the close button and from a backdrop tap, restoring focus", async () => {
    const back = new BackDispatcher();
    const sheets = createSheets(document.body, back);
    const opener = h("button", {}, "open");
    document.body.append(opener);
    opener.focus();
    const first = sheets.open({ title: "One", description: "Details", content: [h("p", {}, "Body")] });
    expect(first.element.getAttribute("aria-describedby")).toBeTruthy();
    first.element.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    expect(await first.closed).toBeUndefined();
    expect(document.activeElement).toBe(opener);
    expect(back.depth).toBe(0);

    const second = sheets.open({ title: "Two" });
    second.element.getBoundingClientRect = () => ({ left: 0, right: 100, top: 500, bottom: 900 }) as DOMRect;
    second.element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 600 }));
    expect(second.element.open).toBe(true);
    second.element.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 100 }));
    expect(await second.closed).toBeUndefined();
  });

  it("ignore clicks on their content", () => {
    const sheets = createSheets(document.body, new BackDispatcher());
    const sheet = sheets.open({ title: "Content", content: [h("button", { id: "inner" }, "Inner")] });
    sheet.element.querySelector<HTMLButtonElement>("#inner")?.click();
    expect(sheet.element.open).toBe(true);
    sheet.close("done");
    return expect(sheet.closed).resolves.toBe("done");
  });
});

describe("components", () => {
  it("segmented controls track and report their value", () => {
    const onChange = vi.fn();
    const control = segmented({ label: "Mode", segments: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "a", onChange });
    document.body.append(control.element);
    expect(control.value).toBe("a");
    control.element.querySelector<HTMLButtonElement>('[data-value="b"]')?.click();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(control.value).toBe("b");
    control.set("a");
    expect(control.element.querySelector('[data-value="a"]')?.getAttribute("aria-pressed")).toBe("true");
    control.element.querySelector<HTMLButtonElement>('[data-value="a"]')?.click();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("toggles, fields, selects, cards and states render accessible markup", () => {
    const onToggle = vi.fn();
    const sw = toggle({ label: "Auto", onChange: onToggle, checked: true });
    const input = sw.input;
    expect(sw.element.querySelector(".switch-input")).toBe(input);
    expect(input.checked).toBe(true);
    expect(input.getAttribute("role")).toBe("switch");
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(onToggle).toHaveBeenCalledWith(false);

    const control = h("input", { id: "f" });
    const f = field({ label: "Label", controlId: "f", control, inline: h("span", {}, "x") });
    f.setError("Bad");
    expect(control.getAttribute("aria-describedby")).toContain(f.hint.id);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    f.setError(undefined);
    expect(control.hasAttribute("aria-invalid")).toBe(false);

    expect(selectControl("s", [{ value: "x", label: "X" }, { value: "y", label: "Y" }], "y").value).toBe("y");
    const plainCard = card({}, h("p", {}, "content"));
    expect(plainCard.querySelector(".card-head")).toBeNull();
    expect(card({ title: "T", badge: "B", iconNode: Braces }).getAttribute("aria-labelledby")).toBeTruthy();
    expect(emptyState({ iconNode: Braces, title: "Empty", body: "Nothing", action: button({ label: "Go", onClick: () => {} }) }).querySelector(".btn")).not.toBeNull();
    expect(errorState({ title: "Error", message: "Oops" }).querySelector("button")).toBeNull();
    expect(iconButton({ label: "Copy", iconNode: Braces, onClick: () => {}, className: "extra" }).getAttribute("aria-label")).toBe("Copy");
  });

  it("builds buttons with variants and optional labels", () => {
    const b = button({ label: "Delete", variant: "danger", ariaLabel: "Delete all", className: "btn-block", onClick: () => {} });
    expect(b.className).toBe("btn btn-danger btn-block");
    expect(b.getAttribute("aria-label")).toBe("Delete all");
    expect(errorState({ title: "E", message: "M", onRetry: () => {}, retryLabel: "Reload tool" }).textContent).toContain("Reload tool");
  });
});

describe("dom helpers", () => {
  it("pluralizes counts", () => {
    expect(plural(1, "line")).toBe("1 line");
    expect(plural(2, "line")).toBe("2 lines");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });

  it("uses instant scrolling when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(scrollBehavior()).toBe("smooth");
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
