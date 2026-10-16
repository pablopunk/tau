/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to run the app against the in-browser fake backend from `@pi-everywhere/testkit`. */
  readonly VITE_FAKE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
