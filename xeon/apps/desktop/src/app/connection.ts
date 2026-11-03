import { targetsStorageOf, type AttachFailureKind, type TargetEntry } from "@fresnel/client";
import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import { LOCAL, type LocalSettings } from "../settings-store/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { DesktopIpc } from "../transport/ipc.ts";
import type {
  CommandError,
  ConnectionCommands,
  ConnectionSnapshot,
  ConnectTarget,
  TargetStoreError,
} from "../views/commands.ts";
import type { Session } from "./session.ts";

// 연결 화면(P-08)이 부르는 명령. 대상 목록은 로컬 설정 파일에서 읽고 쓰며(FS-03: 거울에 넣지 않는다), 엔진 대상 바꾸기는
// 셸 명령 `engine_retarget`이다. 진행은 엔진 상태와 연결 상태가 화면에 알리므로 여기서는 값만 돌려준다.

/** 서비스 모드 설정 키. 설정 화면과 예약 화면이 같은 키를 쓴다(app/schedule.ts) */
const SERVICE_ENABLED_KEY = "l0.process.service.enabled";

const SCOPE = "user";

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export interface ConnectionDeps {
  readonly ipc: Pick<DesktopIpc, "retarget">;
  readonly local: Pick<LocalSettings, "load" | "get" | "set">;
  readonly session: Pick<Session, "reconnect" | "restartEngine">;
  readonly ui: Pick<UiStore, "actions">;
  readonly run: Run;
}

export function createConnectionCommands(deps: ConnectionDeps): ConnectionCommands {
  const { ipc, local, session, ui, run } = deps;
  return {
    async targets(): Promise<Result<readonly TargetEntry[], TargetStoreError>> {
      const loaded = await local.load();
      if (!loaded.ok) return err({ kind: "storage" });
      // 저장된 값은 항목마다 주소 형식과 루프백 규칙을 다시 검사한다(targetsStorageOf). 틀린 항목은 버린다
      return ok(targetsStorageOf(local.get(LOCAL.connectionTargets)));
    },
    async saveTargets(list): Promise<Result<null, TargetStoreError>> {
      const written = await local.set(LOCAL.connectionTargets, [...list]);
      return written.ok ? ok(null) : err({ kind: "storage" });
    },
    async retarget(target: ConnectTarget): Promise<Result<null, AttachFailureKind>> {
      // 지난 연결 실패는 이 시도의 결과가 아니므로 먼저 지운다. 그러지 않으면 새 엔진 상태가 낡은 오류와 맞물린다
      ui.actions.setConnectError(null);
      const done = await ipc.retarget(target);
      if (!done.ok) {
        // 셸 명령 오류(`IpcError`)의 코드는 `bad-request`, `engine-stopping` 같은 명령 오류라 연결 실패 종류가 아니다
        return err("other");
      }
      // 연결 루프가 실패로 멈춰 있으면 새 대상으로 다시 붙도록 깨운다. 연결 중이면 아무 일도 없다
      session.reconnect();
      return ok(null);
    },
    async retry(): Promise<void> {
      ui.actions.setConnectError(null);
      const restarted = await session.restartEngine();
      if (!restarted) session.reconnect();
    },
    async load(): Promise<Result<ConnectionSnapshot, CommandError>> {
      const host = await run((c) => c.request("host.status", {}));
      if (!host.ok) return host;
      const settings = await run((c) => c.request("settings.get", { keys: [SERVICE_ENABLED_KEY] }));
      if (!settings.ok) return settings;
      const setting = settings.value.settings.find((item) => item.key === SERVICE_ENABLED_KEY);
      return ok({ host: host.value, serviceEnabled: setting?.value === true });
    },
    async setServiceMode(enabled: boolean): Promise<Result<null, CommandError>> {
      const written = await run((c) =>
        c.request("settings.set", { key: SERVICE_ENABLED_KEY, value: enabled, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    async stopService(): Promise<Result<boolean, CommandError>> {
      const done = await run((c) => c.request("host.shutdown", { reason: "user" }));
      return done.ok ? ok(done.value.accepted) : done;
    },
  };
}
