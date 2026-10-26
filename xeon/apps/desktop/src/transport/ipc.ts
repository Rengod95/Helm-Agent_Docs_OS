import { Channel, invoke } from "@tauri-apps/api/core";
import { attemptAsync, parse, type ParseError, type Result } from "@xeon/contracts";
import type { SecretName } from "@xeon/contracts/capabilities";
import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
} from "typebox";

// L4.desktop.spec 3.3. @tauri-apps/*를 import하는 파일은 이 파일과 src/shell/**뿐이다(W2).
// 테스트는 DesktopIpc 가짜를 주입한다(eng.testing.guide TS-05).

const IsoTimeSchema: TString = Type.String({ format: "date-time", maxLength: 32 });

const EngineSourceSchema: TUnion<[TLiteral<"sidecar">, TLiteral<"service">]> = Type.Union([
  Type.Literal("sidecar"),
  Type.Literal("service"),
]);

const EngineExitSchema: TObject<{
  code: TUnion<[TInteger, TNull]>;
  signal: TUnion<[TInteger, TNull]>;
  at: TString;
}> = Type.Object(
  {
    /** 신호로 끝나면 null */
    code: Type.Union([Type.Integer(), Type.Null()]),
    /** Windows는 항상 null */
    signal: Type.Union([Type.Integer(), Type.Null()]),
    at: IsoTimeSchema,
  },
  { additionalProperties: false },
);

const EngineStateSchema: TUnion<
  [
    TObject<{ kind: TLiteral<"starting">; source: typeof EngineSourceSchema; attempt: TInteger }>,
    TObject<{
      kind: TLiteral<"running">;
      source: typeof EngineSourceSchema;
      pid: TUnion<[TInteger, TNull]>;
    }>,
    TObject<{
      kind: TLiteral<"restarting">;
      attempt: TInteger;
      retryAt: TString;
      lastExit: typeof EngineExitSchema;
    }>,
    TObject<{ kind: TLiteral<"stopping"> }>,
    TObject<{ kind: TLiteral<"failed">; attempts: TInteger; lastExit: typeof EngineExitSchema }>,
    TObject<{ kind: TLiteral<"stopped"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("starting"),
      source: EngineSourceSchema,
      attempt: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("running"),
      source: EngineSourceSchema,
      pid: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("restarting"),
      attempt: Type.Integer({ minimum: 1 }),
      retryAt: IsoTimeSchema,
      lastExit: EngineExitSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("stopping") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("failed"),
      attempts: Type.Integer({ minimum: 0 }),
      lastExit: EngineExitSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("stopped") }, { additionalProperties: false }),
]);
export type EngineState = Static<typeof EngineStateSchema>;

const AttachResultSchema: TObject<{ epoch: TInteger; state: typeof EngineStateSchema }> =
  Type.Object(
    { epoch: Type.Integer({ minimum: 1 }), state: EngineStateSchema },
    { additionalProperties: false },
  );
export type AttachResult = Static<typeof AttachResultSchema>;

/** 셸이 보낸 값도 WebView 입장에서는 프로세스 밖의 값이다(TY-10) */
export function parseEngineState(value: unknown): Result<EngineState, ParseError> {
  return parse(EngineStateSchema, value);
}

export function parseAttachResult(value: unknown): Result<AttachResult, ParseError> {
  return parse(AttachResultSchema, value);
}

/**
 * 키 등록 명령(`secret_register`)의 오류. 셸이 `{kind, ...}` 객체로 거부한다(src-tauri/src/secret_entry.rs).
 * `unknown`은 IPC 자체가 실패했거나 셸이 모르는 모양을 돌려준 경우다.
 */
export type SecretRegisterError =
  | { readonly kind: "bad-request" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large" }
  | { readonly kind: "busy" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "rejected"; readonly exitCode: number | null; readonly detail: string }
  | { readonly kind: "unknown" };

const SecretRegisterErrorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Union([
        Type.Literal("bad-request"),
        Type.Literal("empty"),
        Type.Literal("too-large"),
        Type.Literal("busy"),
        Type.Literal("timeout"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("unavailable"), detail: Type.String({ maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("rejected"),
      exitCode: Type.Union([Type.Integer(), Type.Null()]),
      detail: Type.String({ maxLength: 4096 }),
    },
    { additionalProperties: false },
  ),
]);

/** 셸이 거부한 값도 프로세스 밖의 값이다(TY-10). 모르는 모양은 `unknown`이다 */
export function parseSecretRegisterError(value: unknown): SecretRegisterError {
  const parsed = parse(SecretRegisterErrorSchema, value);
  return parsed.ok ? parsed.value : { kind: "unknown" };
}

export type IpcError =
  | { readonly kind: "command"; readonly command: string; readonly code: string }
  | { readonly kind: "invalid"; readonly command: string };

export interface DesktopIpc {
  /** 현재 페이지에 릴레이를 붙인다. 이전 세대는 끊긴다. 바이트는 완성된 줄 단위로 온다 */
  attach(
    onBytes: (chunk: Uint8Array) => void,
    onState: (state: EngineState) => void,
  ): Promise<Result<AttachResult, IpcError>>;
  /** 엔진 stdin에 한 프레임(줄)을 쓴다. 세대가 다르면 거부된다 */
  write(epoch: number, chunk: Uint8Array): Promise<Result<null, IpcError>>;
  /** 처리를 끝낸 바이트 수를 알려 신용을 돌려준다 */
  ack(epoch: number, bytes: number): Promise<Result<null, IpcError>>;
  restart(): Promise<Result<null, IpcError>>;
  detach(epoch: number): Promise<Result<null, IpcError>>;
  /**
   * 모델 키를 등록한다. 셸이 번들된 사이드카를 `xeon secret <동작> <이름>`으로 실행하고 값을 그 stdin에 한 번 쓴다.
   * 값은 요청 본문 바이트로만 가고 이 함수가 돌아오기 전에 그 버퍼를 0으로 덮는다. `value`는 호출자가 덮는다.
   */
  registerSecret(
    name: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, SecretRegisterError>>;
}

function codeOf(cause: unknown): string {
  return typeof cause === "string" ? cause : "unknown";
}

async function call<T>(command: string, run: () => Promise<T>): Promise<Result<T, IpcError>> {
  const result = await attemptAsync(run);
  return result.ok
    ? result
    : { ok: false, error: { kind: "command", command, code: codeOf(result.error.cause) } };
}

/** Channel 메시지는 원시 바이트일 때 ArrayBuffer로 온다. 그 밖의 값은 버린다 */
function bytesOf(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return null;
}

/** @tauri-apps/api의 invoke와 Channel로 DesktopIpc를 만든다 */
export function createTauriIpc(): DesktopIpc {
  return {
    async attach(onBytes, onState) {
      const bytes = new Channel();
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Tauri Channel은 EventTarget이 아니라 onmessage 대입이 유일한 수신 방법이다 (@tauri-apps/api core.d.ts)
      bytes.onmessage = (message) => {
        const chunk = bytesOf(message);
        if (chunk !== null) onBytes(chunk);
      };
      const state = new Channel();
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Tauri Channel은 EventTarget이 아니라 onmessage 대입이 유일한 수신 방법이다 (@tauri-apps/api core.d.ts)
      state.onmessage = (message) => {
        const parsed = parseEngineState(message);
        if (parsed.ok) onState(parsed.value);
      };
      const raw = await call<unknown>("engine_attach", () =>
        invoke<unknown>("engine_attach", { onBytes: bytes, onState: state }),
      );
      if (!raw.ok) return raw;
      const parsed = parseAttachResult(raw.value);
      return parsed.ok
        ? parsed
        : { ok: false, error: { kind: "invalid", command: "engine_attach" } };
    },
    write: (epoch, chunk) =>
      call("engine_write", async () => {
        await invoke("engine_write", chunk, { headers: { "x-xeon-epoch": String(epoch) } });
        return null;
      }),
    ack: (epoch, bytes) =>
      call("engine_ack", async () => {
        await invoke("engine_ack", { epoch, bytes });
        return null;
      }),
    restart: () =>
      call("engine_restart", async () => {
        await invoke("engine_restart");
        return null;
      }),
    detach: (epoch) =>
      call("engine_detach", async () => {
        await invoke("engine_detach", { epoch });
        return null;
      }),
    async registerSecret(name, action, value) {
      // 본문은 `<동작> <이름>\n<값>`이다. 값을 문자열로 바꾸거나 JSON에 싣지 않는다
      const head = new TextEncoder().encode(`${action} ${name}\n`);
      const body = new Uint8Array(head.byteLength + value.byteLength);
      body.set(head, 0);
      body.set(value, head.byteLength);
      try {
        const sent = await attemptAsync(() => invoke("secret_register", body));
        return sent.ok
          ? { ok: true, value: null }
          : { ok: false, error: parseSecretRegisterError(sent.error.cause) };
      } finally {
        body.fill(0);
      }
    },
  };
}
