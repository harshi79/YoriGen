/**
 * Soft-keyboard detection.
 *
 * On Android the WebView is resized when the IME opens (Capacitor's
 * SystemBars handling pads the window by the IME inset). The shell uses this
 * to hide the bottom navigation and sticky action bars while typing so the
 * focused field is never covered.
 */
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

export function isEditable(element: Element | null): boolean {
  if (!element || !EDITABLE.test(element.tagName)) return element instanceof HTMLElement && element.isContentEditable;
  if (element.tagName === "INPUT") return !NON_TEXT_INPUTS.has((element as HTMLInputElement).type);
  return element.tagName !== "SELECT";
}

/** A height drop larger than this (in CSS px) is treated as an open keyboard. */
export const KEYBOARD_THRESHOLD = 140;

export function keyboardLikelyOpen(
  baselineHeight: number,
  currentHeight: number,
  editableFocused: boolean,
  threshold = KEYBOARD_THRESHOLD,
): boolean {
  return editableFocused && baselineHeight - currentHeight > threshold;
}

export function watchKeyboard(onChange: (open: boolean) => void, win: Window = window): () => void {
  const viewport = win.visualViewport;
  const height = () => viewport?.height ?? win.innerHeight;
  let baseline = height();
  let width = win.innerWidth;
  let open = false;

  const evaluate = () => {
    // A width change means rotation or a window resize: start a new baseline.
    if (win.innerWidth !== width) {
      width = win.innerWidth;
      baseline = height();
    }
    const focused = isEditable(win.document.activeElement);
    // Without a focused field the keyboard cannot be open, so this height is
    // the best baseline available.
    if (!focused) baseline = Math.max(baseline, height());
    const next = keyboardLikelyOpen(baseline, height(), focused);
    if (next !== open) {
      open = next;
      onChange(open);
    }
  };
  const deferred = () => setTimeout(evaluate, 50);

  const target: EventTarget = viewport ?? win;
  target.addEventListener("resize", evaluate);
  win.document.addEventListener("focusin", evaluate);
  win.document.addEventListener("focusout", deferred);
  return () => {
    target.removeEventListener("resize", evaluate);
    win.document.removeEventListener("focusin", evaluate);
    win.document.removeEventListener("focusout", deferred);
  };
}
