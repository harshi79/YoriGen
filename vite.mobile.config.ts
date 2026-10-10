/**
 * Build for the Android app (Capacitor webDir: dist-android/).
 *
 * The web product keeps using vite.config.ts and index.html; this config only
 * bundles the mobile shell from mobile/index.html.
 *
 *   npm run dev:mobile     # browser preview of the mobile UI on :5174
 *   npm run build:mobile   # production bundle for `cap sync android`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const DEFAULT_BIN_API_ORIGIN = "https://guison-api.onrender.com";

function binApiOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_BIN_API_ORIGIN;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash)
    throw new Error("VITE_ORIGEN_BIN_API_ORIGIN must be a bare https:// origin, e.g. https://bin.example.com");
  return url.origin;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "VITE_");
  const connectOrigin = binApiOrigin(env.VITE_ORIGEN_BIN_API_ORIGIN);
  return {
    root: "mobile",
    base: "./",
    publicDir: fileURLToPath(new URL("./public", import.meta.url)),
    envDir: root,
    define: { __ORIGEN_VERSION__: JSON.stringify(pkg.version) },
    server: { host: "0.0.0.0", port: 5174, strictPort: true, allowedHosts: [".e2b.app"], fs: { allow: [root] } },
    preview: { host: "0.0.0.0", port: 4174, strictPort: true, allowedHosts: [".e2b.app"] },
    build: {
      outDir: fileURLToPath(new URL("./dist-android", import.meta.url)),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      assetsInlineLimit: 0,
    },
    plugins: [
      {
        name: "mobile-security-policy",
        apply: "build",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ${connectOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`,
              },
              injectTo: "head-prepend",
            },
          ];
        },
      },
    ],
  };
});
