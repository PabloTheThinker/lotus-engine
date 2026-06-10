/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VEKTRA_TERMINAL_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}