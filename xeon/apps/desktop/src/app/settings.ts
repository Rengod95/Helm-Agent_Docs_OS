import { readSettingsFile, writeSettingsFile, type SettingsFileError } from "@fresnel/client";
import { createSettingsController } from "@fresnel/client/settings";
import { assertNever, err, ok, parse } from "@fresnel/contracts";
import type { WireError } from "@fresnel/contracts/wire";
import { Type } from "typebox";
import type { Session } from "./session.ts";
import type { UiStore } from "../state/ui/index.ts";
import type {
  CommandError,
  SettingsCommands,
  SettingsFileTarget,
  SettingsReadTarget,
  SettingsWriteError,
} from "../views/commands.ts";
import { errorOf } from "./command-error.ts";
import { createLocalSettingsPort, type LocalSettings } from "../settings-store/index.ts";

// 설정 화면(P-09)의 컨트롤러 발급과 설정 파일 읽기·쓰기. 컨트롤러는 연결 하나에 묶인다(`HostConnection`을 포트에 고정한다).
// 그래서 화면은 연결이 살아날 때마다 `open()`을 다시 부르고, 옛 컨트롤러는 `dispose()`로 알림 구독을 끊는다.
// 엔진이 없으면 `open()`도 컨트롤러를 준다. 그 컨트롤러는 연결 없이 데스크톱 로컬 설정만 읽고 쓴다(§4.1.3).
// 현재 대화는 열린 대화 상태에서 매번 읽는다(`settings.invalidated` 판정과 `launch` 범위 쓰기에 쓴다).
// 파일 읽기와 쓰기는 호출할 때마다 현재 연결을 읽는다. 연결이 없으면 `offline`이다.

export interface SettingsDeps {
  readonly session: Pick<Session, "connection" | "restartEngine" | "reconnect">;
  readonly ui: Pick<UiStore, "read">;
  /** 데스크톱 로컬 설정 저장소. 설정 화면의 `l4.desktop.*` 항목을 읽고 쓴다 */
  readonly local: Pick<LocalSettings, "get" | "set">;
}

/** `settings.fileInvalid`(3108)의 details. host가 준 첫 문제의 문장만 쓴다 */
const FileInvalidDetailsSchema = Type.Object({
  issues: Type.Array(Type.Object({ message: Type.String({ maxLength: 512 }) })),
});

/** 파일 전체가 검사에 걸린 오류는 host의 첫 문제 문장을 남긴다. 나머지는 공통 오류 값과 같다 */
function hostErrorOf(cause: WireError): CommandError {
  if (cause.data.kind !== "settings.fileInvalid") return errorOf(cause);
  const details = parse(FileInvalidDetailsSchema, cause.data.details);
  const detail = details.ok ? details.value.issues[0]?.message : undefined;
  return detail === undefined ? errorOf(cause) : { kind: "rejected", code: cause.code, detail };
}

/** 읽기의 오류. 읽기는 충돌(3107)을 받지 않으므로 그 자리는 `failed`로 둔다 */
function readErrorOf(error: SettingsFileError): CommandError {
  switch (error.kind) {
    case "host":
      return hostErrorOf(error.error);
    case "transport":
      return errorOf(error.cause);
    case "conflict":
      return { kind: "failed" };
    default:
      return assertNever(error, "SettingsFileError");
  }
}

function writeErrorOf(error: SettingsFileError): SettingsWriteError {
  return error.kind === "conflict" ? { kind: "conflict" } : readErrorOf(error);
}

/** `user` 범위는 대화를 보내지 않는다. `project`와 `local`은 대화의 작업 폴더를 정하려고 보낸다 */
function scopeParamsOf(target: SettingsFileTarget) {
  return target.scope === "user" || target.threadId === null
    ? { scope: target.scope }
    : { scope: target.scope, threadId: target.threadId };
}

/** 읽기는 `managed`도 받는다. `managed`도 대화를 보내지 않는다 */
function readParamsOf(target: SettingsReadTarget) {
  if (target.scope === "managed") return { scope: target.scope };
  return scopeParamsOf({ scope: target.scope, threadId: target.threadId });
}

export function createSettingsCommands(deps: SettingsDeps): SettingsCommands {
  // 로컬 원천 포트는 명령마다 하나만 만든다. 청취자는 컨트롤러가 놓을 때 떼어 낸다
  const localStore = createLocalSettingsPort(deps.local);
  return {
    open() {
      return createSettingsController({
        connection: deps.session.connection(),
        localStore,
        currentThreadId: () => deps.ui.read.getState().selectedThreadId,
        // 재시작이 거절되면 연결을 다시 잇는다. 새 연결의 화면이 대기 표시를 다시 읽는다(L4.settings-ui §4.4.5)
        requestHostRestart: async () => {
          const restarted = await deps.session.restartEngine();
          if (!restarted) deps.session.reconnect();
        },
      });
    },
    async readFile(target) {
      const connection = deps.session.connection();
      if (connection === null) return err({ kind: "offline" });
      const outcome = await readSettingsFile(connection, readParamsOf(target));
      return outcome.ok ? ok(outcome.value) : err(readErrorOf(outcome.error));
    },
    async writeFile(write) {
      const connection = deps.session.connection();
      if (connection === null) return err({ kind: "offline" });
      const outcome = await writeSettingsFile(connection, {
        ...scopeParamsOf(write),
        text: write.text,
        baseSha256: write.baseSha256,
      });
      return outcome.ok ? ok(outcome.value) : err(writeErrorOf(outcome.error));
    },
  };
}
