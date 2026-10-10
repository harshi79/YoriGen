import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the ORIGEN Android app.
 *
 * The Android build bundles `dist-android/` (produced by `npm run build:mobile`)
 * into the APK, so the app shell never depends on a hosted website.
 */
const config: CapacitorConfig = {
  appId: "io.github.harshi79.origen",
  appName: "ORIGEN",
  webDir: "dist-android",
  backgroundColor: "#101210",
  loggingBehavior: "debug",
  android: {
    allowMixedContent: false,
    captureInput: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
    },
  },
};

export default config;
