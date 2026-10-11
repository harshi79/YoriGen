/**
 * Built-in tools, in navigation order. To add a tool, create a module that
 * exports a ToolDefinition and register it here.
 */
import { ToolRegistry } from "../core/registry";
import { generatorTool } from "./generator";
import { helpTool } from "./help";
import { lookupTool } from "./lookup";
import { settingsTool } from "./settings";
import { sorterTool } from "./sorter";

export const START_TOOL = generatorTool.id;

/**
 * Registration order is navigation order. `helpTool` is nav-hidden, so it is
 * routable and reachable from Settings without claiming a bottom-navigation tab.
 */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(generatorTool)
    .register(lookupTool)
    .register(sorterTool)
    .register(settingsTool)
    .register(helpTool);
}
