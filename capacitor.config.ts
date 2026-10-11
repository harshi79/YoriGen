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
  /**
   * "debug" here means "log only in a debuggable build", not "log verbosely":
   * Capacitor resolves it to `loggingEnabled = isDebug`, so a release APK logs
   * nothing. Do not change it to "production" — that name is misleading and
   * forces logging ON in release, where Capacitor's verbose bridge log includes
   * every plugin call's arguments, which for this app means clipboard text and
   * exported file contents landing in logcat.
   */
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
