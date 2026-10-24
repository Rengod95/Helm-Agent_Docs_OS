import type { EffectiveSetting, SettingDefWire } from "@xeon/contracts/settings";
import type { ThreadId } from "@xeon/contracts/conversation";
import { wireError, type ThreadSummary } from "@xeon/contracts/wire";
import type { FakeHandlers } from "./fake-server.ts";

// M2 메서드의 가짜 처리기 도우미. 호스트 계약(F.wire-settings.spec)만 따르고 실제 엔진을 쓰지 않는다.

export function summary(thread: ThreadId, overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    threadId: thread,
    title: null,
    status: "idle",
    workspace: "/work/project",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:10:00.000Z",
    headSeq: 3,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...overrides,
  };
}

function effective(
  key: string,
  value: unknown,
  scope: EffectiveSetting["source"]["scope"] = "default",
): EffectiveSetting {
  return {
    key,
    value,
    source: { scope },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

export function def(key: string, overrides: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key,
    type: { type: "string" },
    runtimeChange: "live",
    layer: "L4",
    allowedScopes: ["user", "project", "local", "session"],
    since: "0.1.0",
    ...overrides,
  };
}

/** 상태가 있는 설정 처리기. get·set·reset·list를 한 저장소 위에서 흉내 낸다 */
export interface FakeSettings {
  readonly handlers: FakeHandlers;
  readonly writes: {
    readonly scope: string;
    readonly key: string;
    readonly value: unknown;
    readonly threadId: unknown;
  }[];
}

export function fakeSettings(
  defs: readonly SettingDefWire[],
  initial: Record<string, unknown> = {},
): FakeSettings {
  const values = new Map<string, unknown>(Object.entries(initial));
  const writes: FakeSettings["writes"][number][] = [];
  const known = (key: unknown): SettingDefWire => {
    const found = defs.find((candidate) => candidate.key === key);
    if (found === undefined)
      throw wireError("settings.unknownKey", { details: { key: String(key) } });
    return found;
  };
  const settingOf = (
    definition: SettingDefWire,
    scope: EffectiveSetting["source"]["scope"],
  ): EffectiveSetting =>
    effective(
      definition.key,
      values.has(definition.key) ? values.get(definition.key) : definition.default,
      scope,
    );
  return {
    writes,
    handlers: {
      "settings.get": (params) => {
        const keys = Array.isArray(params["keys"]) ? params["keys"] : defs.map((d) => d.key);
        return {
          settings: keys.map((key) => {
            const definition = known(key);
            return settingOf(definition, values.has(definition.key) ? "user" : "default");
          }),
        };
      },
      "settings.list": (params) => {
        const prefix = typeof params["prefix"] === "string" ? params["prefix"] : "";
        return { defs: defs.filter((d) => d.key.startsWith(prefix)) };
      },
      "settings.set": (params) => {
        const definition = known(params["key"]);
        const scope = String(params["scope"]);
        if (!definition.allowedScopes.some((allowed) => allowed === scope)) {
          throw wireError("settings.scopeNotAllowed", {
            details: { key: definition.key, scope, allowedScopes: [...definition.allowedScopes] },
          });
        }
        writes.push({
          scope,
          key: definition.key,
          value: params["value"],
          threadId: params["threadId"],
        });
        values.set(definition.key, params["value"]);
        return { setting: settingOf(definition, scope === "session" ? "session" : "user") };
      },
      "settings.reset": (params) => {
        const definition = known(params["key"]);
        values.delete(definition.key);
        writes.push({
          scope: String(params["scope"]),
          key: definition.key,
          value: undefined,
          threadId: params["threadId"],
        });
        return { setting: settingOf(definition, "default") };
      },
    },
  };
}
