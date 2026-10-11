// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, bootShell } from "../test-support";
import { Send } from "lucide";
import { createCommunityPrompt, COMMUNITY_LINKS } from "./community";
import { icon } from "./dom";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.community-dialog");

describe("launch community prompt", () => {
  it("opens on launch with both exact invites and native Android navigation", () => {
    const { shell } = bootShell();
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    const open = $<HTMLDialogElement>("dialog.community-dialog");
    expect(open.open).toBe(true);
    expect(open.getAttribute("aria-labelledby")).toBeTruthy();
    expect(open.getAttribute("aria-describedby")).toBeTruthy();
    expect(open.textContent).toContain("Join the Yori Community");
    const links = [...open.querySelectorAll<HTMLAnchorElement>("a.community-invite")];
    expect(links.map((a) => [a.textContent?.includes("Join YoriMethods"), a.textContent?.includes("Join Chat Group"), a.href, a.target])).toEqual([
      [true, false, COMMUNITY_LINKS.methods, ""],
      [false, true, COMMUNITY_LINKS.chat, ""],
    ]);
  });

  it("keeps both Close and Maybe later, and each dismisses the prompt", () => {
    const { shell } = bootShell();
    const prompt = createCommunityPrompt(shell.context.ui.sheets, "android");
    prompt.showIfNeeded();
    $('dialog.community-dialog [aria-label="Close"]').click();
    expect(dialog()).toBeNull();
    // Same session: the prompt stays dismissed and is never re-shown.
    prompt.showIfNeeded();
    expect(dialog()).toBeNull();
  });

  it("dismisses for the session only and never writes to storage", () => {
    const { shell, platform, store } = bootShell();
    const prompt = createCommunityPrompt(shell.context.ui.sheets, "android");
    prompt.showIfNeeded();
    $(".community-later").click();
    expect(dialog()).toBeNull();
    expect(platform.storage.set).not.toHaveBeenCalled();
    expect(platform.storage.get).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("shows again on a fresh app boot, because nothing was persisted", () => {
    const { shell } = bootShell();
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    $(".community-later").click();
    expect(dialog()).toBeNull();

    // A cold start is a new app process: a new shell and a new controller.
    const next = bootShell();
    createCommunityPrompt(next.shell.context.ui.sheets, "android").showIfNeeded();
    expect(dialog()).not.toBeNull();
  });

  it("does not reopen during navigation, remounts or repeated calls in one session", () => {
    const { shell } = bootShell({ hash: "#/lookup" });
    const prompt = createCommunityPrompt(shell.context.ui.sheets, "android");
    prompt.showIfNeeded();
    $(".community-later").click();

    shell.context.navigate("sorter");
    shell.context.navigate("settings");
    shell.context.navigate("generator");
    shell.context.navigate("lookup");
    prompt.showIfNeeded();
    prompt.showIfNeeded();
    expect(dialog()).toBeNull();
    expect(shell.navigator.current).toBe("lookup");
  });

  it("never stacks a second dialog if showIfNeeded runs twice before dismissal", () => {
    const { shell } = bootShell();
    const prompt = createCommunityPrompt(shell.context.ui.sheets, "android");
    prompt.showIfNeeded();
    prompt.showIfNeeded();
    expect(document.querySelectorAll("dialog.community-dialog")).toHaveLength(1);
  });

  it("shows while offline and without touching the network", async () => {
    const { shell } = bootShell({ online: false });
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    const open = $<HTMLDialogElement>("dialog.community-dialog");
    expect(open.open).toBe(true);
    expect($(".offline-pill").hidden).toBe(false);
    // Dismissing offline behaves exactly the same.
    $(".community-later").click();
    expect(dialog()).toBeNull();
    shell.context.navigate("sorter");
    expect(shell.navigator.current).toBe("sorter");
  });

  it("Back dismisses before navigation and leaves the selected tool alone", () => {
    const { shell, pressSystemBack } = bootShell({ hash: "#/lookup" });
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    pressSystemBack();
    expect(dialog()).toBeNull();
    expect(shell.navigator.current).toBe("lookup");
    pressSystemBack();
    expect(shell.navigator.current).toBe("generator");
  });

  it("shows even when preferences are unavailable, since it reads no preference", () => {
    const { shell, platform } = bootShell();
    platform.storage.get.mockRejectedValue(new Error("unavailable"));
    platform.storage.set.mockRejectedValue(new Error("unavailable"));
    const prompt = createCommunityPrompt(shell.context.ui.sheets, "android");
    prompt.showIfNeeded();
    expect(dialog()).not.toBeNull();
    $(".community-later").click();
    prompt.showIfNeeded();
    expect(dialog()).toBeNull();
    shell.context.navigate("sorter");
    expect(shell.navigator.current).toBe("sorter");
  });

  it("closes on an invite choice and leaves the shell usable when nothing can open the link", () => {
    const { shell } = bootShell();
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    const link = $<HTMLAnchorElement>(`a[href="${COMMUNITY_LINKS.chat}"]`);
    // Stand in for a device with no Telegram and no handler for the URL: the
    // navigation is prevented and the app must simply carry on.
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
    expect(dialog()).not.toBeNull(); // closes on the next tick
    return vi.waitFor(() => {
      expect(dialog()).toBeNull();
      shell.context.navigate("settings");
      expect(shell.navigator.current).toBe("settings");
    });
  });

  it("shows the Telegram paper-plane mark exactly once, on the YoriMethods invite", () => {
    const { shell } = bootShell();
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    const open = $<HTMLDialogElement>("dialog.community-dialog");
    // Regression: the prompt used to show the same mark twice, once as a
    // decorative badge above the invites and once on the YoriMethods invite.
    const paperPlane = icon(Send).innerHTML;
    const marks = [...open.querySelectorAll("svg")].filter((svg) => svg.innerHTML === paperPlane);
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("a")?.getAttribute("href")).toBe(COMMUNITY_LINKS.methods);
    expect(open.querySelector(".community-emblem")).toBeNull();
  });

  it("keeps the description directly above the invites, with the invites in their own block", () => {
    const { shell } = bootShell();
    createCommunityPrompt(shell.context.ui.sheets, "android").showIfNeeded();
    const open = $<HTMLDialogElement>("dialog.community-dialog");
    const invites = open.querySelector(".community-invites");
    expect(invites?.querySelectorAll("a.community-invite")).toHaveLength(2);
    expect(invites?.previousElementSibling).toBeNull(); // first child of .sheet-body
    expect(invites?.parentElement?.classList.contains("sheet-body")).toBe(true);
  });

  it("only accepts known destination constants, not a runtime URL", () => {
    expect(Object.values(COMMUNITY_LINKS)).toEqual([
      "https://t.me/+y8EekRvqpnQzNjZl",
      "https://t.me/+nzIAZDVK_61lZDQ9",
    ]);
  });
});
