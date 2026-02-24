/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEFAULT_COLLECTION_ID?: string;
  readonly VITE_DEFAULT_COLLECTION?: string;
  readonly VITE_COLLECTION_IDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
