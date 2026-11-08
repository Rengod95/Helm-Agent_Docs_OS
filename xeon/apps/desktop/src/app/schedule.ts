import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, ScheduleCommands, ScheduleSnapshot } from "../views/commands.ts";

// 예약 화면이 부르는 wire(P-07, O-08). 기대한 실패(`ok: false`)는 값으로 돌려준다. 연결과 구형 host의 실패만 CommandError다.
// 서비스 꺼짐은 `host.status`의 모드로 본다(설정 값이 아니라 지금 붙은 엔진이 정한다). 다시 시작 대기는 `settings.get`으로 읽는다.
// 값을 바꾸는 쓰기 범위는 사용자 설정 파일이다.

/** 서비스 모드 설정 키. 꺼져 있으면 예약이 앱을 닫은 뒤 실행되지 않는다(L0.process) */
const SERVICE_ENABLED_KEY = "l0.process.service.enabled";

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/**
 * 서비스 모드 값이 바뀌었는데 엔진이 아직 다시 시작하지 않았는가. 호스트가 `pendingUntil: "restart"`를 싣는다(엔진이
 * 처음 본 값과 다를 때만). 등록 상태 자체를 읽는 wire는 없어서 이 값이 "다시 시작해야 켜진다"의 근거다.
 */
function restartPendingOf(
  settings: readonly { readonly key: string; readonly pendingUntil: string | null }[],
): boolean {
  return settings.some(
    (setting) => setting.key === SERVICE_ENABLED_KEY && setting.pendingUntil === "restart",
  );
}

/**
 * 예약 화면의 값 묶음. `enableServiceMode`는 연결 화면의 켜기와 같은 흐름이다(`connection.setServiceMode(true)`).
 * 예약 명령이 따로 설정만 쓰면 이 기기의 서비스와 엔진이 어긋나므로 같은 함수를 넘긴다.
 */
export function createScheduleCommands(
  run: Run,
  enableServiceMode: () => Promise<Result<null, CommandError>>,
): ScheduleCommands {
  return {
    async list(params) {
      const listed = await run((c) => c.request("schedule.list", params));
      if (!listed.ok) return listed;
      // 호스트가 실패 값(`store_failed` 등)을 주면 목록을 읽지 못한 것이다
      if (!listed.value.ok) return err({ kind: "failed" });
      const host = await run((c) => c.request("host.status", {}));
      if (!host.ok) return host;
      const settings = await run((c) => c.request("settings.get", { keys: [SERVICE_ENABLED_KEY] }));
      if (!settings.ok) return settings;
      const snapshot: ScheduleSnapshot = {
        items: listed.value.items,
        // 설정이 켜져 있어도 지금 엔진이 서비스에 붙어 있지 않으면 예약은 앱을 닫은 뒤 돌지 않는다
        serviceModeOff: host.value.mode !== "service",
        serviceRestartPending: restartPendingOf(settings.value.settings),
      };
      return ok(snapshot);
    },
    create: (params) => run((c) => c.request("schedule.create", params)),
    cancel: (scheduleId) => run((c) => c.request("schedule.cancel", { scheduleId })),
    fire: (scheduleId) => run((c) => c.request("schedule.fire", { scheduleId })),
    update: (params) => run((c) => c.request("schedule.update", params)),
    runs: (scheduleId) => run((c) => c.request("schedule.runs", { scheduleId })),
    async enableService() {
      const enabled = await enableServiceMode();
      if (!enabled.ok) return enabled;
      // 연결 화면의 켜기가 엔진을 다시 띄워 바로 적용하므로 다시 시작을 기다리지 않는다
      return ok({ restartPending: false });
    },
  };
}
