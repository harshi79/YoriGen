# Adding a tool to the Android app

Every screen in the mobile app is a **tool** registered in a single registry.
The shell builds the bottom navigation, app bar title, routing, Back handling,
error containment and offline indicator from the registry, so a new tool
supplies only its own content.

## 1. Write the tool

Create `src/mobile/tools/<id>.ts` exporting a `ToolDefinition`:

| Field | Purpose |
| --- | --- |
| `id` | 2–32 lowercase letters, digits or hyphens, starting with a letter. Used in the route (`#/<id>`) and DOM. |
| `navLabel` | Short bottom-bar label (keep it to one short word). |
| `title` | App bar title while the tool is active. |
| `description` | One line, shown in Settings and used for accessibility. |
| `icon` | A [Lucide](https://lucide.dev/icons/) icon node imported from `lucide`. |
| `network` | `"none"` for fully local tools, `"required"` if the main action needs a remote service. |
| `create(context)` | Builds the screen once, on first visit. Returns a `ToolScreen`. |

A complete, working example:

```ts
import { Fingerprint, RefreshCw } from "lucide";
import type { ToolDefinition, ToolScreen } from "../core/registry";
import type { ToolContext } from "../core/context";
import { button, card, emptyState } from "../ui/components";
import { h, replace } from "../ui/dom";

function createUuidScreen(context: ToolContext): ToolScreen {
  const output = h("div", { id: "uuid-output" });
  let values: string[] = [];

  function render() {
    replace(
      output,
      values.length
        ? h("ol", { class: "guide" }, ...values.map((value) => h("li", {}, value)))
        : emptyState({
            iconNode: Fingerprint,
            title: "No IDs yet",
            body: "Generate random v4 UUIDs on this device.",
          }),
    );
  }

  const root = h(
    "div",
    { class: "screen", "data-tool": "uuid" },
    h(
      "div",
      { class: "screen-scroll" },
      card(
        { title: "UUIDs", iconNode: Fingerprint },
        button({
          label: "Generate 5",
          iconNode: RefreshCw,
          id: "uuid-generate",
          onClick: () => {
            values = Array.from({ length: 5 }, () => crypto.randomUUID());
            render();
          },
        }),
        button({
          label: "Copy all",
          variant: "secondary",
          onClick: () => void context.ui.copy(values.join("\n"), "UUIDs copied"),
        }),
        output,
      ),
    ),
  );

  // Settings → "Clear session history" reaches every tool through this event.
  context.events.on("session:clear", () => {
    const removed = values.length;
    values = [];
    render();
    return removed;
  });

  render();
  return { root };
}

export const uuidTool: ToolDefinition = {
  id: "uuid",
  navLabel: "UUID",
  title: "UUID Generator",
  description: "Random v4 UUIDs, generated on the device.",
  icon: Fingerprint,
  network: "none",
  create: createUuidScreen,
};
```

`create` runs once per app session. The returned screen stays mounted when the
user switches tabs, so state kept in the closure (and the DOM) survives
navigation without any extra work.

## 2. Register it

Add it to `createDefaultRegistry()` in `src/mobile/tools/index.ts`. Registration
order is navigation order:

```ts
return new ToolRegistry()
  .register(generatorTool)
  .register(lookupTool)
  .register(sorterTool)
  .register(uuidTool)
  .register(settingsTool);
```

The registry rejects duplicate or malformed ids and empty labels at startup.
The bottom bar fits five destinations comfortably on a 320 px screen; beyond
that, group related tools rather than adding more tabs.

## 3. Use the shell's services, not globals

Everything a tool needs arrives on the `ToolContext`:

| Need | Use |
| --- | --- |
| Feedback | `context.ui.toast(message, kind)` |
| Confirmation before destructive actions | `await context.ui.sheets.confirm({ title, message, confirmLabel })` |
| Copy to clipboard (with toast) | `context.ui.copy(text, successMessage)` |
| Save/share a file (share sheet on Android, download in a browser) | `context.ui.exportFile({ filename, mime, content }, successMessage)` |
| Persisted settings | `context.platform.storage` (Capacitor Preferences on Android). Store only non-sensitive preferences. |
| Online state | `context.platform.network.isOnline()` / `.subscribe(listener)` |
| Back action | Implement `handleBack()` on the screen (below), or `context.back.push(handler)` for temporary layers; it returns a remover. |
| "Clear session history" in Settings | `context.events.on("session:clear", handler)`; return how many items were removed. |
| Switch tool | `context.navigate(id)` |
| BIN metadata | `context.binService.lookup(bin, signal)` — handles offline, timeout, retry and cancellation. |

Do not import `@capacitor/*` in a tool. Platform access goes through
`src/mobile/platform/`, which has both a Capacitor and a browser
implementation, so tools run unchanged in the app, in `npm run dev:mobile` and in
unit tests.

## 4. Optional screen hooks

| Hook | When it runs |
| --- | --- |
| `activate()` | Each time the tool becomes visible. |
| `deactivate()` | When another tool replaces it. |
| `handleBack()` | On Android Back while the tool is active. Return `true` if the tool consumed it (for example, to close a results view); return `false` to let the shell navigate. |
| `reselect()` | When the user taps the tool's tab while already on it. Conventionally scrolls to the top. |

Errors thrown by `create` are contained by the shell: the tool shows a
"Reload tool" state and the rest of the app keeps working.

## 5. Follow the mobile conventions

- Root element: `div.screen[data-tool="<id>"]` containing one `div.screen-scroll`.
- Build UI with the helpers in `src/mobile/ui/` (`card`, `button`, `field`,
  `segmented`, `toggle`, `emptyState`, `errorState`) so touch targets (at least
  44 px), spacing and themes stay consistent.
- Prefix element ids with the tool id (`uuid-generate`).
- Use `scrollBehavior()` from `ui/dom` for programmatic scrolling so reduced
  motion is respected.
- Keep logic that does not touch the DOM in plain modules (see
  `src/mobile/logic/`) so it can be unit tested without a browser.
- A tool with `network: "required"` must say clearly when it is offline and
  must never fabricate results.

## 6. Test it

Unit tests use happy-dom and the shared helpers in `src/mobile/test-support.ts`,
which mount the real shell over in-memory platform fakes:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../core/registry";
import { $, bootShell } from "../test-support";
import { uuidTool } from "./uuid";

describe("UUID tool", () => {
  it("generates five UUIDs", () => {
    const registry = new ToolRegistry().register(uuidTool);
    bootShell({ registry, startId: "uuid" });
    $<HTMLButtonElement>("#uuid-generate").click();
    expect(document.querySelectorAll("#uuid-output li")).toHaveLength(5);
  });
});
```

Run `npm test`, then `npm run test:e2e:android` to check the tool in the
production mobile bundle at phone size. Finally, `npm run android:sync` copies
the new build into the Android project.
