import { err, ok } from "@fresnel/contracts";
import { ScheduleEntries, ScheduleEntriesKey } from "@fresnel/contracts/capabilities";
import type { ExtensionEntry, PortKey } from "@fresnel/contracts/extensions";
import {
  ApprovalServicePortKey,
  ToolServicePortKey,
  type ApprovalService,
} from "@fresnel/contracts/services";
import {
  hostOf,
  PrimitiveError,
  type ExtensionUnit,
  type RegistrationHostApi,
} from "@fresnel/ext-host";
import { createScheduleApi } from "./api.ts";
import { scheduleManifest } from "./manifest.ts";
import { readScheduleSettings, type ScheduleSettingsSource } from "./settings.ts";
import type { ScheduleService } from "./types.ts";

// L2.schedule.spec §4.4.9. 호스트가 만든 예약 서비스를 기능 `schedule.entries`로 내놓고 모델 도구 `schedule_create`를 올린다.
// 틱과 저장소는 호스트가 맡는다. 이 플러그인은 서비스를 시작하지 않는다.

export interface SchedulePluginOptions {
  readonly service: ScheduleService;
  /** 설정 층. 직접 호출의 만들기 방식(`l2.schedule.entries.directCreate`)을 호출마다 읽는다 */
  readonly settings: ScheduleSettingsSource;
  /** 참이면 서비스 모드가 꺼져 있어 틱이 돌지 않는다. `create` 결과에 `service_mode_off` 경고를 싣는다 */
  readonly serviceModeOff?: () => boolean;
  readonly loadIndex?: number;
}

function optionalPort<Api>(host: RegistrationHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

export function schedulePlugin(options: SchedulePluginOptions): ExtensionUnit {
  const manifest = scheduleManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      // `ask`의 승인 서비스는 선택 의존이다. 없으면 `ask`는 거부된다(api.ts)
      const approvals = optionalPort<ApprovalService>(host, ApprovalServicePortKey);
      host.provide(
        ScheduleEntriesKey,
        createScheduleApi(options.service, {
          directCreate: (threadId) =>
            readScheduleSettings(options.settings.layers(threadId)).entries.directCreate,
          ...(options.serviceModeOff === undefined
            ? {}
            : { serviceModeOff: options.serviceModeOff }),
          ...(approvals === undefined ? {} : { approvals }),
        }),
      );
      const tools = optionalPort(host, ToolServicePortKey);
      if (tools === undefined) return ok(undefined);
      // 예약은 사용자 없이 나중에 프롬프트를 실행시킨다. 실행 등급(exec)으로 올려 기본 모드에서 승인을 거치게 한다
      const registered = tools.register({
        kind: "capability",
        def: ScheduleEntries,
        key: ScheduleEntriesKey,
        policy: { schedule_create: { risk: "exec" } },
      });
      if (!registered.ok) return err({ reason: registered.error.kind, cause: registered.error });
      g.onDispose(registered.value);
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
