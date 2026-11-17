import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PluginSetPort, PluginSetView } from "@fresnel/contracts/extensions";
import type { CommonSet, Profile } from "@fresnel/contracts/wire";
import {
  isHookUnitName,
  type RegistrationInfo,
  type RegistrationToggleSourceOf,
} from "@fresnel/ext-host";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";

// M5c §3.5, §4.1: 대화별 켜짐 집합 E(T) = 코어 ∪ (공통.plugins ∪ 프로필.plugins, 처음 것을 남김) − 관리 잠금.
// 호스트가 구현해 X에 `PluginSetPortKey`로 준다. 읽기는 동기여야 하므로 프로필 목록은 메모리에 둔 복사를 쓴다.
// 프로필을 바꾸면 복사를 다시 읽고, 열린 대화마다 적용을 예약한다. 차이(바뀐 등록)는 X가 마지막으로 맞춘 값과 비교해 낸다(적용은 다음 경계, 유휴면 다음 매크로태스크).
// 훅 단위(설정 파일의 `x.operations.hookDefs`)는 플러그인이 아니라서 이 집합이 켜고 끄지 않는다(폴더 신뢰와 저장된 끄기가 정한다).

const DEFAULT_PROFILE_ID = "default";

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

export interface PluginSetDeps {
  readonly profiles: Pick<ProfileTestRunPort, "list" | "onProfilesWritten">;
  /** 대화가 저장한 프로필 id. 저장하지 않았거나 대화가 없으면 null이다 */
  readonly threadProfileId: (threadId: ThreadId) => string | null;
  /** 닫히지 않은 대화 목록. 프로필이 바뀌었을 때 다시 맞춘다 */
  readonly openThreadIds: () => readonly ThreadId[];
  /**
   * 관리 범위가 `ext.<이름>.enabled = false`로 잠갔는가(M5c §4.1.10). 기본값과 사용자 값은 잠금이 아니다.
   * 기본값을 세면 매니페스트 기본이 꺼짐인 확장이 프로필에 있어도 빠진다
   */
  readonly managedOff: (name: string) => boolean;
  readonly registrations: () => readonly RegistrationInfo[];
  /** 지금 실행 중인 검토본의 내용 해시(없으면 undefined). E(T)의 `pluginHashes`가 된다(M5c §4.6.7) */
  readonly loadedHash: (name: string) => string | undefined;
  /** 모든 대화에 항상 켜는 플러그인(코어와 개발 모드의 가이드 그룹). 관리 잠금은 여기서도 이긴다 */
  readonly forcedPlugins: () => readonly string[];
  /** 공장 기본 프로필의 플러그인. 확장을 찾은 뒤에 바뀌므로 복사하지 않고 읽을 때마다 묻는다 */
  readonly defaultPlugins: () => readonly string[];
  /** 적용 예약 통로(`requestApply`)와 등록 목록. E(T) 차이는 X가 낸다 */
  readonly toggles: RegistrationToggleSourceOf;
  /** 진단 기록(호스트 로그). 프로필을 못 읽은 것은 알리고 계속한다 */
  readonly report: (message: string, fields: Readonly<Record<string, string>>) => void;
}

export interface PluginSetHandle {
  readonly port: PluginSetPort;
  /** 저장된 프로필 목록을 다시 읽는다. 대화를 열기 전에 부른다. 열린 대화마다 적용을 예약한다 */
  refresh(): Promise<void>;
  /**
   * 턴 덧씌우기를 얹고 입력 처리 앞에 적용을 기다린다(M5c §4.3.3). 같은 이름은 한 번만 얹는다.
   * 입력을 받지 못했으면 `cancelOverlay`로 되돌린다
   */
  attachOverlay(threadId: ThreadId, marks: readonly OverlayMark[]): Promise<void>;
  /** 얹은 턴 덧씌우기를 뺀다(입력이 접수되지 않았을 때). 집합을 다시 맞춘다 */
  cancelOverlay(threadId: ThreadId): Promise<void>;
  /**
   * 한 대화의 E(T)가 바뀌었을 수 있음을 알리고 적용을 예약한다. 켜짐 요청은 X가 마지막으로 맞춘 값과의 차이만 낸다,
   * 그래서 엔진이 끈 등록은 E(T)가 바뀌기 전까지 다시 켜지지 않는다(M5c §4.1.5)
   */
  recompute(threadId: ThreadId): void;
  /** 대화가 저장한 프로필이 없을 때 쓰는 기본 프로필의 집합. 대화가 없는 조회(순서 미리 보기)가 쓴다 */
  defaultView(): PluginSetView;
  dispose(): void;
}

export function createPluginSet(deps: PluginSetDeps): PluginSetHandle {
  let copy: ProfileCopy | undefined;
  /** 대화별 턴 덧씌우기. 정착할 때 `turnSettled`가 지운다 */
  const overlays = new Map<ThreadId, readonly OverlayMark[]>();

  /** 관리 잠금이 없는 플러그인 이름 */
  function allowed(names: readonly string[]): string[] {
    return names.filter((name) => !deps.managedOff(name));
  }

  /** 저장한 프로필 id(없으면 null)의 집합. 저장한 프로필이 없으면 기본을 쓰고 `missingProfileId`로 알린다 */
  function viewFor(stored: string | null, marks: readonly OverlayMark[]): PluginSetView {
    const current = copy;
    const known = stored === null ? undefined : current?.profiles.find((p) => p.id === stored);
    // 저장한 프로필이 없으면 기본을 쓴다(§4.1.1). 복사가 있는데 프로필이 없을 때만 missing으로 본다
    const usedId = known?.id ?? DEFAULT_PROFILE_ID;
    const profile = current?.profiles.find((p) => p.id === usedId);
    // 저장하지 않은 기본(공장 값, 개정 0)은 지금 찾은 기본 플러그인을 쓴다(확장은 시작 뒤에도 더 찾힌다)
    const factoryInUse =
      usedId === DEFAULT_PROFILE_ID && (profile === undefined || profile.rev === 0);
    const profileNames = factoryInUse
      ? deps.defaultPlugins()
      : (profile?.plugins ?? []).map((ref) => ref.name);
    // 복사를 아직 못 읽었으면 등록된 모든 확장을 본다(읽지 못해 전부 끄지 않는다)
    const base =
      current === undefined
        ? deps.registrations().map((info) => info.extension)
        : [...current.common.plugins.map((ref) => ref.name), ...profileNames];
    // 덧씌우기는 프로필 목록 뒤에 든다(M5c §4.1.3). 같은 이름은 처음 것을 남긴다
    const plugins = allowed(
      [...new Set([...deps.forcedPlugins(), ...base, ...marks.map((mark) => mark.plugin)])].filter(
        (name) => !isHookUnitName(name),
      ),
    );
    const pluginHashes = plugins.flatMap((name) => {
      const contentHash = deps.loadedHash(name);
      return contentHash === undefined ? [] : [{ plugin: name, contentHash }];
    });
    // 관리 잠금으로 빠진 덧씌우기는 표지에도 싣지 않는다(집합에 없는 것을 적용됐다고 보이지 않게)
    const live = marks.filter((mark) => plugins.includes(mark.plugin));
    return {
      plugins,
      profileId: usedId,
      profileRev: profile?.rev ?? 0,
      commonRev: current?.common.rev ?? 0,
      ...(stored !== null && current !== undefined && known === undefined
        ? { missingProfileId: stored }
        : {}),
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
    };
  }

  /** 대화의 턴 덧씌우기 표지. 없으면 빈 목록이다 */
  function marksOf(threadId: ThreadId): readonly OverlayMark[] {
    return overlays.get(threadId) ?? [];
  }

  function viewOf(threadId: ThreadId): PluginSetView {
    return viewFor(deps.threadProfileId(threadId), marksOf(threadId));
  }

  function recomputeOpen(): void {
    for (const threadId of deps.openThreadIds()) recompute(threadId);
  }

  async function refresh(): Promise<void> {
    const listed = await deps.profiles.list();
    if (!listed.ok) {
      deps.report("plugin_set.profiles_unreadable", { kind: listed.error.kind });
      return;
    }
    copy = { profiles: listed.value.profiles, common: listed.value.common };
    recomputeOpen();
  }

  function recompute(threadId: ThreadId): void {
    // 복사를 아직 못 읽었으면 E(T)가 바뀐 것이 없다. 읽으면 그때 다시 맞춘다
    if (copy === undefined) return;
    deps.toggles.requestApply(threadId);
  }

  function setOverlays(threadId: ThreadId, marks: readonly OverlayMark[]): void {
    if (marks.length === 0) overlays.delete(threadId);
    else overlays.set(threadId, marks);
  }

  // 저장이 끝난 순간의 내용으로 복사를 바꾸고 열린 대화의 적용을 예약한다. 쓰기 응답 전에 끝나므로 쓰고 바로 읽어도 새 집합이다
  const unsubscribe = deps.profiles.onProfilesWritten((written) => {
    copy = { profiles: written.profiles, common: written.common };
    recomputeOpen();
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
      await deps.toggles.applyNow(threadId);
    },
    cancelOverlay: async (threadId) => {
      if (!overlays.has(threadId)) return;
      overlays.delete(threadId);
      if (copy === undefined) return;
      await deps.toggles.applyNow(threadId);
    },
    defaultView: () => viewFor(null, []),
    dispose: unsubscribe,
  };
}
