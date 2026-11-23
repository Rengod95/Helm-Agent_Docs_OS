// 캔버스 작업 상태: 보고 있는 프로필과 그 모양, 접은 묶음, 관계 선을 다 보일지. 캔버스와 내부 화면을 오가도 남도록 모듈 하나에 둔다.
// 프로필 화면(C3)은 엔진 값을 읽는다(`startLive`): 프로필과 공통 묶음, 카드, Hook 위치, 보고 있는 프로필의 적용 블록과 이슈.
// 바꾸면(넣기, 빼기, 순서) 바로 그리고 `profile.put`으로 쓴다. 거절되면 저장된 모양으로 되돌리고 그 까닭을 돌려준다.
// 프로필 고르기 옆 메뉴(`profile-menu.tsx`)의 새로 만들기, 복사, 이름 바꾸기, 지우기도 여기서 엔진에 쓰고 목록을 다시 읽는다.
// 표본(`shared-sample.ts`)은 개발 빌드의 표본 보기(`fresnel.craft.canvasSample` = "1")에서만 쓰고 저장하지 않는다.
import { err, ok, type Result } from "@fresnel/contracts";
import type { HookPositionRow } from "@fresnel/contracts/extensions";
import type { PermissionMode } from "@fresnel/contracts/services";
import type {
  BlocksAppliedResult,
  CommonSet,
  Profile,
  ProfileInput,
  ProfileIssue,
} from "@fresnel/contracts/wire";
import { useSyncExternalStore } from "react";
import { BUILD_CHECKS } from "../../../../app/build.ts";
import type { CommandError, ProfileCanvasCommands } from "../profile-source.ts";
import { initialScene } from "../shared-sample.ts";
import { attachCount } from "./sample-ext.ts";
import {
  canvasCards,
  canvasProfileOf,
  newProfileInput,
  pluginOfCard,
  profileIdFrom,
  profileInputOf,
  referencedNames,
  renamedInput,
  withModeInput,
} from "./live.ts";
import {
  attachProfile,
  installedPlugins,
  installLiveCatalog,
  requiredByOf,
  profileFromSample,
  type CanvasProfile,
  type SceneId,
} from "./model.ts";

/** 개발 빌드에서 표본 보기를 켜는 localStorage 키(값 "1") */
const SAMPLE_KEY = "fresnel.craft.canvasSample";

/** 엔진에서 읽은 값 */
interface LiveData {
  /** 저장된 프로필(id → 값). 저장할 때 `rev`를 `baseRev`로 보낸다 */
  readonly saved: Readonly<Record<string, Profile>>;
  readonly common: CommonSet;
  readonly positions: readonly HookPositionRow[];
  /** 프로필마다 실제로 적용된 블록(`blocks.applied`). 아직 못 읽었으면 없다 */
  readonly applied: Readonly<Record<string, BlocksAppliedResult>>;
  /** 프로필마다 미리 보기의 이슈(`profile.preview`) */
  readonly issues: Readonly<Record<string, readonly ProfileIssue[]>>;
  /** 쓰는 중인 프로필 id */
  readonly saving: string | null;
}

type CanvasStatus = "sample" | "loading" | "ready" | "failed";

export interface CanvasStore {
  readonly status: CanvasStatus;
  /** 읽기가 실패한 까닭(`failed`일 때) */
  readonly error: CommandError | null;
  readonly current: string;
  readonly profiles: Readonly<Record<string, CanvasProfile>>;
  /** 프로필 고르기 목록의 순서 */
  readonly order: readonly string[];
  readonly collapsed: ReadonlySet<string>;
  readonly allRelations: boolean;
  readonly live: LiveData | null;
}

/** 표본 보기를 쓰나: 개발 빌드이고 키가 켜져 있을 때만 */
function sampleWanted(): boolean {
  return (
    BUILD_CHECKS && typeof localStorage !== "undefined" && localStorage.getItem(SAMPLE_KEY) === "1"
  );
}

/** 표본의 처음 장면: 공통 장면 키가 "attach"면 "한 자리에 여럿", 아니면 공통 표본의 고름을 따른다 */
function firstScene(): SceneId {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("fresnel.craft.canvasScene") === "attach"
  )
    return "attach";
  return initialScene();
}

function sampleStore(): CanvasStore {
  return {
    status: "sample",
    error: null,
    current: firstScene(),
    profiles: {
      dev: profileFromSample("dev"),
      empty: profileFromSample("empty"),
      scale: profileFromSample("scale"),
      attach: attachProfile(attachCount()),
    },
    order: ["dev", "empty", "scale", "attach"],
    collapsed: new Set(),
    allRelations: false,
    live: null,
  };
}

function loadingStore(): CanvasStore {
  return {
    status: "loading",
    error: null,
    current: "",
    profiles: {},
    order: [],
    collapsed: new Set(),
    allRelations: false,
    live: null,
  };
}

let state: CanvasStore = sampleWanted() ? sampleStore() : loadingStore();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function updateStore(change: (s: CanvasStore) => CanvasStore): void {
  state = change(state);
  for (const fn of listeners) fn();
}

export function useCanvasStore(): CanvasStore {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

const EMPTY_PROFILE: CanvasProfile = { id: "", base: [], entries: [], startDrive: null };

export function currentProfile(s: CanvasStore): CanvasProfile {
  return s.profiles[s.current] ?? EMPTY_PROFILE;
}

export function setCollapsed(id: string, collapsed: boolean): void {
  updateStore((s) => {
    const next = new Set(s.collapsed);
    if (collapsed) next.add(id);
    else next.delete(id);
    return { ...s, collapsed: next };
  });
}

/** 보고 있는 프로필 이름. 표본은 null(화면이 표본 이름을 쓴다) */
export function titleOf(s: CanvasStore, id: string): string | null {
  return s.live?.saved[id]?.title ?? null;
}

/** 저장된 `default`가 있으면 그것, 없으면 목록의 첫 프로필 */
function firstProfile(profiles: readonly Profile[], wanted: string): string {
  if (profiles.some((p) => p.id === wanted)) return wanted;
  return profiles.find((p) => p.id === "default")?.id ?? profiles[0]?.id ?? "";
}

/** 한 프로필의 적용 블록과 이슈를 읽어 담는다. 실패하면 그 칸을 비워 둔다(블록 상세가 "읽지 못했어요"를 보인다) */
async function readProfileDetail(commands: ProfileCanvasCommands, id: string): Promise<void> {
  const [applied, preview] = await Promise.all([commands.applied(id), commands.preview(id)]);
  updateStore((s) => {
    if (s.live === null) return s;
    const nextApplied = { ...s.live.applied };
    const nextIssues = { ...s.live.issues };
    if (applied.ok) nextApplied[id] = applied.value;
    else delete nextApplied[id];
    if (preview.ok) nextIssues[id] = preview.value.issues;
    else delete nextIssues[id];
    return { ...s, live: { ...s.live, applied: nextApplied, issues: nextIssues } };
  });
}

/**
 * 엔진 값을 읽어 프로필 화면을 채운다. 표본 보기면 아무것도 하지 않는다. 화면을 열 때마다 다시 읽는다
 * (다른 화면에서 바꾼 프로필, 새로 승인한 플러그인이 보인다)
 */
export async function startLive(commands: ProfileCanvasCommands): Promise<void> {
  if (state.status === "sample") return;
  const [profiles, cards, blocks] = await Promise.all([
    commands.profiles(),
    commands.cards(),
    commands.blocks(),
  ]);
  if (!profiles.ok || !cards.ok || !blocks.ok) {
    const error = !profiles.ok ? profiles.error : !cards.ok ? cards.error : null;
    const why = error ?? (blocks.ok ? null : blocks.error);
    updateStore((s) => ({ ...s, status: "failed", error: why }));
    return;
  }
  const list = profiles.value.profiles;
  const common = profiles.value.common;
  installLiveCatalog(
    canvasCards(cards.value.plugins, referencedNames(list, common)).map(pluginOfCard),
  );
  const current = firstProfile(list, state.current);
  updateStore((s) => ({
    ...s,
    status: "ready",
    error: null,
    current,
    order: list.map((p) => p.id),
    profiles: Object.fromEntries(list.map((p) => [p.id, canvasProfileOf(p, common)])),
    live: {
      saved: Object.fromEntries(list.map((p) => [p.id, p])),
      common,
      positions: blocks.value.positions,
      applied: s.live?.applied ?? {},
      issues: s.live?.issues ?? {},
      saving: null,
    },
  }));
  if (current !== "") await readProfileDetail(commands, current);
}

/** 다른 프로필을 본다. 엔진 값이면 그 프로필의 적용 블록과 이슈를 읽는다 */
export async function chooseProfile(commands: ProfileCanvasCommands, id: string): Promise<void> {
  updateStore((s) => ({ ...s, current: id }));
  if (state.live !== null) await readProfileDetail(commands, id);
}

/**
 * 보고 있는 프로필을 바꾼다. 표본이면 담기만 한다. 엔진 값이면 바로 그리고 `profile.put`으로 쓴 뒤, 적용 블록과 이슈를 다시 읽는다.
 * 거절되면 저장된 모양으로 되돌리고 오류를 돌려준다(`rev`가 달라 거절되면 목록을 다시 읽는다)
 */
export async function saveProfile(
  commands: ProfileCanvasCommands,
  next: CanvasProfile,
): Promise<Result<null, CommandError>> {
  const id = state.current;
  updateStore((s) => ({ ...s, profiles: { ...s.profiles, [id]: next } }));
  const live = state.live;
  const saved = live?.saved[id];
  if (live === null || saved === undefined) return ok(null);
  updateStore((s) => (s.live === null ? s : { ...s, live: { ...s.live, saving: id } }));
  const put = await commands.put(profileInputOf(next, saved), saved.rev);
  if (!put.ok) {
    updateStore((s) => ({
      ...s,
      profiles: { ...s.profiles, [id]: canvasProfileOf(saved, live.common) },
      live: s.live === null ? null : { ...s.live, saving: null },
    }));
    if (put.error.kind === "rejected") await startLive(commands);
    return err(put.error);
  }
  const stored = put.value.profile;
  updateStore((s) =>
    s.live === null
      ? s
      : {
          ...s,
          profiles: { ...s.profiles, [id]: canvasProfileOf(stored, s.live.common) },
          live: { ...s.live, saving: null, saved: { ...s.live.saved, [id]: stored } },
        },
  );
  await readProfileDetail(commands, id);
  return ok(null);
}

/** 저장된 프로필 id 전부. 새 id가 겹치지 않게 고를 때 쓴다 */
function takenIds(): ReadonlySet<string> {
  return new Set(Object.keys(state.live?.saved ?? {}));
}

/** 이 프로필을 보이게 하고 목록을 다시 읽는다(`startLive`가 지금 프로필이 있으면 그대로 둔다) */
async function openAfterWrite(commands: ProfileCanvasCommands, id: string): Promise<void> {
  updateStore((s) => ({ ...s, current: id }));
  await startLive(commands);
}

/**
 * 새 빈 프로필을 만든다(`profile.put`, `baseRev` null). id는 이름에서 만들고 겹치면 번호를 붙인다(`profileIdFrom`).
 * 든 것은 엔진이 필요로 하는 플러그인뿐이고 공통 묶음은 베이스로 선다. 만든 뒤 그 프로필을 연다. 돌려주는 값은 새 id다
 */
export async function createProfile(
  commands: ProfileCanvasCommands,
  title: string,
): Promise<Result<string, CommandError>> {
  const id = profileIdFrom(title, takenIds());
  const required = installedPlugins()
    .map((p) => p.name)
    .filter((name) => requiredByOf(name).length > 0);
  const put = await commands.put(newProfileInput(id, title, required), null);
  if (!put.ok) return err(put.error);
  await openAfterWrite(commands, put.value.profile.id);
  return ok(put.value.profile.id);
}

/** 프로필을 복사한다(`profile.clone`). 새 id는 새 이름에서 만든다. 만든 뒤 복사본을 연다. 돌려주는 값은 새 id다 */
export async function cloneProfile(
  commands: ProfileCanvasCommands,
  sourceId: string,
  title: string,
): Promise<Result<string, CommandError>> {
  const newId = profileIdFrom(title, takenIds());
  const done = await commands.clone({ id: sourceId, newId, title });
  if (!done.ok) return err(done.error);
  await openAfterWrite(commands, done.value.profile.id);
  return ok(done.value.profile.id);
}

/** 이름만 바꾼다(`profile.put`, `baseRev`는 저장된 `rev`). 플러그인, 설정, 시작 Drive는 그대로다. `rev`가 달라 거절되면 목록을 다시 읽는다 */
export function renameProfile(
  commands: ProfileCanvasCommands,
  id: string,
  title: string,
): Promise<Result<null, CommandError>> {
  return rewriteSaved(commands, id, (saved) => renamedInput(saved, title));
}

/**
 * 프로필의 실행 방식(권한 모드)을 바꾼다(pfMode, AGE-71 질문 3). 설정 줄만 바꾸고 나머지는 저장된 그대로 `profile.put`으로 쓴다.
 * 기본 프로필도 바꿀 수 있다(처음 쓰면 공장 값이 저장된 행이 된다)
 */
export function setProfileMode(
  commands: ProfileCanvasCommands,
  id: string,
  mode: PermissionMode,
): Promise<Result<null, CommandError>> {
  return rewriteSaved(commands, id, (saved) => withModeInput(saved, mode));
}

/** 저장된 프로필 하나를 고친 값으로 쓴다(저장된 `rev`가 기준). 거절되면 목록을 다시 읽고 그 까닭을 돌려준다 */
async function rewriteSaved(
  commands: ProfileCanvasCommands,
  id: string,
  edit: (saved: Profile) => ProfileInput,
): Promise<Result<null, CommandError>> {
  const saved = state.live?.saved[id];
  if (saved === undefined) return ok(null);
  const put = await commands.put(edit(saved), saved.rev);
  if (!put.ok) {
    if (put.error.kind === "rejected") await startLive(commands);
    return err(put.error);
  }
  const stored = put.value.profile;
  updateStore((s) =>
    s.live === null ? s : { ...s, live: { ...s.live, saved: { ...s.live.saved, [id]: stored } } },
  );
  return ok(null);
}

/**
 * 프로필을 지운다(`profile.delete`). 엔진은 `default`와 숨은 `craft`를 거절한다. 지운 뒤 목록을 다시 읽고 `default`를 연다.
 * 돌려주는 값은 이 프로필을 쓰던 열린 대화 수다(엔진이 지운 뒤에 센다. 그 대화는 다음 읽기에서 `default`로 읽는다)
 */
export async function deleteProfile(
  commands: ProfileCanvasCommands,
  id: string,
): Promise<Result<number, CommandError>> {
  const done = await commands.remove(id);
  if (!done.ok) return err(done.error);
  await openAfterWrite(commands, "default");
  return ok(done.value.reassignedThreads);
}
