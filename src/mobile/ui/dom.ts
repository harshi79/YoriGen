/**
 * Minimal DOM builder. Text is always assigned through text nodes, so values
 * from user input or API responses are never interpreted as HTML.
 */
import { createElement } from "lucide";

export type IconNode = Parameters<typeof createElement>[0];

type AttrValue = string | number | boolean | null | undefined;
type Listener = (event: Event) => void;
export type Attrs = { [key: string]: AttrValue | Listener };
export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value as Listener);
    } else if (value === true) {
      element.setAttribute(key, "");
    } else if (value !== false && value !== null && value !== undefined) {
      element.setAttribute(key, String(value));
    }
  }
  append(element, ...children);
  return element;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** Replaces every child of `parent`. */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

export function icon(node: IconNode, className = ""): SVGElement {
  const svg = createElement(node);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", `${svg.getAttribute("class") ?? ""} ${className}`.trim());
  return svg;
}

let uid = 0;
/** Unique, stable-per-session id for label/description wiring. */
export function uniqueId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Smooth scrolling, unless the user asked the system for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
