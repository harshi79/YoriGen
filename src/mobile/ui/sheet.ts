/**
 * Bottom sheets built on the native <dialog> element, so focus containment,
 * inert background and Escape handling come from the platform. Each open
 * sheet registers a Back layer, so Android Back closes the sheet first.
 */
import { X } from "lucide";
import type { BackDispatcher } from "../core/back";
import { h, icon, uniqueId, type Child } from "./dom";

export interface SheetOptions {
  title: string;
  description?: string;
  content?: Child[];
  /** Footer buttons; each receives a `close` callback. */
  actions?: (close: (result?: string) => void) => HTMLElement[];
}

export interface SheetHandle {
  readonly element: HTMLDialogElement;
  close(result?: string): void;
  /** Resolves with the result passed to `close`, or `undefined` when dismissed. */
  readonly closed: Promise<string | undefined>;
}

export function createSheets(host: HTMLElement, back: BackDispatcher) {
  function open(options: SheetOptions): SheetHandle {
    const titleId = uniqueId("sheet-title");
    const descriptionId = options.description ? uniqueId("sheet-desc") : undefined;
    let result: string | undefined;
    let resolveClosed!: (value: string | undefined) => void;
    const closed = new Promise<string | undefined>((resolve) => (resolveClosed = resolve));

    const dialog = h("dialog", {
      class: "sheet",
      "aria-labelledby": titleId,
      "aria-describedby": descriptionId,
    });
    const close = (value?: string) => {
      result = value;
      if (dialog.open) dialog.close();
    };
    const header = h(
      "div",
      { class: "sheet-header" },
      h("h2", { id: titleId, class: "sheet-title" }, options.title),
      h(
        "button",
        { type: "button", class: "icon-btn", "aria-label": "Close", onClick: () => close() },
        icon(X),
      ),
    );
    dialog.append(h("div", { class: "sheet-handle", "aria-hidden": "true" }), header);
    if (options.description) dialog.append(h("p", { id: descriptionId, class: "sheet-description" }, options.description));
    dialog.append(h("div", { class: "sheet-body" }, ...(options.content ?? [])));
    const actions = options.actions?.(close) ?? [];
    if (actions.length) dialog.append(h("div", { class: "sheet-actions" }, ...actions));

    // Backdrop taps are delivered to the dialog with coordinates outside its box.
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside =
        event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) close();
    });

    const removeBackLayer = back.push(() => {
      close();
      return true;
    });
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.addEventListener("close", () => {
      removeBackLayer();
      dialog.remove();
      previousFocus?.focus?.({ preventScroll: true });
      resolveClosed(result);
    });

    host.append(dialog);
    dialog.showModal();
    return { element: dialog, close, closed };
  }

  /** Two-button confirmation. Resolves `true` only for the confirm action. */
  async function confirm(options: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean> {
    const sheet = open({
      title: options.title,
      description: options.message,
      actions: (close) => [
        h("button", { type: "button", class: "btn btn-ghost", onClick: () => close("cancel") }, options.cancelLabel ?? "Cancel"),
        h(
          "button",
          {
            type: "button",
            class: options.destructive ? "btn btn-danger" : "btn btn-primary",
            "data-confirm": "true",
            onClick: () => close("confirm"),
          },
          options.confirmLabel,
        ),
      ],
    });
    return (await sheet.closed) === "confirm";
  }

  return { open, confirm };
}

export type Sheets = ReturnType<typeof createSheets>;
