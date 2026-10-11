import { ArrowUpRight, MessageCircle, Send, UsersRound } from "lucide";
import type { PlatformKind } from "../platform/types";
import { externalLinkAttrs } from "./components";
import { h, icon } from "./dom";
import type { Sheets } from "./sheet";

export const COMMUNITY_LINKS = {
  methods: "https://t.me/+y8EekRvqpnQzNjZl",
  chat: "https://t.me/+nzIAZDVK_61lZDQ9",
} as const;

/**
 * The launch prompt for the Yori community.
 *
 * The prompt is shown on every fresh app launch and its dismissal is never
 * persisted: one controller exists per app boot, so closing it dismisses it for
 * the rest of that session and the next cold start shows it again. Nothing here
 * reads the network, storage, a remote flag or a signed-in user — the decision
 * to show it is purely local startup logic.
 *
 * "Session" means one live app process. Backgrounding the app and returning to
 * it from Recents keeps the same process (and therefore the same controller),
 * so the prompt does not reopen; Android starting a new process does.
 */
export function createCommunityPrompt(sheets: Sheets, kind: PlatformKind) {
  let attempted = false;

  return {
    /** Opens the prompt once per app boot. Safe to call repeatedly. */
    showIfNeeded() {
      // One prompt per launch: navigation, remounts and re-renders never reopen it.
      if (attempted) return;
      attempted = true;

      const invite = (href: string, label: string, description: string, symbol: typeof Send, style: string) =>
        h(
          "a",
          {
            class: `community-invite ${style}`,
            href,
            // See externalLinkAttrs. If nothing on the device can handle the
            // URL, Capacitor drops it and the shell stays usable.
            ...externalLinkAttrs(kind),
            onClick: () => {
              // Let the anchor's native navigation start before removing it.
              setTimeout(() => sheet.close(), 0);
            },
          },
          h("span", { class: "community-invite-icon" }, icon(symbol)),
          h("span", { class: "community-invite-copy" }, h("strong", {}, label), h("small", {}, description)),
          icon(ArrowUpRight),
        );

      const sheet = sheets.open({
        title: "Join the Yori Community",
        description: "YoriMethods posts updates and methods. The chat group is for questions and support.",
        content: [
          h("div", { class: "community-emblem", "aria-hidden": "true" }, icon(Send)),
          h(
            "div",
            { class: "community-invites" },
            invite(COMMUNITY_LINKS.methods, "Join YoriMethods", "Updates and methods", Send, "community-invite-primary"),
            invite(COMMUNITY_LINKS.chat, "Join Chat Group", "Questions and support", MessageCircle, "community-invite-secondary"),
          ),
          h("p", { class: "community-note" }, icon(UsersRound), "Opens outside ORIGEN. No Telegram account is needed to keep using the app."),
        ],
        actions: (close) => [h("button", { type: "button", class: "btn btn-ghost community-later", onClick: () => close() }, "Maybe later")],
      });
      sheet.element.classList.add("community-dialog");
      // Closing by any route (X, Maybe later, backdrop, Escape, Android Back)
      // dismisses the prompt for this session; choosing an invite does too.
      return sheet;
    },
  };
}
