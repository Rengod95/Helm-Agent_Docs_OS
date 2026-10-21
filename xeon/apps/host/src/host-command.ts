import type { SettingsFileScope } from "./settings.ts";

// L4.host-service.spec §3.3.4. runHostCommand가 받는 명령과 입출력.

export type HostCommand =
  | { readonly kind: "host-stdio" }
  | { readonly kind: "service-run" }
  | { readonly kind: "service-start" }
  | { readonly kind: "service-status"; readonly json: boolean }
  | { readonly kind: "service-stop" }
  | { readonly kind: "service-ensure" }
  | { readonly kind: "service-launch-mode" }
  | {
      readonly kind: "config-schema";
      readonly scope: SettingsFileScope;
      readonly out?: string;
      readonly coreOnly: boolean;
    };

export interface CommandIo {
  /** host-stdio에서는 계약 전용이다. 다른 출력을 쓰지 않는다 */
  readonly stdout: WritableStream<Uint8Array>;
  readonly stderr: WritableStream<Uint8Array>;
  readonly stdin: ReadableStream<Uint8Array>;
}
