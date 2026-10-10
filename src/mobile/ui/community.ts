import { ArrowUpRight, MessageCircle, Send, UsersRound } from "lucide";
import type { KeyValueStorage, PlatformKind } from "../platform/types";
import { h, icon } from "./dom";
import type { Sheets } from "./sheet";

export const COMMUNITY_LINKS = {
  methods: "https://t.me/+y8EekRvqpnQzNjZl",
  chat: "https://t.me/+nzIAZDVK_61lZDQ9",
} as const;
const DISMISSED_KEY = "community.dismissed.v1";

/** One controller per app boot. Navigating or remounting a screen never reopens it. */
export function createCommunityPrompt(storage: KeyValueStorage, sheets: Sheets, kind: PlatformKind) {
  let attempted = false;

  return {
    async showIfNeeded() {
      if (attempted) return;
      attempted = true;
      try {
        if ((await storage.get(DISMISSED_KEY)) === "true") return;
      } catch {
        // An unavailable preference store must never hold up the app.
      }

      let dismissed = false;
      const remember = () => {
        if (dismissed) return;
        dismissed = true;
        void storage.set(DISMISSED_KEY, "true").catch(() => {
          // This launch is still dismissed, even when persistence is unavailable.
        });
      };
      const invite = (href: string, label: string, description: string, symbol: typeof Send, style: string) =>
        h(
          "a",
          {
            class: `community-invite ${style}`,
            href,
            // Android's Capacitor WebView intercepts same-window HTTPS navigation
            // with ACTION_VIEW (Telegram if installed, otherwise a browser).
            // Browser previews open a separate tab rather than leaving the tools.
            ...(kind === "web" ? { target: "_blank", rel: "noopener noreferrer" } : {}),
            onClick: () => {
              remember();
              // Let the anchor's native navigation run before removing it.
              setTimeout(() => sheet.close(), 0);
            },
          },
          h("span", { class: "community-invite-icon" }, icon(symbol)),
          h("span", { class: "community-invite-copy" }, h("strong", {}, label), h("small", {}, description)),
          icon(ArrowUpRight),
        );

      const sheet = sheets.open({
        title: "Join the Yori Community",
        description: "Explore YoriMethods for updates and ideas, or join the chat to connect with the community.",
        content: [
          h("div", { class: "community-emblem", "aria-hidden": "true" }, icon(Send)),
          h("p", { class: "eyebrow community-eyebrow" }, "Find your people"),
          h(
            "div",
            { class: "community-invites" },
            invite(COMMUNITY_LINKS.methods, "Join YoriMethods", "News, methods & inspiration", Send, "community-invite-primary"),
            invite(COMMUNITY_LINKS.chat, "Join Chat Group", "Questions, conversation & support", MessageCircle, "community-invite-secondary"),
          ),
          h("p", { class: "community-note" }, icon(UsersRound), "Opens outside ORIGEN · No account required to keep using the app"),
        ],
        actions: (close) => [h("button", { type: "button", class: "btn btn-ghost community-later", onClick: () => close() }, "Maybe later")],
      });
      sheet.element.classList.add("community-dialog");
      // The close button, Maybe later, backdrop, Escape and Android Back all
      // resolve the same sheet.closed promise and count as a dismissal.
      void sheet.closed.then(remember);
    },
  };
}
