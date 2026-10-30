import { err, ok } from "@xeon/contracts";
import { ScheduleEntries, ScheduleEntriesKey } from "@xeon/contracts/capabilities";
import type { ExtensionEntry, PortKey } from "@xeon/contracts/extensions";
import { ToolServicePortKey } from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { createScheduleApi } from "./api.ts";
import { scheduleManifest } from "./manifest.ts";
import type { ScheduleService } from "./types.ts";

// L2.schedule.spec §4.4.9. 호스트가 만든 예약 서비스를 능력 `schedule.entries`로 내놓고 모델 도구 `schedule_create`를 올린다.
// 틱과 저장소는 호스트가 맡는다. 이 플러그인은 서비스를 시작하지 않는다.

export interface SchedulePluginOptions {
  readonly service: ScheduleService;
  readonly loadIndex?: number;
}

function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

export function schedulePlugin(options: SchedulePluginOptions): ExtensionUnit {
  const manifest = scheduleManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      host.provide(ScheduleEntriesKey, createScheduleApi(options.service));
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
