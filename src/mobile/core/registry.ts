/**
 * Tool registry for the ORIGEN mobile shell.
 *
 * Each tool describes itself once (id, labels, icon, network needs) and
 * provides a factory that builds its screen. The shell owns navigation,
 * layout, storage and error presentation, so a tool only renders its own
 * content and talks to the shared services it is handed.
 */
import type { IconNode } from "../ui/dom";
import type { ToolContext } from "./context";

/**
 * How a tool relates to the network:
 * - `none`: fully local, always available offline.
 * - `required`: needs a remote service for its main action.
 */
export type NetworkRequirement = "none" | "required";

export interface ToolScreen {
  /** Root element mounted into the shell's screen host. */
  readonly root: HTMLElement;
  /** Called every time the tool becomes the visible destination. */
  activate?(): void;
  /** Called when another destination replaces this tool. */
  deactivate?(): void;
  /**
   * Gives the tool first refusal on the system Back action. Return `true`
   * when the tool consumed it (for example to leave a results view).
   */
  handleBack?(): boolean;
  /** Called when the user taps the already-active navigation item. */
  reselect?(): void;
}

export interface ToolDefinition {
  /** Stable, URL-safe identifier used for routing and storage keys. */
  readonly id: string;
  /** Short label shown in the bottom navigation bar. */
  readonly navLabel: string;
  /** Title shown in the app bar while the tool is active. */
  readonly title: string;
  /** One-line description used for accessibility and Settings. */
  readonly description: string;
  readonly icon: IconNode;
  readonly network: NetworkRequirement;
  /**
   * Reachable by routing and Back handling, but not shown in the bottom
   * navigation. Use for supporting screens such as Help, which are opened from
   * another screen rather than competing for a permanent tab.
   */
  readonly navHidden?: boolean;
  /** Builds the screen. Called lazily, at most once per app session. */
  create(context: ToolContext): ToolScreen;
}

const TOOL_ID = /^[a-z][a-z0-9-]{1,31}$/;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (!TOOL_ID.test(tool.id))
      throw new Error(
        `Tool id "${tool.id}" must be 2–32 lowercase letters, digits or hyphens, starting with a letter.`,
      );
    if (this.tools.has(tool.id))
      throw new Error(`A tool with id "${tool.id}" is already registered.`);
    if (!tool.navLabel.trim() || !tool.title.trim())
      throw new Error(`Tool "${tool.id}" needs a navigation label and a title.`);
    this.tools.set(tool.id, Object.freeze({ ...tool }));
    return this;
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  get(id: string): ToolDefinition {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Unknown tool "${id}".`);
    return tool;
  }

  /** Tools in registration order, which is also the navigation order. */
  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Destinations shown in the bottom navigation, in navigation order. */
  navList(): readonly ToolDefinition[] {
    return this.list().filter((tool) => !tool.navHidden);
  }

  ids(): string[] {
    return [...this.tools.keys()];
  }
}
