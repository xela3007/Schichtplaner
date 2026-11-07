/// <reference types="vite/client" />

interface Window {
  /** Runtime config from /config.js (ADR-007/009). */
  __APP_CONFIG__?: Record<string, unknown>;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}
