import { Capacitor } from "@capacitor/core";
import { createCapacitorPlatform } from "./capacitor";
import { createWebPlatform } from "./web";
import type { AppInfo, PlatformServices } from "./types";

export type { PlatformServices } from "./types";

/** Native services inside the Android app, browser services everywhere else. */
export function createPlatform(info: AppInfo): PlatformServices {
  return Capacitor.isNativePlatform() ? createCapacitorPlatform(info) : createWebPlatform(info);
}
