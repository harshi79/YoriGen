/**
 * Build-time configuration for the mobile app. Nothing here is secret: the
 * BIN metadata service is public and unauthenticated, so no credentials are
 * ever compiled into the APK.
 */
import { GUISON_ORIGIN } from "../guison";

export interface AppConfig {
  readonly appName: string;
  readonly version: string;
  /** HTTPS origin of the Guison-compatible BIN metadata service. */
  readonly binApiOrigin: string;
  readonly binApiLabel: string;
  readonly communityUrl: string;
}

/** Accepts only a bare HTTPS origin; anything else falls back to the default. */
export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createConfig(env: { VITE_ORIGEN_BIN_API_ORIGIN?: string } = {}, version = "0.0.0-dev"): AppConfig {
  const origin = normalizeOrigin(env.VITE_ORIGEN_BIN_API_ORIGIN) ?? GUISON_ORIGIN;
  return {
    appName: "ORIGEN",
    version,
    binApiOrigin: origin,
    binApiLabel: origin === GUISON_ORIGIN ? "Guison API" : new URL(origin).host,
    communityUrl: "https://t.me/+y8EekRvqpnQzNjZl",
  };
}

export const appConfig: AppConfig = createConfig(
  import.meta.env,
  typeof __ORIGEN_VERSION__ === "string" ? __ORIGEN_VERSION__ : "0.0.0-dev",
);
