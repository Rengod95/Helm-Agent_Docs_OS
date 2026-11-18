import { attempt, attemptAsync, detach } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PluginSetPort, PluginSetView } from "@fresnel/contracts/extensions";
import type { CommonSet, EnabledSource, Profile } from "@fresnel/contracts/wire";
import {
  isHookUnitName,
  type OperationsNotifier,
  type RegistrationInfo,
  type RegistrationToggleSourceOf,
} from "@fresnel/ext-host";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import { CRAFT_PROFILE_ID, craftProfile } from "./profile-defaults.ts";

// M5c §3.5, §4.1: 대화별 켜짐 집합 E(T) = 코어 ∪ (공통.plugins ∪ 프로필.plugins, 처음 것을 남김) − 관리 잠금 − 오류 정지.
// 호스트가 구현해 X에 `PluginSetPortKey`로 준다. 읽기는 동기여야 하므로 프로필 목록은 메모리에 둔 복사를 쓴다.
// 프로필을 바꾸면 복사를 다시 읽고, 바뀐 설정 키는 대화의 `profile` 범위 층으로 알리고, 열린 대화마다 적용을 예약한다.
// 차이(바뀐 등록)는 X가 마지막으로 맞춘 값과 비교해 낸다(적용은 다음 경계, 유휴면 다음 매크로태스크).
// 훅 단위(설정 파일의 `x.operations.hookDefs`)는 플러그인이 아니라서 이 집합이 켜고 끄지 않는다(폴더 신뢰와 저장된 끄기가 정한다).

const DEFAULT_PROFILE_ID = "default";

/** 저장된 프로필 목록과 공통 묶음의 복사. 읽기 경로는 이 복사만 쓴다(디스크를 다시 읽지 않는다) */
interface ProfileCopy {
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
}

/** 대화에 얹힌 턴 덧씌우기 하나(M5c §4.3). 턴이 정착하면 `turnSettled`가 뺀다. 메모리에만 둔다(재시작 복원은 §4.3.5의 뒤 단계) */
export interface OverlayMark {
  readonly plugin: string;
  readonly contentHash: string;
  readonly until: "turn";
}

/**
 * 대화 하나가 참조한 프로필의 해소 결과. `profile`은 프로필이 든 플러그인 이름(순서 있음), `common`은 공통 묶음,
 * `settings`는 `profile` 범위 층의 값(공통 묶음 값을 프로필 값이 덮는다, 같은 키는 마지막 값)이다.
 */
interface Resolved {
  readonly profileId: string;
  readonly profileRev: number;
  readonly commonRev: number;
  readonly missingProfileId?: string;
  readonly common: readonly string[];
  readonly profile: readonly string[];
  readonly settings: ReadonlyMap<string, unknown>;
}

/** 한 대화의 E(T) 구성원과 그 출처. 출처는 공통 묶음 → 프로필 → 코어 순으로 정하고 처음 것을 남긴다 */
interface Membership {
  readonly sources: ReadonlyMap<string, EnabledSource>;
  readonly resolved: Resolved | undefined;
}

/**
 * 대화 하나에 쓰이는 플러그인의 참조를 세고 로더를 부르는 자리(M5c §4.1.11). 0→1에 `ensureLoaded`, 1→0에 `unload`를 부른다.
 * 조립 루트(`ports.ts`)가 로더에 연결한다. 로더에 없는 이름(내장 단위, 아직 설치하지 않은 이름)은 조립이 건너뛴다
 */
export interface PluginLifecycle {
  ensureLoaded(name: string): Promise<unknown>;
  unload(name: string): Promise<unknown>;
}

export interface PluginSetDeps {
  readonly profiles: Pick<ProfileTestRunPort, "list" | "onProfilesWritten">;
  /** 대화가 저장한 프로필 id. 저장하지 않았거나 대화가 없으면 null이다 */
  readonly threadProfileId: (threadId: ThreadId) => string | null;
  /** 엔진이 열어 쥔 대화 목록(E(T)를 계산할 대화). 프로필이 바뀌었을 때 다시 맞춘다 */
  readonly openThreadIds: () => readonly ThreadId[];
  /**
   * 관리 범위가 `ext.<이름>.enabled = false`로 잠갔는가(M5c §4.1.10). 기본값과 사용자 값은 잠금이 아니다.
   * 기본값을 세면 매니페스트 기본이 꺼짐인 확장이 프로필에 있어도 빠진다
   */
  readonly managedOff: (name: string) => boolean;
  /**
   * 오류로 멈춘 플러그인인가(M5c §4.1.12). `autoDisabler.disabled()`가 `ext:<이름>`을 든 것이다. 멈춘 플러그인은 모든 대화의
   * E(T)에서 빠지므로 대화를 다시 열어도 살아나지 않는다. 풀기는 `ext.reenable`이 한다
   */
  readonly stopped: (name: string) => boolean;
  readonly registrations: () => readonly RegistrationInfo[];
  /** 지금 실행 중인 검토본의 내용 해시(없으면 undefined). E(T)의 `pluginHashes`가 된다(M5c §4.6.7) */
  readonly loadedHash: (name: string) => string | undefined;
  /** 모든 대화에 항상 켜는 플러그인(코어와 개발 모드의 가이드 그룹). 관리 잠금은 여기서도 이긴다 */
  readonly forcedPlugins: () => readonly string[];
  /** 공장 기본 프로필의 플러그인. 확장을 찾은 뒤에 바뀌므로 복사하지 않고 읽을 때마다 묻는다 */
  readonly defaultPlugins: () => readonly string[];
  /** 적용 예약 통로(`requestApply`)와 등록 목록. E(T) 차이는 X가 낸다 */
  readonly toggles: RegistrationToggleSourceOf;
  /**
   * 대화의 `profile` 범위 설정 값이 바뀌었음을 알린다(M5c §4.1.7). 설정 엔진이 `SettingsChange`로 바꿔 구독자에게 전한다.
   * 바뀐 키만 싣는다
   */
  readonly settingsChanged: (change: {
    readonly keys: readonly string[];
    readonly scopes: readonly ["profile"];
    readonly threadId: ThreadId;
  }) => void;
  /** 대화 참조를 세어 로더에 알린다. 없으면 참조만 세고 아무것도 하지 않는다(조립이 연결하기 전) */
  readonly lifecycle?: PluginLifecycle;
  /** 진단 기록(호스트 로그). 프로필을 못 읽은 것과 로더 호출 실패는 알리고 계속한다 */
  readonly report: (message: string, fields: Readonly<Record<string, string>>) => void;
}

export interface PluginSetHandle {
  readonly port: PluginSetPort;
  /** 저장된 프로필 목록을 다시 읽는다. 대화를 열기 전에 부른다. 열린 대화마다 적용을 예약한다 */
  refresh(): Promise<void>;
  /**
   * 한 대화의 E(T)가 바뀌었을 수 있음을 알리고 적용을 예약한다. 켜짐 요청은 X가 마지막으로 맞춘 값과의 차이만 낸다,
   * 그래서 엔진이 끈 등록은 E(T)가 바뀌기 전까지 다시 켜지지 않는다(M5c §4.1.5)
   */
  recompute(threadId: ThreadId): void;
  /** 열린 모든 대화의 E(T)를 다시 맞춘다. 오류 정지나 정지 풀기처럼 여러 대화에 걸치는 변화가 쓴다 */
  recomputeAll(): void;
  /**
   * 턴 덧씌우기를 얹고 입력 처리 앞에 적용을 기다린다(M5c §4.3.3). 같은 이름은 한 번만 얹는다.
   * 입력을 받지 못했으면 `cancelOverlay`로 되돌린다
   */
  attachOverlay(threadId: ThreadId, marks: readonly OverlayMark[]): Promise<void>;
  /** 얹은 턴 덧씌우기를 뺀다(입력이 접수되지 않았을 때). 집합을 다시 맞춘다 */
  cancelOverlay(threadId: ThreadId): Promise<void>;
  /**
   * 대화가 열렸다(엔진이 쥐었다). E(T)를 맞추고, 이 대화가 쓰는 플러그인의 적재(0→1)가 끝날 때까지 기다린다. 실패는 보고하고 연다
   */
  opened(threadId: ThreadId): Promise<void>;
  /**
   * 대화가 닫혔다(엔진이 쥔 것을 놓았다). 그 대화가 쓰던 플러그인의 참조를 놓는다(1→0이면 `unload`). 대화당 한 번만 부른다.
   * 기본 프로필의 플러그인은 시작 때 실려 있어 1→0에도 내리지 않는다 [제안]
   */
  forget(threadId: ThreadId): void;
  /** 대화가 저장한 프로필이 없을 때 쓰는 기본 프로필의 집합. 대화가 없는 조회(순서 미리 보기)가 쓴다 */
  defaultView(): PluginSetView;
  /** 대화의 E(T). 대화가 없으면 기본 프로필의 집합이다(`defaultView`와 같다) */
  viewOf(threadId: ThreadId | undefined): PluginSetView;
  /**
   * 프로필 하나가 만드는 집합과 그 `profile` 범위 설정 값(`blocks.applied`의 `profileId` 읽기, M5e-2). 공통 묶음을 포함하고 덧씌우기는 없다.
   * 저장한 프로필에 없는 id(`default`는 공장 기본이 있어 항상 있다)나 복사를 아직 못 읽었으면 undefined다
   */
  viewOfProfile(
    profileId: string,
  ): { readonly view: PluginSetView; readonly settings: ReadonlyMap<string, unknown> } | undefined;
  /** 대화의 `profile` 범위 층 값(공통 묶음 + 프로필, 프로필이 이긴다). 복사가 없으면 빈 값이다 */
  settingsOf(threadId: ThreadId): ReadonlyMap<string, unknown>;
  /** `ext.list`의 `enabledSource`(M5c §3.4). 대화가 없으면(undefined) 기본 프로필의 출처를 본다 */
  sourceOf(threadId: ThreadId | undefined, name: string): EnabledSource;
  dispose(): void;
}

/** 대화가 참조한 프로필을 고른다. 저장한 프로필이 없으면 기본을 쓴다(§4.1.1). 공장 기본(저장 전)이면 `factory`다 */
interface Picked {
  readonly usedId: string;
  readonly profile: Profile | undefined;
  readonly factory: boolean;
  readonly missing: boolean;
  /** 숨은 `craft` 프로필인가. 공통 묶음을 받지 않는다(§4.8.5 [제안]) */
  readonly craft: boolean;
}

function pickProfile(copy: ProfileCopy, stored: string | null): Picked {
  // 숨은 `craft`는 저장 목록에 없다. 값은 프로필 정의에서 온다(저장하지 않는다)
  if (stored === CRAFT_PROFILE_ID) {
    return {
      usedId: CRAFT_PROFILE_ID,
      profile: craftProfile(),
      factory: false,
      missing: false,
      craft: true,
    };
  }
  const known = stored === null ? undefined : copy.profiles.find((p) => p.id === stored);
  const usedId = known?.id ?? DEFAULT_PROFILE_ID;
  const profile = copy.profiles.find((p) => p.id === usedId);
  // 저장하지 않은 기본(공장 값, 개정 0)은 지금 찾은 기본 플러그인을 쓴다(확장은 시작 뒤에도 더 찾힌다)
  const factory = usedId === DEFAULT_PROFILE_ID && (profile === undefined || profile.rev === 0);
  return {
    usedId,
    profile,
    factory,
    missing: stored !== null && known === undefined,
    craft: false,
  };
}

/**
 * `profile` 범위 층의 값. 공통 묶음 값을 프로필 값이 덮는다. 공장 값의 설정은 싣지 않는다: 사용자 파일의 권한 모드를
 * 가리지 않게 하려고(프로필을 한 번 저장하면 그때 싣는다, 구현 결정 2026-11-18)
 */
function settingsIn(copy: ProfileCopy, picked: Picked): ReadonlyMap<string, unknown> {
  const settings = new Map<string, unknown>();
  if (!picked.craft)
    for (const setting of copy.common.settings) settings.set(setting.key, setting.value);
  if (!picked.factory) {
    for (const setting of picked.profile?.settings ?? []) settings.set(setting.key, setting.value);
  }
  return settings;
}

/** 프로필 목록에서 대화 하나의 해소 결과를 만든다. 플러그인 이름은 `defaults`를 그때 묻는다(설정 읽기는 묻지 않는다) */
function resolveIn(
  copy: ProfileCopy,
  stored: string | null,
  defaults: () => readonly string[],
): Resolved {
  const picked = pickProfile(copy, stored);
  return {
    profileId: picked.usedId,
    profileRev: picked.profile?.rev ?? 0,
    commonRev: copy.common.rev,
    ...(picked.missing && stored !== null ? { missingProfileId: stored } : {}),
    common: picked.craft ? [] : copy.common.plugins.map((ref) => ref.name),
    profile: picked.factory ? defaults() : (picked.profile?.plugins ?? []).map((ref) => ref.name),
    settings: settingsIn(copy, picked),
  };
}

/** 두 설정 맵에서 값이 다른 키(추가·삭제·변경) */
function changedKeys(
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): readonly string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key) !== after.get(key));
}

export function createPluginSet(deps: PluginSetDeps): PluginSetHandle {
  let copy: ProfileCopy | undefined;
  /** 대화별로 E(T)에 든 플러그인 이름(코어 제외). 참조 수를 바꾸는 근거다 */
  const usage = new Map<ThreadId, ReadonlySet<string>>();
  /** 플러그인 이름별 참조 대화 수. 0→1에 `ensureLoaded`, 1→0에 `unload`를 부른다 */
  const refs = new Map<string, number>();
  /** 대화별 턴 덧씌우기. 정착할 때 `turnSettled`가 지운다 */
  const overlays = new Map<ThreadId, readonly OverlayMark[]>();
  /**
   * 플러그인 이름별로 아직 끝나지 않은 로더 호출(적재·내리기). 같은 이름의 호출은 차례로 돈다(내리기 뒤 적재가 겹치지 않게).
   * `opened`가 그 대화가 쓰는 이름의 호출을 기다린다. 호출은 실패해도 거절하지 않는다(보고만 한다)
   */
  const loading = new Map<string, Promise<void>>();

  /** 저장한 프로필 id를 쓰는 대화 하나의 해소 결과(복사가 없으면 undefined) */
  function resolvedOf(threadId: ThreadId | undefined, profileId?: string): Resolved | undefined {
    const current = copy;
    if (current === undefined) return undefined;
    const stored =
      profileId !== undefined
        ? profileId
        : threadId === undefined
          ? null
          : deps.threadProfileId(threadId);
    return resolveIn(current, stored, deps.defaultPlugins);
  }

  /** E(T)의 구성원과 출처. 복사를 아직 못 읽었으면 등록된 모든 확장을 본다(읽지 못해 전부 끄지 않는다) */
  function membershipOf(threadId: ThreadId | undefined, profileId?: string): Membership {
    const resolved = resolvedOf(threadId, profileId);
    const sources = new Map<string, EnabledSource>();
    const put = (name: string, source: EnabledSource): void => {
      if (!sources.has(name)) sources.set(name, source);
    };
    for (const name of deps.forcedPlugins()) put(name, "core");
    if (resolved === undefined) {
      for (const info of deps.registrations()) put(info.extension, "profile");
    } else {
      for (const name of resolved.common) put(name, "common");
      for (const name of resolved.profile) put(name, "profile");
    }
    // 덧씌우기는 프로필 목록 뒤에 든다(M5c §4.1.3). 같은 이름은 처음 것을 남긴다
    for (const mark of marksOf(threadId)) put(mark.plugin, "overlay");
    return { sources, resolved };
  }

  /** 대화의 턴 덧씌우기 표지. 없으면 빈 목록이다 */
  function marksOf(threadId: ThreadId | undefined): readonly OverlayMark[] {
    return threadId === undefined ? [] : (overlays.get(threadId) ?? []);
  }

  function setOverlays(threadId: ThreadId, marks: readonly OverlayMark[]): void {
    if (marks.length === 0) overlays.delete(threadId);
    else overlays.set(threadId, marks);
  }

  /** E(T)에 실제로 들어가는 이름. 관리 잠금, 오류 정지, 훅 단위는 뺀다 */
  function admitted(sources: ReadonlyMap<string, EnabledSource>): string[] {
    return [...sources.keys()].filter(
      (name) => !deps.managedOff(name) && !deps.stopped(name) && !isHookUnitName(name),
    );
  }

  function viewOf(threadId: ThreadId | undefined, profileId?: string): PluginSetView {
    const { sources, resolved } = membershipOf(threadId, profileId);
    const plugins = admitted(sources);
    const pluginHashes = plugins.flatMap((name) => {
      const contentHash = deps.loadedHash(name);
      return contentHash === undefined ? [] : [{ plugin: name, contentHash }];
    });
    // 관리 잠금으로 빠진 덧씌우기는 표지에도 싣지 않는다(집합에 없는 것을 적용됐다고 보이지 않게)
    const live = marksOf(threadId).filter((mark) => plugins.includes(mark.plugin));
    return {
      plugins,
      pluginHashes,
      ...(live.length === 0
        ? {}
        : {
            overlay: live.map((mark) => ({
              plugin: mark.plugin,
              contentHash: mark.contentHash,
              until: mark.until,
            })),
          }),
      profileId: resolved?.profileId ?? DEFAULT_PROFILE_ID,
      profileRev: resolved?.profileRev ?? 0,
      commonRev: resolved?.commonRev ?? 0,
      ...(resolved?.missingProfileId === undefined
        ? {}
        : { missingProfileId: resolved.missingProfileId }),
    };
  }

  /** 대화 하나의 참조 집합을 바꾸고, 0→1과 1→0 경계에서 로더를 부른다. 실패는 보고하고 계속한다 */
  function trackUsage(threadId: ThreadId, next: ReadonlySet<string>): void {
    const before = usage.get(threadId) ?? new Set<string>();
    if (next.size === 0) usage.delete(threadId);
    else usage.set(threadId, next);
    for (const name of next) if (!before.has(name)) acquire(name);
    for (const name of before) if (!next.has(name)) release(name);
  }

  /**
   * 로더 호출을 같은 이름의 앞선 호출 뒤에 돌린다. 앞선 호출이 없으면 지금 부른다. 실패는 보고하고 거절하지 않는다
   */
  function queue(name: string, run: () => Promise<unknown>, event: string): void {
    const previous = loading.get(name);
    const work =
      previous === undefined
        ? finish(name, run, event)
        : previous.then(() => finish(name, run, event));
    loading.set(name, work);
    detach(done(name, work), (cause) => {
      deps.report("plugin_set.queue_failed", { plugin: name, reason: reasonOf(cause) });
    });
  }

  async function finish(name: string, run: () => Promise<unknown>, event: string): Promise<void> {
    const result = await attemptAsync(run);
    if (!result.ok) deps.report(event, { plugin: name, reason: reasonOf(result.error.cause) });
  }

  /** 끝난 호출의 표를 지운다. 그 사이 같은 이름의 뒤 호출이 표를 바꿨으면 그대로 둔다(그 호출이 지운다) */
  async function done(name: string, work: Promise<void>): Promise<void> {
    await work;
    if (loading.get(name) === work) loading.delete(name);
  }

  function acquire(name: string): void {
    const count = refs.get(name) ?? 0;
    refs.set(name, count + 1);
    const lifecycle = deps.lifecycle;
    if (count > 0 || lifecycle === undefined) return;
    queue(name, () => lifecycle.ensureLoaded(name), "plugin_set.load_failed");
  }

  function release(name: string): void {
    const count = refs.get(name) ?? 0;
    if (count > 1) {
      refs.set(name, count - 1);
      return;
    }
    refs.delete(name);
    const lifecycle = deps.lifecycle;
    // 기본 프로필의 플러그인은 시작 때 실려 있다. 대화가 모두 닫혀도 내리지 않는다(다음 대화가 바로 쓰게 둔다) [제안]
    if (lifecycle === undefined || deps.defaultPlugins().includes(name)) return;
    queue(name, () => lifecycle.unload(name), "plugin_set.unload_failed");
  }

  /** 대화의 E(T)에 든 외부 플러그인 참조를 맞춘다(0→1 적재, 1→0 내리기). 적용 요청은 하지 않는다 */
  function track(threadId: ThreadId): void {
    // 복사를 아직 못 읽었으면 E(T)가 바뀐 것이 없다. 읽으면 그때 다시 맞춘다
    if (copy === undefined) return;
    const { sources } = membershipOf(threadId);
    // 코어(출처 core)는 로더가 시작 때부터 싣는 단위라 참조를 세지 않는다
    const external = admitted(sources).filter((name) => sources.get(name) !== "core");
    trackUsage(threadId, new Set(external));
  }

  function recompute(threadId: ThreadId): void {
    if (copy === undefined) return;
    track(threadId);
    deps.toggles.requestApply(threadId);
  }

  function recomputeOpen(): void {
    for (const threadId of deps.openThreadIds()) recompute(threadId);
  }

  /**
   * 복사를 바꾼다. 바뀐 `profile` 범위 설정 키를 대화마다 알리고, 열린 대화의 E(T)를 다시 맞춘다.
   * 새 복사가 같은 값이면 알림은 나가지 않는다
   */
  function applyCopy(next: ProfileCopy): void {
    const previous = copy;
    copy = next;
    for (const threadId of deps.openThreadIds()) {
      const stored = deps.threadProfileId(threadId);
      const before =
        previous === undefined
          ? new Map<string, unknown>()
          : settingsIn(previous, pickProfile(previous, stored));
      const after = settingsIn(next, pickProfile(next, stored));
      const keys = changedKeys(before, after);
      if (keys.length > 0) deps.settingsChanged({ keys, scopes: ["profile"], threadId });
      recompute(threadId);
    }
  }

  async function refresh(): Promise<void> {
    const listed = await deps.profiles.list();
    if (!listed.ok) {
      deps.report("plugin_set.profiles_unreadable", { kind: listed.error.kind });
      return;
    }
    applyCopy({ profiles: listed.value.profiles, common: listed.value.common });
  }

  // 저장이 끝난 순간의 내용으로 복사를 바꾸고 열린 대화의 적용을 예약한다. 쓰기 응답 전에 끝나므로 쓰고 바로 읽어도 새 집합이다
  const unsubscribe = deps.profiles.onProfilesWritten((written) => {
    applyCopy({ profiles: written.profiles, common: written.common });
  });

  return {
    port: {
      resolve: viewOf,
      // 턴이 정착하면 그 턴의 덧씌우기를 뺀다. 집합은 다음 유휴 적용에서 맞춘다(overlay_off)
      turnSettled: (threadId) => {
        if (!overlays.has(threadId)) return;
        overlays.delete(threadId);
        recompute(threadId);
      },
    },
    refresh,
    recompute,
    attachOverlay: async (threadId, marks) => {
      const merged = [...marksOf(threadId)];
      for (const mark of marks) {
        if (!merged.some((item) => item.plugin === mark.plugin)) merged.push(mark);
      }
      setOverlays(threadId, merged);
      if (copy === undefined) return;
      recompute(threadId);
      await deps.toggles.applyNow(threadId);
    },
    cancelOverlay: async (threadId) => {
      if (!overlays.has(threadId)) return;
      overlays.delete(threadId);
      if (copy === undefined) return;
      recompute(threadId);
      await deps.toggles.applyNow(threadId);
    },
    recomputeAll: recomputeOpen,
    async opened(threadId) {
      track(threadId);
      const names = [...(usage.get(threadId) ?? [])];
      await Promise.all(names.map((name) => loading.get(name) ?? Promise.resolve()));
      // 새로 실린 등록을 이 대화의 켜짐 집합에 맞춘다. 요청이 실패해도 대화는 연다(보고만 한다)
      if (copy === undefined) return;
      const applied = attempt(() => deps.toggles.requestApply(threadId));
      if (!applied.ok) {
        deps.report("plugin_set.apply_failed", { reason: reasonOf(applied.error.cause) });
      }
    },
    forget(threadId) {
      overlays.delete(threadId);
      trackUsage(threadId, new Set());
    },
    defaultView: () => viewOf(undefined),
    viewOf: (threadId) => viewOf(threadId),
    viewOfProfile(profileId) {
      const current = copy;
      if (current === undefined) return undefined;
      const picked = pickProfile(current, profileId);
      if (picked.missing && profileId !== DEFAULT_PROFILE_ID) return undefined;
      return { view: viewOf(undefined, profileId), settings: settingsIn(current, picked) };
    },
    settingsOf: (threadId) => {
      const current = copy;
      if (current === undefined) return new Map<string, unknown>();
      const stored = deps.threadProfileId(threadId);
      return settingsIn(current, pickProfile(current, stored));
    },
    sourceOf(threadId, name) {
      if (deps.managedOff(name)) return "managed";
      if (deps.stopped(name)) return "none";
      return membershipOf(threadId).sources.get(name) ?? "none";
    },
    dispose: unsubscribe,
  };
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 자동 끄기 알림을 따라 열린 대화의 E(T)를 다시 맞춘다(M5c §4.1.12). 엔진이 확장을 멈추면 자동 끄기 장부만 바뀌므로 알림이 유일한 신호다.
 * `autoDisabled`(질문에 "끈다"로 답했거나 기준으로 끈 것)와 `projectionFailed`가 끈 경우(`disabled` 참)를 본다.
 * 나머지 호출은 그대로 넘긴다.
 */
export function observeStops(notifier: OperationsNotifier, onStop: () => void): OperationsNotifier {
  return {
    handlerFailed: (outcome, stats, asksDisable) => {
      notifier.handlerFailed(outcome, stats, asksDisable);
    },
    disableUnasked: (key, verdict) => {
      notifier.disableUnasked(key, verdict);
    },
    autoDisabled: (key, verdict) => {
      notifier.autoDisabled(key, verdict);
      if (key.startsWith("ext:")) onStop();
    },
    projectionFailed: (key, cause, disabled) => {
      notifier.projectionFailed(key, cause, disabled);
      if (disabled && key.startsWith("ext:")) onStop();
    },
  };
}
