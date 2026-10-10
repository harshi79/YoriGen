/**
 * Built-in tools, in navigation order. To add a tool, create a module that
 * exports a ToolDefinition and register it here.
 */
import { ToolRegistry } from "../core/registry";
import { generatorTool } from "./generator";
import { lookupTool } from "./lookup";
import { settingsTool } from "./settings";
import { sorterTool } from "./sorter";

export const START_TOOL = generatorTool.id;

export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry().register(generatorTool).register(lookupTool).register(sorterTool).register(settingsTool);
}
