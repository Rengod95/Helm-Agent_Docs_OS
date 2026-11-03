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
      };
      return ok(snapshot);
    },
    create: (params) => run((c) => c.request("schedule.create", params)),
    cancel: (scheduleId) => run((c) => c.request("schedule.cancel", { scheduleId })),
    fire: (scheduleId) => run((c) => c.request("schedule.fire", { scheduleId })),
    async enableService() {
      const written = await run((c) =>
        c.request("settings.set", { key: SERVICE_ENABLED_KEY, value: true, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
  };
}
