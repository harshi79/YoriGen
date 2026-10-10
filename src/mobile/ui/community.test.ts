// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, bootShell } from "../test-support";
import { createCommunityPrompt, COMMUNITY_LINKS } from "./community";

const key = "community.dismissed.v1";
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("first-launch community prompt", () => {
  it("uses the exact HTTPS invites, native Android navigation and both close paths", async () => {
    const { shell, platform, store } = bootShell();
    const prompt = createCommunityPrompt(platform.storage, shell.context.ui.sheets, "android");
    await prompt.showIfNeeded();
    const dialog = $<HTMLDialogElement>("dialog.community-dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.textContent).toContain("Join the Yori Community");
    const links = [...dialog.querySelectorAll<HTMLAnchorElement>("a.community-invite")];
    expect(links.map((a) => [a.textContent?.includes("Join YoriMethods"), a.textContent?.includes("Join Chat Group"), a.href, a.target])).toEqual([
      [true, false, COMMUNITY_LINKS.methods, ""],
      [false, true, COMMUNITY_LINKS.chat, ""],
    ]);
    dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
    await vi.waitFor(() => expect(store.get(key)).toBe("true"));
    await prompt.showIfNeeded();
    expect(document.querySelector("dialog.community-dialog")).toBeNull();
    expect(shell.navigator.current).toBe("generator");
  });

  it("remembers Maybe later across fresh app boots and does not reappear on navigation", async () => {
    const { shell, platform, store } = bootShell();
    await createCommunityPrompt(platform.storage, shell.context.ui.sheets, "web").showIfNeeded();
    expect($<HTMLAnchorElement>(`a[href="${COMMUNITY_LINKS.methods}"]`).target).toBe("_blank");
    expect($<HTMLAnchorElement>(`a[href="${COMMUNITY_LINKS.chat}"]`).rel).toBe("noopener noreferrer");
    $(".community-later").click();
    await vi.waitFor(() => expect(store.get(key)).toBe("true"));
    shell.context.navigate("sorter");
    shell.context.navigate("generator");
    expect(document.querySelector("dialog.community-dialog")).toBeNull();
    const { shell: nextShell, platform: nextPlatform } = bootShell();
    nextPlatform.storage.get.mockResolvedValue("true");
    await createCommunityPrompt(nextPlatform.storage, nextShell.context.ui.sheets, "android").showIfNeeded();
    expect(document.querySelector("dialog.community-dialog")).toBeNull();
  });

  it("Back dismisses before navigation and stores the choice", async () => {
    const { shell, platform, pressSystemBack } = bootShell({ hash: "#/lookup" });
    await createCommunityPrompt(platform.storage, shell.context.ui.sheets, "android").showIfNeeded();
    pressSystemBack();
    await vi.waitFor(() => expect(platform.storage.set).toHaveBeenCalledWith(key, "true"));
    expect(shell.navigator.current).toBe("lookup");
    pressSystemBack();
    expect(shell.navigator.current).toBe("generator");
  });

  it("keeps the shell usable if reading or writing preferences fails", async () => {
    const { shell, platform } = bootShell();
    platform.storage.get.mockRejectedValue(new Error("unavailable"));
    platform.storage.set.mockRejectedValue(new Error("unavailable"));
    const prompt = createCommunityPrompt(platform.storage, shell.context.ui.sheets, "android");
    await expect(prompt.showIfNeeded()).resolves.toBeUndefined();
    $(".community-later").click();
    await prompt.showIfNeeded();
    expect(document.querySelector("dialog.community-dialog")).toBeNull();
    shell.context.navigate("sorter");
    expect(shell.navigator.current).toBe("sorter");
  });

  it("marks an invite choice dismissed before the external navigation", async () => {
    const { shell, platform, store } = bootShell();
    await createCommunityPrompt(platform.storage, shell.context.ui.sheets, "android").showIfNeeded();
    const link = $<HTMLAnchorElement>(`a[href="${COMMUNITY_LINKS.chat}"]`);
    link.addEventListener("click", (event) => event.preventDefault()); // no navigation in the DOM test
    link.click();
    expect(platform.storage.set).toHaveBeenCalledWith(key, "true");
    await vi.waitFor(() => expect(document.querySelector("dialog.community-dialog")).toBeNull());
    expect(store.get(key)).toBe("true");
  });

  it("only accepts known destination constants, not a runtime URL", () => {
    expect(Object.values(COMMUNITY_LINKS)).toEqual([
      "https://t.me/+y8EekRvqpnQzNjZl",
      "https://t.me/+nzIAZDVK_61lZDQ9",
    ]);
  });
});
