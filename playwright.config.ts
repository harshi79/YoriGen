import { defineConfig } from "@playwright/test";
import process from "node:process";

const launchOptions = process.env.CHROMIUM_PATH
  ? {
      executablePath: process.env.CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
    }
  : {};

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    launchOptions,
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
    },
    {
      // The Android project tests the production mobile bundle, the same
      // files `cap sync` copies into the APK (CSP included).
      command: "npm run build:mobile && npm run preview:mobile",
      url: "http://localhost:4174",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "narrow", testIgnore: "android/**", use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "tablet", testIgnore: "android/**", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", testIgnore: "android/**", use: { viewport: { width: 1440, height: 1100 } } },
    {
      name: "mobile",
      testIgnore: "android/**",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "android",
      testMatch: "android/**/*.spec.ts",
      use: {
        baseURL: "http://localhost:4174",
        // Pixel 7 class device.
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      },
    },
  ],
});
