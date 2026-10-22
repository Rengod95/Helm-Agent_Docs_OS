import { resolveSetting, type EffectiveSetting } from "@xeon/contracts/settings";
import { wireError, type WireHandler } from "@xeon/contracts/wire";
import { wireErrorOfStore } from "../store-error.ts";
import type { Engine } from "../types.ts";

// L4.host-service.spec §3.4 M1 표. settings.get: keys가 없으면 카탈로그 전체, 키마다 resolveSetting(def, layers(threadId)).
// settings.set/reset/list는 M2다.

export function createSettingsGetHandler(engine: Engine): WireHandler<"settings.get"> {
  const { ports, catalog } = engine;
  return (params) => {
    const { threadId } = params;
    if (threadId !== undefined) {
      const exists = ports.threads.exists(threadId);
      if (!exists.ok)
        return Promise.reject(wireErrorOfStore(exists.error, "settings.get thread lookup"));
      if (!exists.value) {
        return Promise.reject(wireError("thread.notFound", { details: { threadId } }));
      }
    }
    const keys = params.keys ?? [...catalog.keys()].toSorted();
    const layers = ports.settings.layers(threadId);
    const settings: EffectiveSetting[] = [];
    for (const key of keys) {
      const def = catalog.get(key);
      if (def === undefined) {
        return Promise.reject(wireError("settings.unknownKey", { details: { key } }));
      }
      const resolved = resolveSetting(def, layers);
      for (const issue of resolved.issues) {
        // 값은 싣지 않는다(비밀 값 비표시 규칙). 건너뛴 범위와 이유만 남긴다
        ports.log.info("settings.value_skipped", {
          key,
          scope: issue.scope,
          message: issue.message,
        });
      }
      settings.push(resolved.setting);
    }
    return Promise.resolve({ settings });
  };
}
