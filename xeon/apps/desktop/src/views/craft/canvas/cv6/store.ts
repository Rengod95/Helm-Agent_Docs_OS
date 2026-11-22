// 캔버스 작업 상태: 보고 있는 프로필과 그 모양, 접은 묶음, 관계 선을 다 보일지. 캔버스와 내부 화면을 오가도 남도록 모듈 하나에 둔다.
// 프로필 화면(C3)은 엔진 값을 읽는다(`startLive`): 프로필과 공통 묶음, 카드, Hook 위치, 보고 있는 프로필의 적용 블록과 이슈.
// 바꾸면(넣기, 빼기, 순서) 바로 그리고 `profile.put`으로 쓴다. 거절되면 저장된 모양으로 되돌리고 그 까닭을 돌려준다.
// 표본(`shared-sample.ts`)은 개발 빌드의 표본 보기(`fresnel.craft.canvasSample` = "1")에서만 쓰고 저장하지 않는다.
import { err, ok, type Result } from "@fresnel/contracts";
import type { HookPositionRow } from "@fresnel/contracts/extensions";
import type {
  BlocksAppliedResult,
  CommonSet,
  Profile,
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
  pluginOfCard,
  profileInputOf,
  referencedNames,
} from "./live.ts";
import {
  attachProfile,
  installLiveCatalog,
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
