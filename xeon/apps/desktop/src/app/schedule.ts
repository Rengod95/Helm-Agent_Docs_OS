import { serviceModeWarning } from "@fresnel/client";
import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, ScheduleCommands, ScheduleSnapshot } from "../views/commands.ts";

// 예약 화면이 부르는 wire(P-07, O-08). 기대한 실패(`ok: false`)는 값으로 돌려준다. 연결과 구형 host의 실패만 CommandError다.
// 서비스 모드 값은 `settings.get`으로 읽는다. 값을 바꾸는 쓰기 범위는 사용자 설정 파일이다.

/** 서비스 모드 설정 키. 꺼져 있으면 예약이 앱을 닫은 뒤 실행되지 않는다(L0.process) */
const SERVICE_ENABLED_KEY = "l0.process.service.enabled";

const SCOPE = "user";

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

export function createScheduleCommands(run: Run): ScheduleCommands {
  return {
    async list(params) {
      const listed = await run((c) => c.request("schedule.list", params));
      if (!listed.ok) return listed;
      // 호스트가 실패 값(`store_failed` 등)을 주면 목록을 읽지 못한 것이다
      if (!listed.value.ok) return err({ kind: "failed" });
      const settings = await run((c) => c.request("settings.get", { keys: [SERVICE_ENABLED_KEY] }));
      if (!settings.ok) return settings;
      const values: Readonly<Record<string, unknown>> = Object.fromEntries(
        settings.value.settings.map((setting) => [setting.key, setting.value]),
      );
      const snapshot: ScheduleSnapshot = {
        items: listed.value.items,
        serviceModeOff: serviceModeWarning(values),
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
      const written = await run((c) =>
        c.request("settings.set", { key: SERVICE_ENABLED_KEY, value: true, scope: SCOPE }),
      );
      if (!written.ok) return written;
      return ok({ restartPending: restartPendingOf([written.value.setting]) });
    },
  };
}
