import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { t } from "@xeon/client/i18n";
import { parse, parseJson } from "@xeon/contracts";
import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TObject,
  type TRecord,
  type TString,
} from "typebox";
import type { StreamPosition } from "@xeon/contracts/wire";

// L4.cli.spec §3.7. CLI 상태 파일: 작업 폴더마다 마지막 thread와 위치를 적어 둔다. 이 파일은 캐시다.
// 깨졌거나 스키마가 맞지 않으면 버린다. 경로는 EngineHandle.paths.cliStateFile이고 CLI는 경로를 계산하지 않는다(DR-13).

const CliStateEntrySchema: TObject<{
  threadId: TString;
  position: TObject<{ storeId: TString; seq: TInteger }>;
  updatedAt: TString;
}> = Type.Object(
  {
    threadId: Type.String({ minLength: 1, maxLength: 64 }),
    position: Type.Object({ storeId: Type.String(), seq: Type.Integer({ minimum: 0 }) }),
    updatedAt: Type.String({ format: "date-time", maxLength: 32 }),
  },
  { additionalProperties: false },
);

const CliStateSchema: TObject<{
  version: TLiteral<1>;
  workspaces: TRecord<"^.*$", typeof CliStateEntrySchema>;
}> = Type.Object(
  {
    version: Type.Literal(1),
    workspaces: Type.Record(Type.String({ maxLength: 4096 }), CliStateEntrySchema),
  },
  { additionalProperties: true },
);

export type CliStateEntry = Static<typeof CliStateEntrySchema>;
export type CliState = Static<typeof CliStateSchema>;

export const EMPTY_CLI_STATE: CliState = { version: 1, workspaces: {} };

export type StateReadOutcome =
  /** 파일이 없다. 처음 쓰는 것이다 */
  | { readonly kind: "missing"; readonly state: CliState }
  /** 파일이 있고 스키마에 맞는다 */
  | { readonly kind: "loaded"; readonly state: CliState }
  /** 파일이 있으나 읽을 수 없거나 스키마에 맞지 않아 버렸다. 진단 한 줄을 stderr에 쓸 것 */
  | { readonly kind: "discarded"; readonly state: CliState; readonly reason: string };

function isMissing(caught: unknown): boolean {
  return caught instanceof Error && "code" in caught && caught.code === "ENOENT";
}

/** 상태 파일을 읽는다. 어떤 실패에도 던지지 않고 빈 상태로 돌아간다(캐시이기 때문이다) */
export async function readCliState(path: string): Promise<StateReadOutcome> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (caught) {
    if (isMissing(caught)) return { kind: "missing", state: EMPTY_CLI_STATE };
    return {
      kind: "discarded",
      state: EMPTY_CLI_STATE,
      reason: t("cli.state.discarded.unreadable"),
    };
  }
  const decoded = parseJson(text);
  if (!decoded.ok) {
    return { kind: "discarded", state: EMPTY_CLI_STATE, reason: t("cli.state.discarded.notJson") };
  }
  const parsed = parse(CliStateSchema, decoded.value);
  if (!parsed.ok) {
    return {
      kind: "discarded",
      state: EMPTY_CLI_STATE,
      reason: t("cli.state.discarded.badShape"),
    };
  }
  return { kind: "loaded", state: parsed.value };
}

/**
 * 임시 파일에 쓴 뒤 이름을 바꾼다. 권한은 0600이다(원자 쓰기). 동기 쓰기다: 이벤트 알림을 처리하는 같은 JS 턴 안에서
 * 위치를 먼저 남겨야 강제 종료 뒤 재개가 이미 본 이벤트를 다시 받지 않는다(chat-session의 위치 보관)
 */
export function writeCliStateSync(path: string, state: CliState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (caught) {
    rmSync(temp, { force: true });
    throw caught;
  }
}

export function entryFor(state: CliState, workspace: string): CliStateEntry | undefined {
  return state.workspaces[workspace];
}

/** 불변 갱신. 같은 작업 폴더의 항목만 바꾼다. 다른 폴더와 모르는 최상위 필드는 그대로 둔다 */
export function withEntry(
  state: CliState,
  workspace: string,
  threadId: string,
  position: StreamPosition,
  updatedAt: string,
): CliState {
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspace]: {
        threadId,
        position: { storeId: position.storeId, seq: position.seq },
        updatedAt,
      },
    },
  };
}
