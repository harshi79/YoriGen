/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional HTTPS origin of a Guison-compatible BIN metadata service. */
  readonly VITE_ORIGEN_BIN_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.mobile.config.ts from package.json. */
declare const __ORIGEN_VERSION__: string;
