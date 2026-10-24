import { Channel, invoke } from "@tauri-apps/api/core";
import { attemptAsync, parse, type ParseError, type Result } from "@xeon/contracts";
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
  };
}
