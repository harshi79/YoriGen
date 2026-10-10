import { Check, CircleAlert } from "lucide";
import { h, icon, replace } from "./dom";

export type ToastKind = "ok" | "error";

/**
 * Short feedback messages. The visible toast is decorative; announcements go
 * through a live region that stays in the accessibility tree, so screen
 * readers hear every message even though the toast itself comes and goes.
 */
export function createToaster(host: HTMLElement, durationMs = 3000) {
  const region = h("div", { class: "toast", "aria-hidden": "true", hidden: true });
  const live = h("div", { class: "visually-hidden", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  host.append(region, live);
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    element: region,
    live,
    show(message: string, kind: ToastKind = "ok") {
      if (timer) clearTimeout(timer);
      replace(region, icon(kind === "error" ? CircleAlert : Check), h("span", {}, message));
      region.classList.toggle("toast-error", kind === "error");
      region.hidden = false;
      live.textContent = message;
      timer = setTimeout(() => {
        region.hidden = true;
        live.textContent = "";
      }, kind === "error" ? durationMs + 1500 : durationMs);
    },
  };
}

export type Toaster = ReturnType<typeof createToaster>;
