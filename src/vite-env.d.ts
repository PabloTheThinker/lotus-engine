/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOTUS_TERMINAL_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  // Blueprint exec debugger — installed by BlueprintEditor while panel is open
  var __bpPulse: ((actorId: string, nodeId: string) => void) | undefined

  interface Global {
    __bpPulse?: (actorId: string, nodeId: string) => void
  }
}