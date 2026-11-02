import { join } from "node:path";
import { assertNever, err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, TurnIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { checkSettingWrite, type ScopeStack, type SettingScope } from "@fresnel/contracts/settings";
import type {
  Profile,
  ProfileApplyResult,
  ProfileLayer,
  ProfilePreviewResult,
  TestRunMarker,
} from "@fresnel/contracts/wire";
import type {
  ProfileApplyFailure,
  ProfileApplyRequest,
  ProfileTestRunPort,
} from "../../handlers/m4/profile-test-run.ts";
import { sequentially } from "../../util.ts";
import type { M4PortDeps } from "./deps.ts";
import { createProfileStore } from "./profile-store.ts";

// ProfileTestRun 포트 구현(`spec-deltas/t-wb.md` §1, §2). 프로필 저장은 `profile-store.ts`, 적용과 되돌리기는 이 파일이 한다.

/** 프로필의 `driver`를 쓰는 설정 키(T-REG §3.3) */
const ACTIVE_DRIVER_KEY = "x.primitives.activeDriver";

/** 개발 모드(replay·benchmark·core diff 실행 허용) 판정(§3). `l3.authoring.devMode`가 참인가. 키가 아직 카탈로그에 없으면 거짓이다 */
export function isDevMode(settingValue: (key: string) => unknown): boolean {
  return settingValue("l3.authoring.devMode") === true;
}

function scopeOf(layer: ProfileLayer): SettingScope {
  switch (layer) {
    case "user":
      return "user";
    case "project":
      return "project";
    case "thread":
      return "launch";
    default:
      return assertNever(layer, "ProfileLayer");
  }
}

function extensionEnabledKey(name: string): string {
  return `ext.${name}.enabled`;
}

interface PlannedWrite {
  readonly key: string;
  readonly value: unknown;
}

/** 쓰기 전에 그 범위에 있던 값. 없었으면 되돌릴 때 지운다 */
type Previous = { readonly had: true; readonly value: unknown } | { readonly had: false };

interface Plan {
  readonly scope: SettingScope;
  readonly threadId: ThreadId | undefined;
  /** 설정 층에 쓸 키. 쓰는 순서다 */
  readonly writes: readonly PlannedWrite[];
  /** thread 층에서 대화별 켜짐 요청으로 보낼 확장 */
  readonly toggles: readonly { readonly name: string; readonly enabled: boolean }[];
}

/** 같은 키가 여러 번 나오면 마지막 값이 이긴다(처음 자리에 둔다) */
function collapsed(writes: readonly PlannedWrite[]): PlannedWrite[] {
  const out: PlannedWrite[] = [];
  for (const write of writes) {
    const at = out.findIndex((item) => item.key === write.key);
    if (at === -1) out.push(write);
    else out[at] = write;
  }
  return out;
}

function previousOf(layers: ScopeStack, scope: SettingScope, key: string): Previous {
  const layer = layers.find((item) => item.scope === scope);
  return layer !== undefined && layer.values.has(key)
    ? { had: true, value: layer.values.get(key) }
    : { had: false };
}

export function createProfileTestRunPort(deps: M4PortDeps): ProfileTestRunPort {
  const { env } = deps;
  const store = createProfileStore({
    path: join(env.configDir, "profiles.json"),
    fileLock: env.fileLock,
    clock: env.clock,
    signal: env.signal,
  });
  // Test run 대화 표지. 호스트 메모리에만 둔다: 다시 시작하면 사라진다(저장 위치는 계약에 아직 없다)
  const markers = new Map<ThreadId, TestRunMarker>();

  /** 쓰기 전에 모든 키를 검사하고 쓸 계획을 만든다. 아무것도 쓰지 않는다 */
  async function planOf(
    profile: Profile,
    request: ProfileApplyRequest,
  ): Promise<Result<Plan, ProfileApplyFailure>> {
    const scope = scopeOf(request.layer);
    const { threadId } = request;
    if (threadId !== undefined) await env.settings.prepare(threadId);
    const layers = env.settings.layers(threadId);
    const raw: PlannedWrite[] = [];
    const toggles: { name: string; enabled: boolean }[] = [];
    const extensions = new Set(env.registrations().map((info) => info.extension));
    const enableSteps = [
      ...profile.enable.map((name) => ({ name, enabled: true })),
      ...profile.disable.map((name) => ({ name, enabled: false })),
    ];
    for (const step of enableSteps) {
      if (request.layer === "thread") {
        // thread 층은 설정 파일이 아니라 대화별 켜짐 요청이다. 설치되지 않은 확장은 거절한다
        if (!extensions.has(step.name)) return err({ kind: "unknown_extension", name: step.name });
        toggles.push(step);
      } else {
        raw.push({ key: extensionEnabledKey(step.name), value: step.enabled });
      }
    }
    for (const setting of profile.settings) raw.push({ key: setting.key, value: setting.value });
    if (profile.driver !== null) raw.push({ key: ACTIVE_DRIVER_KEY, value: profile.driver });
    const writes = collapsed(raw);
    for (const write of writes) {
      const checked = checkSettingWrite(env.catalog, layers, write.key, scope, write.value);
      if (!checked.ok) return err({ kind: "setting_rejected", rejected: checked });
    }
    return ok({ scope, threadId, writes, toggles });
  }

  /** 쓴 키를 거꾸로 이전 값으로 돌린다. 돌리지 못한 키를 돌려준다 */
  async function rollback(
    written: readonly { readonly key: string; readonly previous: Previous }[],
    plan: Plan,
  ): Promise<string[]> {
    const stuck: string[] = [];
    await sequentially(written.toReversed(), async (item) => {
      const restored = item.previous.had
        ? await env.settings.write(plan.scope, item.key, item.previous.value, plan.threadId)
        : await env.settings.reset(plan.scope, item.key, plan.threadId);
      if (!restored.ok) stuck.push(item.key);
    });
    return stuck;
  }

  async function apply(
    request: ProfileApplyRequest,
  ): Promise<Result<ProfileApplyResult, ProfileApplyFailure>> {
    const found = await store.get(request.id);
    if (!found.ok) return found;
    const planned = await planOf(found.value, request);
    if (!planned.ok) return planned;
    const plan = planned.value;
    const before = env.settings.layers(plan.threadId);
    const written: { key: string; previous: Previous }[] = [];
    const stopped: { failure: ProfileApplyFailure | undefined } = { failure: undefined };
    await sequentially(plan.writes, async (write) => {
      if (stopped.failure !== undefined) return;
      const previous = previousOf(before, plan.scope, write.key);
      const done = await env.settings.write(plan.scope, write.key, write.value, plan.threadId);
      if (done.ok) {
        written.push({ key: write.key, previous });
        return;
      }
      // 하나라도 실패하면 이미 쓴 키를 이전 값으로 되돌린다(원자적). 되돌리기까지 실패하면 남은 키를 알린다
      const stuck = await rollback(written, plan);
      stopped.failure =
        stuck.length > 0
          ? { kind: "apply_partial", written: stuck, failed: write.key }
          : { kind: "write_failed", key: write.key, failure: done.error };
    });
    if (stopped.failure !== undefined) return err(stopped.failure);
    // 켜짐 요청은 실패하지 않는 기록이라 설정 쓰기가 모두 끝난 뒤에 보낸다(되돌릴 것이 없다)
    const infos = env.registrations();
    for (const toggle of plan.toggles) {
      for (const info of infos) {
        if (info.extension !== toggle.name) continue;
        env.toggles.request(info.id, toggle.enabled, "request", plan.threadId);
      }
    }
    return ok({
      written: [
        ...plan.toggles.map((toggle) => extensionEnabledKey(toggle.name)),
        ...plan.writes.map((write) => write.key),
      ],
      layer: request.layer,
      appliesAt: plan.toggles.length > 0 ? "nextStepBoundary" : "now",
    });
  }

  async function preview(
    request: ProfileApplyRequest,
  ): Promise<Result<ProfilePreviewResult, ProfileApplyFailure>> {
    const found = await store.get(request.id);
    if (!found.ok) return found;
    const profile = found.value;
    const planned = await planOf(profile, request);
    if (!planned.ok) return planned;
    const enabled = new Set(profile.enable);
    const disabled = new Set(profile.disable);
    const infos = env.registrations();
    // 켜진 채 남는 것(이미 켜져 있고 끄지 않음)이 먼저, 새로 켜지는 것이 뒤다: 요청 순서 중재 규칙과 같은 순서
    const staying = infos.filter(
      (info) => info.status === "enabled" && !disabled.has(info.extension) && info.drive !== "none",
    );
    const joining = infos.filter(
      (info) =>
        info.status !== "enabled" &&
        enabled.has(info.extension) &&
        !disabled.has(info.extension) &&
        info.drive !== "none",
    );
    const candidates = [...staying, ...joining].map((info) => info.id);
    const current = env.settingValue(ACTIVE_DRIVER_KEY, request.threadId);
    const named = profile.driver ?? (typeof current === "string" ? current : null);
    let expectedHolder: string | null;
    if (named !== null) {
      expectedHolder = candidates.find((id) => id === named) ?? null;
    } else {
      expectedHolder = candidates[0] ?? null;
    }
    return ok({
      enabled: [...profile.enable],
      disabled: [...profile.disable],
      candidates,
      expectedHolder,
      overrides: collapsed([
        ...profile.settings.map((setting) => ({ key: setting.key, value: setting.value })),
        ...(profile.driver === null ? [] : [{ key: ACTIVE_DRIVER_KEY, value: profile.driver }]),
      ]),
      // ext-host가 등록별 Hook 수를 내놓지 않는다(계약 간극): T-WA의 `hooks.list` 원천이 생기면 채운다
      hookCount: 0,
      layer: request.layer,
    });
  }

  return {
    errors: env.errors,
    listProfiles: () => store.list(),
    getProfile: (id) => store.get(id),
    async putProfile(input, baseRev) {
      const put = await store.put(input, baseRev);
      return put.ok ? ok(put.value.profile) : put;
    },
    async deleteProfile(id) {
      return store.remove(id);
    },
    applyProfile: apply,
    previewProfile: preview,
    onProfilesChanged: (listener) => store.onChange(listener),
    lookupThread(raw) {
      const parsed = parse(ThreadIdSchema, raw);
      if (!parsed.ok) return ok(undefined);
      const exists = env.threadExists(parsed.value);
      if (!exists.ok) return exists;
      return ok(exists.value ? parsed.value : undefined);
    },
    traceTurn(threadId, rawTurnId) {
      if (!deps.traceRead.enabled()) return { traceEnabled: false, retained: false, entries: [] };
      const turnId = parse(TurnIdSchema, rawTurnId);
      const found = turnId.ok ? deps.traceRead.turn(threadId, turnId.value) : undefined;
      return found ?? { traceEnabled: true, retained: false, entries: [] };
    },
    testRunMarker: (threadId) => markers.get(threadId),
    registerTestRun(threadId, profileId) {
      markers.set(threadId, { profileId, target: null, paused: false });
    },
    controlTestRun(threadId, op) {
      const marker = markers.get(threadId);
      if (marker === undefined) return err({ kind: "not_a_test_run" });
      const done = deps.testRunControl[op](threadId);
      if (done.ok) markers.set(threadId, { ...marker, paused: done.value.paused });
      return done;
    },
    testRunPhase(threadId) {
      if (!markers.has(threadId)) return err({ kind: "not_a_test_run" });
      return deps.testRunControl.phase(threadId);
    },
  };
}
