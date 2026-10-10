/**
 * Shared building blocks for tool screens, so every tool gets the same
 * spacing, touch targets, empty/error states and accessibility wiring.
 */
import { CircleAlert, RefreshCw } from "lucide";
import { h, icon, uniqueId, type Child, type IconNode } from "./dom";

export function card(options: { title?: string; badge?: string; className?: string; iconNode?: IconNode }, ...children: Child[]) {
  const headingId = options.title ? uniqueId("card") : undefined;
  return h(
    "section",
    { class: `card ${options.className ?? ""}`.trim(), "aria-labelledby": headingId },
    options.title
      ? h(
          "div",
          { class: "card-head" },
          h("h2", { id: headingId, class: "card-title" }, options.iconNode ? icon(options.iconNode) : null, options.title),
          options.badge ? h("span", { class: "badge" }, options.badge) : null,
        )
      : null,
    ...children,
  );
}

export interface Segment<T extends string> {
  value: T;
  label: string;
}

/** Mutually exclusive choice rendered as a row of toggle buttons. */
export function segmented<T extends string>(options: {
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  id?: string;
}) {
  let current = options.value;
  const buttons = options.segments.map((segment) =>
    h(
      "button",
      {
        type: "button",
        class: "segment",
        "data-value": segment.value,
        "aria-pressed": String(segment.value === current),
        onClick: () => set(segment.value, true),
      },
      segment.label,
    ),
  );
  const group = h("div", { class: "segmented", role: "group", "aria-label": options.label, id: options.id }, ...buttons);
  function set(value: T, notify = false) {
    if (value === current && notify) return;
    current = value;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.value === value));
    if (notify) options.onChange(value);
  }
  return {
    element: group,
    get value() {
      return current;
    },
    set,
  };
}

/** Accessible on/off switch (a checkbox with role="switch"). */
export function toggle(options: { label: string; checked?: boolean; onChange: (checked: boolean) => void; id?: string }) {
  const id = options.id ?? uniqueId("switch");
  const input = h("input", {
    type: "checkbox",
    role: "switch",
    id,
    class: "switch-input",
    checked: options.checked ?? false,
    onChange: () => options.onChange(input.checked),
  });
  const element = h(
    "label",
    { class: "switch", for: id },
    input,
    h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-thumb" })),
    h("span", { class: "switch-label" }, options.label),
  );
  return { element, input };
}

/** Field wrapper with a label, optional hint and an error slot. */
export function field(options: { label: string; control: HTMLElement; hint?: string; controlId: string; inline?: Child }) {
  const hintId = `${options.controlId}-hint`;
  const errorId = `${options.controlId}-error`;
  const hint = h("p", { class: "hint", id: hintId }, options.hint ?? "");
  hint.hidden = !options.hint;
  const error = h("p", { class: "field-error", id: errorId, role: "alert", hidden: true });
  options.control.setAttribute(
    "aria-describedby",
    [options.control.getAttribute("aria-describedby"), hintId, errorId].filter(Boolean).join(" "),
  );
  const element = h(
    "div",
    { class: "field" },
    h("label", { class: "field-label", for: options.controlId }, options.label),
    options.inline ? h("div", { class: "field-row" }, options.control, options.inline) : options.control,
    hint,
    error,
  );
  return {
    element,
    hint,
    setError(message: string | undefined) {
      error.textContent = message ?? "";
      error.hidden = !message;
      if (message) options.control.setAttribute("aria-invalid", "true");
      else options.control.removeAttribute("aria-invalid");
    },
  };
}

export function selectControl<T extends string>(id: string, choices: readonly { value: T; label: string }[], value: T) {
  return h(
    "select",
    { id, class: "control" },
    ...choices.map((choice) => h("option", { value: choice.value, selected: choice.value === value }, choice.label)),
  );
}

export function emptyState(options: { iconNode: IconNode; title: string; body: string; action?: HTMLElement; eyebrow?: string }) {
  return h(
    "div",
    { class: "state state-empty" },
    h("div", { class: "state-icon" }, icon(options.iconNode)),
    options.eyebrow ? h("span", { class: "eyebrow" }, options.eyebrow) : null,
    h("h3", { class: "state-title" }, options.title),
    h("p", { class: "state-body" }, options.body),
    options.action ?? null,
  );
}

export function errorState(options: { title: string; message: string; onRetry?: () => void; retryLabel?: string }) {
  return h(
    "div",
    { class: "state state-error", role: "alert" },
    h("div", { class: "state-icon" }, icon(CircleAlert)),
    h("h3", { class: "state-title" }, options.title),
    h("p", { class: "state-body" }, options.message),
    options.onRetry
      ? h("button", { type: "button", class: "btn btn-secondary", onClick: options.onRetry }, icon(RefreshCw), options.retryLabel ?? "Try again")
      : null,
  );
}

export function button(options: { label: string; iconNode?: IconNode; variant?: "primary" | "secondary" | "ghost" | "danger"; onClick: () => void; id?: string; ariaLabel?: string; className?: string }) {
  return h(
    "button",
    {
      type: "button",
      id: options.id,
      class: `btn btn-${options.variant ?? "secondary"} ${options.className ?? ""}`.trim(),
      "aria-label": options.ariaLabel,
      onClick: options.onClick,
    },
    options.iconNode ? icon(options.iconNode) : null,
    h("span", {}, options.label),
  );
}

export function iconButton(options: { label: string; iconNode: IconNode; onClick: () => void; className?: string }) {
  return h(
    "button",
    { type: "button", class: `icon-btn ${options.className ?? ""}`.trim(), "aria-label": options.label, title: options.label, onClick: options.onClick },
    icon(options.iconNode),
  );
}
