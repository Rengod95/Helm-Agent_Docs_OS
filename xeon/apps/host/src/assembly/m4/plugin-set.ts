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

/**
 * 대화에 얹는 덧씌우기 하나(M5c §4.3). `until`이 수명을 정한다: `turn`은 그 턴이 정착할 때, `release`는 시작 Drive의 주도
 * 프레임이 풀릴 때(§4.3.4)다. 메모리에 둔다. `release` 표지는 재시작 뒤 열린 임대에서 되살린다(`restoreOverlay`, §4.3.5). `turn` 표지는 되살리지 않는다
 */
export interface OverlayMark {
  /** 집합에 넣을 이름. 초안이면 내부 확장 이름이다(`internalDraftName`) */
  readonly plugin: string;
  readonly contentHash: string;
  readonly until: "turn" | "release";
  /**
   * 초안이면 그 식별자다(§4.3.8). 초안 표지는 `replaces`의 실제 이름을 집합에서 뺀다: 같은 이름의 검토본이 프로필, 공통 묶음,
   * 다른 덧씌우기에 있어도 그 대화에서는 초안이 자리를 대신한다
   */
  readonly draftId?: string;
  /** 초안이 자리를 대신하는 실제 플러그인 이름 */
  readonly replaces?: string;
}

/**
 * 테스트 실행의 고정 초안 하나(M5c §4.8.1). 대화의 수명 동안 고정이라 `until`이 없고 `PluginSetView.overlay`에 싣지 않는다.
 * `plugin`은 내부 확장 이름(`internalDraftName`)이고 `replaces`는 같은 이름의 검토본이다. 검토본이 E(T)에 있으면 그 자리에 놓인다
 */
export interface FixedDraftMark {
  readonly plugin: string;
  readonly draftId: string;
  readonly contentHash: string;
  readonly replaces: string;
  /**
   * 이 초안이 대화의 시작 Drive를 쓰는가(§4.8.1 항목 2 [결정: 2026-11-18, AGE-56]). 열 때 `ext.openThread`의 시작 요청이 된다(`ports.ts`의
   * `startDriveOf`). 생략하면 거짓이다
   */
  readonly startDrive?: boolean;
}

/**
 * 얹힌 덧씌우기 하나의 내부 상태. `granted`는 `release` 표지의 주도 프레임이 실제로 부여되어 스택에 든 적이 있는지다.
 * 시작 요청이 버려지면 끝까지 `false`이고, 정착할 때 뺀다. 기록에는 싣지 않는다
 */
interface HeldMark extends OverlayMark {
  readonly granted: boolean;
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
  /**
   * 하위 대화의 부모 대화(`agentOfChild`). 부모가 테스트 실행이면 하위 대화는 부모의 기준 프로필과 고정 초안을 물려받는다(§4.8.1 9).
   * 없으면 하위 대화도 일반 대화처럼 본다
   */
  readonly parentOf?: (threadId: ThreadId) => ThreadId | undefined;
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
  /** 주도 스택에 든 플러그인 이름(코어 루프는 빼고, 아래에서 위 순서). 열려 있지 않으면 빈 목록이다 */
  readonly driveFramePlugins: (threadId: ThreadId) => readonly string[];
  /**
   * 임대가 부여되거나 반납되어 커밋됐음을 알리는 구독(`ExtHost.onChange`의 `lease`). 시작 Drive 표지의 부여와 해제를 여기서 본다.
   * 돌려주는 함수는 구독을 끊는다
   */
  readonly driveFramesChanged: (listener: (threadId: ThreadId) => void) => () => void;
  /** 대화의 루프가 쉴 때 `fn`을 돈다. 루프가 도는 경계 안에서 생긴 집합 변화를 유휴 적용으로 미룬다 */
  readonly whenIdle: (threadId: ThreadId, fn: () => Promise<void>) => Promise<void>;
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
  /**
   * 초안을 내리지 못하게 잡는다(§4.3.8). 같은 이름에 이미 큐에 든 적재와 내리기가 끝날 때까지 기다린 뒤 돌려준 함수로 푼다.
   * 잡힌 동안 참조가 0이 되어도 내리기는 미룬다. 푸는 때 참조가 없으면 그때 내린다. 싣기 앞뒤를 이것으로 감싸야 얹기와 내리기가 겹치지 않는다
   */
  hold(names: readonly string[]): Promise<() => void>;
  /**
   * 테스트 실행의 고정 구성을 대화에 묶는다(M5c §4.8.1). 초안의 참조를 세어 쓰는 동안 싣고, 대화를 여는 때 다시 맞춘다.
   * 묶기 전에 `hold`로 잡아 두면 그 사이에 같은 초안이 내려가지 않는다. 묶은 대화는 `forget`에서 푼다
   */
  setTestRunDrafts(threadId: ThreadId, drafts: readonly FixedDraftMark[]): Promise<void>;
  /** 대화에 묶인 고정 초안. 테스트 실행이 아니면 undefined다(하위 대화의 물려받은 것은 뺀다) */
  testRunDraftsOf(threadId: ThreadId): readonly FixedDraftMark[] | undefined;
  /**
   * 재시작 뒤 열린 임대에서 되살린 Drive 덧씌우기를 얹고, 이 대화가 쓰는 플러그인의 적재가 끝날 때까지 기다린다(M5c §4.3.5).
   * `ext.openThread` 앞에 부른다: 열 때 scope가 살아 있어야 프레임이 죽은 scope로 반납되지 않는다. `release` 표지만 받는다.
   * 프로필·공통 묶음·코어에 든 이름, 관리 잠금, 오류 정지, 훅 단위는 얹지 않는다. 적용은 열 때의 첫 경계가 한다
   */
  restoreOverlay(threadId: ThreadId, marks: readonly OverlayMark[]): Promise<void>;
  /**
   * 얹은 덧씌우기를 되돌린다(입력이 접수되지 않았을 때). 턴 표지는 뺀다. 부여되지 않은 release 표지는 `keepDrive`가 거짓일 때만 뺀다
   * (참이면 시작 요청이 큐에 있어 입력을 주도 프레임이 받은 것이다). 부여된 release 표지는 프레임이 풀릴 때까지 남는다
   */
  cancelOverlay(threadId: ThreadId, keepDrive: boolean): Promise<void>;
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

/** 덧씌우기 표지 하나를 `PluginSetView.overlay` 항목으로 낸다. 초안은 자리를 대신하는 실제 이름과 식별자를 싣는다 */
function overlayItemOf(mark: HeldMark): NonNullable<PluginSetView["overlay"]>[number] {
  const item = {
    plugin: mark.replaces ?? mark.plugin,
    contentHash: mark.contentHash,
    until: mark.until,
  };
  return mark.draftId === undefined ? item : { ...item, draftId: mark.draftId };
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
  /** 대화별 덧씌우기 표지. 턴 표지는 정착할 때, 부여되지 않은 release 표지도 정착할 때, 부여된 release 표지는 프레임이 풀릴 때 뺀다 */
  const overlays = new Map<ThreadId, readonly HeldMark[]>();
  /**
   * 플러그인 이름별로 아직 끝나지 않은 로더 호출(적재·내리기). 같은 이름의 호출은 차례로 돈다(내리기 뒤 적재가 겹치지 않게).
   * `opened`가 그 대화가 쓰는 이름의 호출을 기다린다. 호출은 실패해도 거절하지 않는다(보고만 한다)
   */
  const loading = new Map<string, Promise<void>>();
  /** 테스트 실행 대화의 고정 초안(§4.8.1). 열린 대화에 묶여 있고 `forget`이 뺀다 */
  const testRuns = new Map<ThreadId, readonly FixedDraftMark[]>();
  /** 붙잡힌 이름과 붙잡은 수(`hold`). 붙잡힌 동안 참조가 0이 되어도 내리기를 큐에 넣지 않는다 */
  const pins = new Map<string, number>();

  /** 테스트 실행의 부모 대화. 부모가 고정 구성을 묶은 테스트 실행이면 그 id다 */
  function testRunParentOf(threadId: ThreadId): ThreadId | undefined {
    // 테스트 실행이 하나도 묶이지 않았으면 부모를 물을 까닭이 없다(일반 대화의 집합 계산은 그대로 둔다)
    if (testRuns.size === 0) return undefined;
    const parent = deps.parentOf?.(threadId);
    return parent !== undefined && testRuns.has(parent) ? parent : undefined;
  }

  /** 대화가 저장한 프로필 id. 하위 대화는 테스트 실행의 부모가 저장한 기준 프로필을 물려받는다(§4.8.1 9) */
  function storedProfileOf(threadId: ThreadId): string | null {
    const own = deps.threadProfileId(threadId);
    if (own !== null) return own;
    const parent = testRunParentOf(threadId);
    return parent === undefined ? null : deps.threadProfileId(parent);
  }

  /** 대화의 고정 초안. 하위 대화는 테스트 실행 부모의 것을 물려받는다. 없으면 빈 목록이다 */
  function fixedOf(threadId: ThreadId | undefined): readonly FixedDraftMark[] {
    if (threadId === undefined) return [];
    const own = testRuns.get(threadId);
    if (own !== undefined) return own;
    const parent = testRunParentOf(threadId);
    return parent === undefined ? [] : (testRuns.get(parent) ?? []);
  }

  /** 저장한 프로필 id를 쓰는 대화 하나의 해소 결과(복사가 없으면 undefined) */
  function resolvedOf(threadId: ThreadId | undefined, profileId?: string): Resolved | undefined {
    const current = copy;
    if (current === undefined) return undefined;
    const stored =
      profileId !== undefined
        ? profileId
        : threadId === undefined
          ? null
          : storedProfileOf(threadId);
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
    // 테스트 실행의 고정 초안은 같은 이름의 검토본 자리에 놓고, 없으면 뒤에 든다(§4.8.1 2)
    placeFixed(sources, fixedOf(threadId));
    // 덧씌우기는 프로필 목록 뒤에 든다(M5c §4.1.3). 같은 이름은 처음 것을 남긴다
    for (const mark of marksOf(threadId)) put(mark.plugin, "overlay");
    // 초안은 같은 이름의 실제 플러그인을 뺀다(프로필, 공통 묶음, 다른 덧씌우기 어디서 왔든)
    for (const mark of marksOf(threadId)) {
      if (mark.replaces !== undefined) sources.delete(mark.replaces);
    }
    return { sources, resolved };
  }

  /** 고정 초안을 E(T)에 놓는다. 같은 이름의 검토본이 있던 자리에 초안을 두고, 없는 이름은 뒤에 붙인다 */
  function placeFixed(
    sources: Map<string, EnabledSource>,
    drafts: readonly FixedDraftMark[],
  ): void {
    if (drafts.length === 0) return;
    const replacing = new Map(drafts.map((draft) => [draft.replaces, draft.plugin]));
    const placed = new Map<string, EnabledSource>();
    for (const [name, source] of sources) placed.set(replacing.get(name) ?? name, source);
    // 초안의 출처는 자리를 물려준 검토본의 출처다. 새 이름은 기준 구성의 한 칸으로 본다 [제안]
    for (const draft of drafts) if (!placed.has(draft.plugin)) placed.set(draft.plugin, "profile");
    sources.clear();
    for (const [name, source] of placed) sources.set(name, source);
  }

  /** 대화의 덧씌우기 표지. 없으면 빈 목록이다 */
  function marksOf(threadId: ThreadId | undefined): readonly HeldMark[] {
    return threadId === undefined ? [] : (overlays.get(threadId) ?? []);
  }

  function setOverlays(threadId: ThreadId, marks: readonly HeldMark[]): void {
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
            // 초안은 자리를 대신하는 실제 이름으로 싣는다(`profile.applied`의 기록이 이름을 읽는다)
            overlay: live.map(overlayItemOf),
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
    // 붙잡힌 이름은 붙잡음이 풀릴 때 내린다(`unpin`)
    if (pins.has(name)) return;
    scheduleUnload(name);
  }

  /** 참조가 없는 이름의 내리기를 큐에 넣는다. 기본 프로필의 플러그인은 내리지 않는다 */
  function scheduleUnload(name: string): void {
    const lifecycle = deps.lifecycle;
    // 기본 프로필의 플러그인은 시작 때 실려 있다. 대화가 모두 닫혀도 내리지 않는다(다음 대화가 바로 쓰게 둔다) [제안]
    if (lifecycle === undefined || deps.defaultPlugins().includes(name)) return;
    queue(name, () => lifecycle.unload(name), "plugin_set.unload_failed");
  }

  /** 붙잡음을 하나 푼다. 마지막 붙잡음이 풀리고 참조가 없으면 그때 내린다 */
  function unpin(name: string): void {
    const count = (pins.get(name) ?? 0) - 1;
    if (count > 0) {
      pins.set(name, count);
      return;
    }
    pins.delete(name);
    if ((refs.get(name) ?? 0) === 0) scheduleUnload(name);
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

  /**
   * 턴 정착이나 임대 해제 알림은 루프가 아직 도는 경계 안에서 온다. 그 경계는 이미 적용을 끝냈으므로 `requestApply`는 실행 중이라
   * 건너뛰고, 다음 단계 경계가 없어 변화가 적용되지 않는다. 그래서 루프가 쉴 때 적용한다. 단계 경계가 먼저 맞췄으면 차이가 없다
   */
  function recomputeWhenIdle(threadId: ThreadId): void {
    if (copy === undefined) return;
    track(threadId);
    detach(
      deps.whenIdle(threadId, () => deps.toggles.applyNow(threadId)),
      (cause) => {
        deps.report("plugin_set.apply_failed", { reason: reasonOf(cause) });
      },
    );
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
      const stored = storedProfileOf(threadId);
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

  /**
   * 임대가 바뀌었다. 이 대화의 `release` 표지를 본다: 프레임에 든 것은 부여됐다고 적고, 부여된 뒤 프레임에서 빠진 것은 뺀다.
   * 뺐으면 E(T)를 다시 맞춘다(그 경계에서 `overlay_off`가 남는다). 부여되지 않은 것은 정착까지 기다린다
   */
  function driveChanged(threadId: ThreadId): void {
    const marks = marksOf(threadId);
    if (!marks.some((mark) => mark.until === "release")) return;
    const framed = new Set(deps.driveFramePlugins(threadId));
    const next: HeldMark[] = [];
    let removed = false;
    for (const mark of marks) {
      if (mark.until === "turn") {
        next.push(mark);
      } else if (framed.has(mark.plugin)) {
        next.push(mark.granted ? mark : { ...mark, granted: true });
      } else if (mark.granted) {
        removed = true;
      } else {
        next.push(mark);
      }
    }
    setOverlays(threadId, next);
    if (removed) recomputeWhenIdle(threadId);
  }

  const offDriveChanges = deps.driveFramesChanged((threadId) => {
    driveChanged(threadId);
  });

  /** 정착이나 취소 때 남길 표지. 턴 표지와, 부여되지 않은 release 표지는 뺀다. 부여된 release 표지는 프레임이 풀릴 때까지 남는다 */
  function keptAfterTurn(marks: readonly HeldMark[]): readonly HeldMark[] {
    return marks.filter((mark) => mark.until === "release" && mark.granted);
  }

  return {
    port: {
      resolve: viewOf,
      // 턴이 정착하면 그 턴의 덧씌우기를 뺀다. 프레임이 쥔 시작 Drive 표지는 남긴다. 집합은 다음 유휴 적용에서 맞춘다(overlay_off)
      turnSettled: (threadId) => {
        const marks = marksOf(threadId);
        const kept = keptAfterTurn(marks);
        if (kept.length === marks.length) return;
        setOverlays(threadId, kept);
        recomputeWhenIdle(threadId);
      },
    },
    refresh,
    recompute,
    attachOverlay: async (threadId, marks) => {
      const merged = [...marksOf(threadId)];
      for (const mark of marks) {
        const at = merged.findIndex((item) => item.plugin === mark.plugin);
        if (at < 0) {
          merged.push({ ...mark, granted: false });
          continue;
        }
        // 같은 이름이 턴 표지로 있으면 수명이 긴 release로 올린다. 그 밖에는 처음 것을 남긴다
        const existing = merged[at];
        if (mark.until === "release" && existing?.until === "turn") {
          merged[at] = { ...mark, granted: false };
        }
      }
      setOverlays(threadId, merged);
      if (copy === undefined) return;
      recompute(threadId);
      await deps.toggles.applyNow(threadId);
    },
    hold: async (names) => {
      for (const name of names) pins.set(name, (pins.get(name) ?? 0) + 1);
      // 붙잡기 전에 큐에 든 같은 이름의 호출(내리기 포함)이 끝나기를 기다린다. 그 뒤의 싣기는 실린 것을 바로 본다
      await Promise.all(names.map((name) => loading.get(name) ?? Promise.resolve()));
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        for (const name of names) unpin(name);
      };
    },
    setTestRunDrafts: async (threadId, drafts) => {
      // 참조를 세려면 프로필 복사가 있어야 한다. 아직 없으면 읽는다
      if (copy === undefined) await refresh();
      testRuns.set(threadId, drafts);
      track(threadId);
    },
    testRunDraftsOf: (threadId) => testRuns.get(threadId),
    restoreOverlay: async (threadId, marks) => {
      // 복사를 아직 못 읽었으면 읽는다. 그래도 없으면 E(T)를 셀 수 없으므로 얹지 않는다(열 때 그 프레임은 restart로 반납된다)
      if (copy === undefined) await refresh();
      if (copy === undefined) return;
      const { sources } = membershipOf(threadId);
      const restored: HeldMark[] = [];
      for (const mark of marks) {
        if (mark.until !== "release") continue;
        if (sources.has(mark.plugin) || restored.some((item) => item.plugin === mark.plugin)) {
          continue;
        }
        if (deps.managedOff(mark.plugin) || deps.stopped(mark.plugin)) continue;
        if (isHookUnitName(mark.plugin)) continue;
        restored.push({ ...mark, granted: true });
      }
      if (restored.length === 0) return;
      const kept = marksOf(threadId).filter(
        (item) => !restored.some((mark) => mark.plugin === item.plugin),
      );
      setOverlays(threadId, [...kept, ...restored]);
      // 적재는 참조가 0→1일 때 시작된다. 그 호출이 끝날 때까지 기다린다(열 때 scope가 있어야 한다)
      track(threadId);
      await Promise.all(restored.map((mark) => loading.get(mark.plugin) ?? Promise.resolve()));
    },
    cancelOverlay: async (threadId, keepDrive) => {
      // 입력이 접수되지 않았을 때 되돌린다. 프레임이 쥔 표지는 프레임이 풀릴 때까지 남고, 시작 요청이 큐에 있으면 부여되지 않은 것도 남긴다
      const marks = marksOf(threadId);
      const kept = marks.filter((mark) => mark.until === "release" && (mark.granted || keepDrive));
      if (kept.length === marks.length) return;
      setOverlays(threadId, kept);
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
      testRuns.delete(threadId);
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
      const stored = storedProfileOf(threadId);
      return settingsIn(current, pickProfile(current, stored));
    },
    sourceOf(threadId, name) {
      if (deps.managedOff(name)) return "managed";
      if (deps.stopped(name)) return "none";
      return membershipOf(threadId).sources.get(name) ?? "none";
    },
    dispose: () => {
      offDriveChanges();
      unsubscribe();
    },
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
