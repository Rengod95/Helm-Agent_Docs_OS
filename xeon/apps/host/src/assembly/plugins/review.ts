import { existsSync } from "node:fs";
import { copyFile, chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertNever,
  attempt,
  attemptAsync,
  err,
  ok,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import type { LocalIdFactory } from "@fresnel/contracts/conversation";
import { blockingDependents } from "@fresnel/ext-host";
import type {
  EvidenceRef,
  ImportedHookOrigin,
  PluginCard,
  PluginOriginKind,
  PluginSubmitPort,
  PluginSubmitRequest,
  PluginSubmitResult,
  PluginSubmitError,
} from "@fresnel/contracts/extensions";
import type {
  DraftInfo,
  PluginDraftFilesResult,
  PluginDraftFromInstructionParams,
  PluginDraftFromInstructionResult,
  PluginReviewFileResult,
  Provenance,
  ReviewFileSide,
  ProfileListResult,
  ReviewDecision,
  ReviewItem,
  ReviewItemRemoval,
  ReviewKind,
  ReviewState,
  WhatItDoesDiff,
} from "@fresnel/contracts/wire";
import type { PluginEditApplied, ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { PluginChange } from "../../handlers/m5/plugin-review.ts";
import { DEFAULT_PROFILE_ID } from "../m4/profile-defaults.ts";
import { pluginFactOf, type PluginFact } from "../m4/plugin-fact.ts";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";
import { buildPluginCard, withInstalledDependencies } from "./card.ts";
import { compareUtf8, hashPluginTree, type TreeError } from "./content-hash.ts";
import { diffCards } from "./diff.ts";
import {
  generatedNameOf,
  instructionIssuesOf,
  isInstructionFolder,
  manifestTextOf,
  purposeOf,
  writeInstructionFolder,
} from "./instruction.ts";
import { sequentially } from "../../util.ts";
import { collectInOrder, runInOrder } from "./in-order.ts";
import { readPluginFolder, type FolderRejection, type PluginFolder } from "./folder-reader.ts";
import {
  createPluginDraftIntake,
  type AdmitInput,
  type AdmitResult,
  type PluginDraftIntake,
} from "./intake.ts";
import type { PluginService, PluginSourceEntry, PluginSources } from "./service.ts";
import { reviewKeyOf } from "./review-key.ts";
import type {
  PluginReviewMeta,
  PluginStore,
  PluginStoreError,
  ReviewedVersion,
  ReviewOrigin,
} from "./store.ts";

// 검토 서비스(M5c §4.6~4.7, §4.9). 원본 훑기로 검토 항목을 만들고, 결정(승인·돌려보내기·버리기)을 기록하고, 초안과 제출을 다룬다.
// 쓰기 요청은 `serial`로 한 줄씩 처리한다. 승인은 승격 → current 교체 → 보관 정리 → 기록 → 훅 순서로 커밋한다.
// 프로필 쪽(검증, 갱신, 열린 대화 반영)은 `approvalHooks`가 맡는다(3b). 항목 파일 `queue/<itemId>.json`이 상태의 원천이다.
// 검토본 키(`review-key.ts`): 같은 이름이라도 프로젝트가 다르면 다른 검토본이다. 비교와 저장은 모두 키로 한다.

/** 검토본 보관 개수(M5c §4.6.6). current와 쓰이는 것은 이 수와 무관하게 남긴다 */
const KEEP_VERSIONS = 5;
/** 초안 보관 개수(M5c §4.9.2 [제안]). 검토 항목이 가리키는 초안은 넘어도 지우지 않는다 */
const KEEP_DRAFTS = 20;
/** 후보 파일 본문 상한(글자). wire 스키마의 `text` 최대 길이와 같다 */
const FILE_TEXT_LIMIT = 262144;

const IDLE_HEALTH: PluginCard["health"] = { state: "idle", lastActiveAt: null, lastError: null };

/** 승인 결정 한 가지. wire `ReviewDecision`의 approve 변형이다 */
type ApproveDecision = Extract<ReviewDecision, { readonly kind: "approve" }>;

/** 승인 한 번의 맥락. 훅이 같은 값을 받는다 */
export interface ApprovalContext {
  readonly item: ReviewItem;
  readonly decision: ApproveDecision;
  readonly approvedAt: string;
  /** 승인하는 플러그인의 매니페스트 사실(검증에 쓴다). 제거는 없다 */
  readonly facts: PluginFact | null;
}

/** 결정 하나의 결과. `appliedTo`는 승인이 프로필에 넣은 프로필 id다(3a는 항상 빈 목록) */
interface DecisionOutcome {
  readonly item: ReviewItem;
  readonly appliedTo: readonly string[];
  /** 적용된 프로필이 이미 가리키던 이 기기에 없는 플러그인(경고, AGE-34) */
  readonly missingPlugins: readonly string[];
}

/**
 * 승인 훅(M5c §4.7.3, §3.5). `beforeCommit`은 대상 프로필 검증만 한다(쓰지 않는다). 실패하면 아무것도 바뀌지 않는다.
 * `afterCommit`은 `current`를 바꾼 뒤 프로필을 갱신하고 적용한 프로필 id를 돌려준다. 실패하면 `current`를 옛 검토본으로 되돌린다.
 * `reflect`는 승인이 끝난 뒤 실행 중인 판을 맞춘다(다시 읽기, 열린 대화 반영). 실패는 호출자에게 주지 않는다(호스트가 기록한다)
 */
export interface ApprovalHooks {
  beforeCommit?(context: ApprovalContext): Promise<Result<void, PluginPortFailure>>;
  afterCommit?(context: ApprovalContext): Promise<Result<PluginEditApplied, PluginPortFailure>>;
  reflect?(context: ApprovalContext): Promise<void>;
}

/** 검토 서비스가 읽는 플러그인 서비스의 면 */
type PluginReviewSource = Pick<PluginService, "scan" | "sources" | "get">;

export interface PluginReviewDeps {
  readonly store: PluginStore;
  readonly plugins: PluginReviewSource;
  /** 제거 미리 보기(영향받는 프로필)와 한 줄 지침의 프로필 확인에 읽는다 */
  readonly profiles: Pick<ProfileTestRunPort, "list">;
  /** 사용자 플러그인 폴더(`<configDir>/plugins`). 한 줄 지침이 여기에 `<name>` 폴더를 만든다(§4.10) */
  readonly userDir: string;
  readonly ids: LocalIdFactory;
  /** 지금 시각(ISO) */
  readonly now: () => string;
  readonly log: Logger;
  /** 참이면 가져온 훅(환경 모드)이 샌드박스 안에서 돈다(설정 `l0.sandbox.sandboxImportedHooks`). 검토 카드의 권한 표시가 이 값을 따른다. 생략하면 거짓 */
  readonly envSandboxed?: () => boolean;
  /** 참이면 승인 전 드래프트가 좁은 샌드박스에서 돈다(설정 `l0.sandbox.narrowDrafts`). 검토 카드의 `runs.narrowBeforeApproval`이 이 값을 따른다. 생략하면 거짓 */
  readonly narrowDrafts?: () => boolean;
  /**
   * 돌려보내기 사유를 `originThreadId` 대화의 다음 입력으로 넣는다(M5c §4.7.3 [제안]). 대화가 없거나 닫혔으면 false다.
   * 생략하면 사유는 항목에만 남는다
   */
  readonly notifyOrigin?: (input: {
    readonly threadId: string;
    readonly reason: string;
    readonly itemId: string;
  }) => Promise<boolean>;
  /** 승인 훅. 3a에서는 생략한다 */
  readonly approvalHooks?: ApprovalHooks;
  /** 설치된 플러그인 사실. 제거 요청이 hard로 기대는 플러그인이 있는지 본다(AGE-33). 생략하면 검사하지 않는다 */
  readonly facts?: () => readonly PluginFact[];
}

/** 초안 만들기의 결과(`plugin.draft.create`) */
interface DraftCreated {
  readonly draftId: string;
  readonly contentHash: string;
  readonly card: PluginCard;
  readonly info: DraftInfo;
}

/** 검토 서비스의 공개 면. 처리기와 제출 포트가 쓴다 */
export interface PluginReview {
  /** 원본을 다시 훑고(`plugin.scan`) 새 검토 항목을 만든다 */
  scan(): Promise<Result<{ readonly queued: readonly string[] }, PluginPortFailure>>;
  /**
   * 프로젝트를 등록하거나 작업 폴더를 연 뒤의 훑기(M5c §4.5.7). 실패는 로그에 남고 여는 일은 막지 않는다
   */
  scanOpened(): Promise<void>;
  requestRemove(name: string): Promise<Result<{ readonly itemId: string }, PluginPortFailure>>;
  revert(name: string): Promise<Result<{ readonly restored: true }, PluginPortFailure>>;
  draftCreate(
    dir: string,
    originThreadId: string | undefined,
  ): Promise<Result<DraftCreated, PluginPortFailure>>;
  draftList(
    name: string,
  ): Promise<Result<{ readonly drafts: readonly DraftInfo[] }, PluginPortFailure>>;
  draftDiscard(draftId: string): Promise<Result<void, PluginPortFailure>>;
  /** 초안 한 버전의 파일 목록(읽기만, `plugin.draft.files`). 지워진 초안은 `draft_not_found`다 */
  draftFiles(draftId: string): Promise<Result<PluginDraftFilesResult, PluginPortFailure>>;
  /** 초안 한 버전의 파일 하나(읽기만, `plugin.draft.file`). 목록에 없는 경로는 `path_invalid`다 */
  draftFile(
    draftId: string,
    path: string,
  ): Promise<Result<PluginReviewFileResult, PluginPortFailure>>;
  /**
   * 초안 하나의 재료(덧씌우기가 쓴다, §4.3.8). 없으면 `ok(undefined)`다. 이름은 초안이 속한 플러그인이고 `tree`는 스냅샷 트리 폴더다
   */
  draftOf(draftId: string): Promise<
    Result<
      | {
          readonly name: string;
          readonly draftId: string;
          readonly contentHash: string;
          readonly tree: string;
        }
      | undefined,
      PluginPortFailure
    >
  >;
  /** 한 줄 지침 초안과 `user_instruction` 항목(§4.10). 폴더를 쓰고, 초안을 만들고, 항목을 연다. 직렬로 돈다 */
  fromInstruction(
    request: PluginDraftFromInstructionParams,
  ): Promise<Result<PluginDraftFromInstructionResult, PluginPortFailure>>;
  list(filter: {
    readonly state?: ReviewState;
    readonly name?: string;
  }): Promise<Result<{ readonly items: readonly ReviewItem[] }, PluginPortFailure>>;
  get(itemId: string): Promise<Result<{ readonly item: ReviewItem }, PluginPortFailure>>;
  /** `side`가 없으면 새 판(`candidate`)이다. `base`는 지난 승인 버전이다 */
  file(
    itemId: string,
    path: string,
    side?: ReviewFileSide,
  ): Promise<Result<PluginReviewFileResult, PluginPortFailure>>;
  submitDraft(draftId: string): Promise<Result<{ readonly itemId: string }, PluginPortFailure>>;
  decide(
    itemId: string,
    decision: ReviewDecision,
  ): Promise<Result<DecisionOutcome, PluginPortFailure>>;
  /** 승인 한 번을 커밋한다. `decide`가 부르고, 3b가 훅을 넘겨 다시 쓴다 */
  applyApproval(
    item: ReviewItem,
    decision: ApproveDecision,
    hooks: ApprovalHooks,
  ): Promise<Result<DecisionOutcome, PluginPortFailure>>;
  /** 대기 중인 검토 항목의 플러그인 이름(검토본이 없는 것 포함). 프로필 검증이 `plugin_not_reviewed`를 낼 때 쓴다 */
  pendingNames(): Promise<Result<readonly string[], PluginPortFailure>>;
  /** 담당 AI(플러그인 빌더)의 제출 포트. wire 메서드가 아니다(§3.5). 입구(`intake`)를 `assistant`로 부르는 얼굴이다 */
  readonly submitPort: PluginSubmitPort;
  /**
   * 공유 입구(§7.5 [제안]). 폴더를 초안으로 만들고 같은 직렬 구간에서 검토 항목을 만든다.
   * 마이그레이션 제출(`createMigrationSubmitter`)이 쓴다. 담당 AI와 한 줄 지침도 이 입구를 부른다
   */
  readonly intake: PluginDraftIntake;
  /** 항목과 검토본이 바뀔 때 알림을 받는다. 연결 허브가 `pluginReview.changed`와 `plugin.changed`로 보낸다 */
  onChanged(listener: (change: PluginChange) => void): () => void;
}

/** 저장소 실패를 처리기의 실패로 옮긴다. 코드는 저장소 오류의 종류다 */
function storeFailure(error: PluginStoreError): PluginPortFailure {
  return { kind: "store", code: error.kind };
}

/** 직렬화: 앞 작업이 끝나야 다음을 시작한다. 실패는 `run`으로 호출자에게 그대로 간다 */
function serialOf(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    // 다음 작업은 앞 작업이 끝났는지만 기다린다. 실패의 전달은 `run`이 맡는다
    tail = run.then(settled, settled);
    return run;
  };
}

function settled(): void {}

/** 검토본이 가질 수 있는 출처. 내장과 관리는 검토본을 두지 않는다 */
function reviewOriginOf(kind: PluginOriginKind): ReviewOrigin | null {
  switch (kind) {
    case "user":
      return "user";
    case "project":
      return "project";
    case "bundled":
      return "bundled";
    case "builtin":
    case "managed":
      return null;
    default:
      return assertNever(kind, "reviewOriginOf");
  }
}

/**
 * 카드 출처의 검토본 키. 사용자·번들은 이름이고 프로젝트는 `<projectId>/<이름>`이다. 내장·관리는 검토본이 없어 null이다.
 * 키가 형식에 맞지 않으면(프로젝트 출처인데 프로젝트 id가 없음 등) 저장소 실패다
 */
function keyOfOrigin(
  origin: PluginCard["origin"],
  name: string,
): Result<string | null, PluginPortFailure> {
  const kind = origin.kind;
  if (kind !== "user" && kind !== "project" && kind !== "bundled") return ok(null);
  const key = reviewKeyOf({ origin: kind, name, projectId: origin.projectId });
  return key.ok ? ok(key.value) : err(storeFailure(key.error));
}

/** 항목이 가리키는 검토본 키. 비교에만 쓴다. 형식이 틀린 키는 어떤 키와도 같지 않다(null) */
function itemKeyOf(item: ReviewItem): string | null {
  const key = keyOfOrigin(item.card.origin, item.name);
  return key.ok ? key.value : null;
}

/** 같은 검토본 키의 항목인가 */
function sameKey(item: ReviewItem, key: string): boolean {
  return itemKeyOf(item) === key;
}

/** 로그 줄의 프로젝트 칸. 프로젝트 출처 항목에만 있다 */
function projectFieldOf(origin: PluginCard["origin"]): { readonly projectId?: string } {
  return origin.kind === "project" && origin.projectId !== undefined
    ? { projectId: origin.projectId }
    : {};
}

/** 카드의 출처. 프로젝트 id가 있으면 함께 적는다 */
function originOf(kind: PluginOriginKind, projectId: string | null): PluginCard["origin"] {
  return projectId === null ? { kind } : { kind, projectId };
}

/** 항목을 만드는 재료. 제거는 후보가 없다 */
interface ItemFields {
  readonly kind: ReviewKind;
  readonly name: string;
  readonly candidateHash: string | null;
  readonly baseHash: string | null;
  readonly provenance: Provenance;
  readonly originThreadId: string | null;
  readonly originProfileId: string | null;
  readonly card: PluginCard;
  readonly diff: WhatItDoesDiff;
  readonly evidence: readonly EvidenceRef[];
  readonly files: ReviewItem["files"];
  /** 지난 승인 버전의 파일 목록. 읽지 못했거나 비교 대상이 없으면 생략한다 */
  readonly baseFiles?: ReviewItem["files"];
  readonly removal: ReviewItemRemoval | null;
}

function pendingItemOf(itemId: string, fields: ItemFields, createdAt: string): ReviewItem {
  return {
    itemId,
    kind: fields.kind,
    state: "pending",
    name: fields.name,
    candidateHash: fields.candidateHash,
    baseHash: fields.baseHash,
    provenance: fields.provenance,
    originThreadId: fields.originThreadId,
    originProfileId: fields.originProfileId,
    card: fields.card,
    diff: fields.diff,
    evidence: [...fields.evidence],
    files: [...fields.files],
    ...(fields.baseFiles === undefined ? {} : { baseFiles: [...fields.baseFiles] }),
    createdAt,
    decidedAt: null,
    reason: null,
    removal: fields.removal,
  };
}

/** 생성 시각 순(같으면 id 순)으로 정렬한 사본 */
function oldestFirst<T extends { readonly createdAt: string; readonly itemId: string }>(
  items: readonly T[],
): T[] {
  return items.toSorted((a, b) =>
    a.createdAt === b.createdAt
      ? compareUtf8(a.itemId, b.itemId)
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

/** 같은 검토본 키의 가장 최근 항목이 `discarded`이고 같은 해시인가(원본이 바뀔 때까지 다시 만들지 않는다, §4.7.3) */
function discardedAgain(items: readonly ReviewItem[], key: string, hash: string): boolean {
  const latest = oldestFirst(items.filter((item) => sameKey(item, key))).at(-1);
  return latest !== undefined && latest.state === "discarded" && latest.candidateHash === hash;
}

/** 후보 해시를 아직 쓰는 항목이 있는가(같은 후보를 가리키는 다른 항목이 있으면 후보 폴더를 지우지 않는다) */
function hashInUse(items: readonly ReviewItem[], hash: string, except: string): boolean {
  return items.some(
    (item) =>
      item.itemId !== except &&
      item.candidateHash === hash &&
      (item.state === "pending" || item.state === "approved"),
  );
}

function filesOf(folder: PluginFolder): ReviewItem["files"] {
  return folder.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }));
}

/** 지난 승인 버전의 파일 목록. 버전이 없거나 보관소에서 읽지 못하면 비워 둔다(그 항목은 비교 없이 새 내용만 보인다) */
function baseFilesOf(
  reviewed: ReviewedVersion | null,
  origin: PluginOriginKind,
): { readonly baseFiles?: ReviewItem["files"] } {
  if (reviewed === null) return {};
  const read = readPluginFolder(reviewed.treePath, { origin });
  return read.ok ? { baseFiles: filesOf(read.value) } : {};
}

/** 트리 해시 오류를 초안·제출의 실패로 옮긴다 */
function treeFailure(error: TreeError): PluginPortFailure {
  if (error.kind === "symlink_refused") return { kind: "symlink_refused" };
  if (error.kind === "too_large") return { kind: "too_large" };
  return {
    kind: "draft_invalid",
    issues: [{ code: error.kind, severity: "error", path: "", message: error.kind }],
  };
}

/** 폴더 읽기 거절을 초안·제출의 실패로 옮긴다. 진단 하나가 이슈 하나다 */
function rejectionFailure(rejection: FolderRejection): PluginPortFailure {
  return {
    kind: "draft_invalid",
    issues: rejection.diagnostics.map((item) => ({
      code: item.code,
      severity: item.severity,
      path: item.path,
      message: item.message,
    })),
  };
}

/** 저장소 실패를 초안·제출의 실패로 옮긴다. 트리가 거절된 경우는 그 종류를 살린다 */
function draftStoreFailure(error: PluginStoreError): PluginPortFailure {
  if (error.kind === "tree_rejected") return treeFailure(error.error);
  return storeFailure(error);
}

/** 제거 미리 보기: 이름을 든 프로필과 공통 묶음. 같이 지워지는 상태와 기록 수는 알 수 없어 `removes`에 적지 않는다 */
function removalOf(
  profiles: ProfileListResult,
  name: string,
  baseCard: PluginCard,
): ReviewItemRemoval {
  const affected = profiles.profiles
    .filter((profile) => profile.plugins.some((ref) => ref.name === name))
    .map((profile) => ({ profileId: profile.id, title: profile.title.slice(0, 128) }));
  if (profiles.common.plugins.some((ref) => ref.name === name)) {
    // 표시 이름은 화면이 `common` id로 정한다. 호스트는 사람이 읽는 문구를 두지 않는다
    affected.push({ profileId: "common", title: "common" });
  }
  return { affectedProfiles: affected, removes: { state: false, records: null }, baseCard };
}

/**
 * 끄기나 삭제가 hard로 기대는 곳이 있으면 `required_by` 거절 값, 없으면 null이다(AGE-33). 꺼진 플러그인은 기대지 않으니
 * 설치된 이름만 센다. 제거 요청과 승인 때 같은 검사를 쓴다
 */
export function requiredByRefusalOf(
  name: string,
  facts: readonly PluginFact[],
): PluginPortFailure | null {
  const nodes = facts.map((fact) => ({
    name: fact.name,
    version: fact.version,
    manifest: fact.manifest,
  }));
  const dependents = blockingDependents([name], nodes, new Set(nodes.map((node) => node.name)));
  if (dependents.length === 0) return null;
  return {
    kind: "dependency",
    reason: "required_by",
    plugin: name,
    items: dependents.map(({ dependency }) => ({
      from: dependency.from,
      target: dependency.target,
      kind: "hard",
      range: dependency.range,
      problem: "depended_on",
      found: null,
    })),
  };
}

/** 항목의 카드 의존 칸을 설치된 사실로 다시 채운 응답 값(AGE-33). 저장된 항목은 바꾸지 않는다 */
function withInstalledCard(item: ReviewItem, facts: readonly PluginFact[]): ReviewItem {
  return { ...item, card: withInstalledDependencies(item.card, facts) };
}

/** 후보 폴더의 카드. 검토 칸은 대기 상태로 적는다. 프로젝트 출처는 프로젝트 id를 싣는다 */
function candidateCard(
  folder: PluginFolder,
  origin: PluginOriginKind,
  projectId: string | null,
  itemId: string,
  reviewed: ReviewedVersion | null,
  envSandboxed: boolean,
  narrowDrafts: boolean,
  importedHookOrigin: ImportedHookOrigin | undefined,
): PluginCard {
  return buildPluginCard({
    folder,
    envSandboxed,
    narrowDrafts,
    ...(importedHookOrigin === undefined ? {} : { importedHookOrigin }),
    origin: originOf(origin, projectId),
    review: {
      state: "pending",
      currentHash: reviewed?.contentHash ?? null,
      pendingItemId: itemId,
      approvedAt: reviewed?.meta.approvedAt ?? null,
    },
    usedBy: [],
    health: IDLE_HEALTH,
  });
}

/** 초안 목록에서 이름이 같은 것, 생성 시각 순 */
function draftsNamed(drafts: readonly DraftInfo[], name: string): DraftInfo[] {
  return drafts
    .filter((draft) => draft.name === name)
    .toSorted((a, b) =>
      a.createdAt === b.createdAt
        ? compareUtf8(a.draftId, b.draftId)
        : a.createdAt < b.createdAt
          ? -1
          : 1,
    );
}

/** 검토본 기준: 이름마다 현재 검토본(없으면 null)과, 읽지 못해 이번에 건드리지 않을 이름 */
interface Baseline {
  readonly reviewed: Map<string, ReviewedVersion | null>;
  readonly unreadable: Set<string>;
}

/** 제출 실패를 포트의 실패로 옮긴다. 이슈의 경로는 JSON 포인터 자리에 그대로 둔다 */
function submitFailureOf(failure: PluginPortFailure): PluginSubmitError {
  if (failure.kind === "draft_invalid") {
    return {
      kind: "invalid",
      issues: failure.issues.map((issue) => ({
        severity: issue.severity,
        code: "schema",
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  if (failure.kind === "too_large") return { kind: "too_large" };
  if (failure.kind === "symlink_refused") return { kind: "symlink_refused" };
  return {
    kind: "invalid",
    issues: [{ severity: "error", code: "schema", path: "", message: failure.kind }],
  };
}

/** 후보 파일 본문. 이진이면 `text`가 null이고, 상한을 넘으면 잘라서 `truncated`다 */
function fileTextOf(path: string, bytes: Uint8Array): PluginReviewFileResult {
  const truncated = bytes.length > FILE_TEXT_LIMIT;
  const head = bytes.subarray(0, FILE_TEXT_LIMIT);
  if (head.includes(0)) return { path, text: null, truncated };
  const decoded = attempt(() => new TextDecoder("utf-8", { fatal: !truncated }).decode(head));
  return { path, text: decoded.ok ? decoded.value : null, truncated };
}

/** 트리의 파일을 원본 폴더로 옮긴다. 원본에 검토본에 없는 파일이 있으면 지운다. 해시에서 제외된 항목(`.git` 따위)은 건드리지 않는다 */
async function mirrorInto(
  wanted: readonly { readonly path: string; readonly executable: boolean }[],
  fromRoot: string,
  toRoot: string,
  present: readonly { readonly path: string }[],
): Promise<Result<void, PluginPortFailure>> {
  const keep = new Set(wanted.map((file) => file.path));
  const removal = await runInOrder(
    present.filter((file) => !keep.has(file.path)),
    async (file): Promise<Result<void, PluginPortFailure>> => {
      const removed = await attemptAsync(() => rm(join(toRoot, file.path), { force: true }));
      return removed.ok ? ok(undefined) : err({ kind: "store", code: "io" });
    },
  );
  if (!removal.ok) return removal;
  return runInOrder(wanted, async (file): Promise<Result<void, PluginPortFailure>> => {
    const to = join(toRoot, file.path);
    const made = await attemptAsync(() => mkdir(dirname(to), { recursive: true }));
    if (!made.ok) return err({ kind: "store", code: "io" });
    const copied = await attemptAsync(() => copyFile(join(fromRoot, file.path), to));
    if (!copied.ok) return err({ kind: "store", code: "io" });
    const mode = await attemptAsync(() => chmod(to, file.executable ? 0o755 : 0o644));
    return mode.ok ? ok(undefined) : err({ kind: "store", code: "io" });
  });
}

/** 검토 서비스를 만든다. 쓰기는 이 객체의 한 줄 큐를 지난다 */
export function createPluginReview(deps: PluginReviewDeps): PluginReview {
  const { store, plugins, log } = deps;
  const serial = serialOf();
  const listeners = new Set<(change: PluginChange) => void>();

  function emit(change: PluginChange): void {
    for (const listener of listeners) listener(change);
  }

  async function allItems(): Promise<Result<readonly ReviewItem[], PluginPortFailure>> {
    const listed = await store.listItems();
    return listed.ok ? ok(listed.value) : err(storeFailure(listed.error));
  }

  /** 항목을 쓰고 알림을 보낸다 */
  async function save(item: ReviewItem): Promise<Result<ReviewItem, PluginPortFailure>> {
    const written = await store.writeItem(item);
    if (!written.ok) return err(storeFailure(written.error));
    emit({ kind: "review", itemId: item.itemId, state: item.state });
    return ok(item);
  }

  /** 결정 한 줄을 기록에 남긴다. 시크릿 값과 파일 내용은 싣지 않는다 */
  async function logDecision(
    item: ReviewItem,
    decision: "approved" | "sent_back" | "discarded" | "superseded" | "withdrawn",
    profileIds: readonly string[],
  ): Promise<Result<void, PluginPortFailure>> {
    const appended = await store.appendLog({
      at: deps.now(),
      itemId: item.itemId,
      name: item.name,
      ...projectFieldOf(item.card.origin),
      kind: item.kind,
      candidateHash: item.candidateHash,
      baseHash: item.baseHash,
      decision,
      profileIds: [...profileIds],
      actor: "user",
      provenance: item.provenance,
      originThreadId: item.originThreadId,
    });
    return appended.ok ? ok(undefined) : err(storeFailure(appended.error));
  }

  /** 후보 폴더를 다른 항목이 쓰지 않을 때만 지운다. `except`는 이 항목 자신의 id다 */
  async function dropCandidate(
    hash: string | null,
    items: readonly ReviewItem[],
    except: string,
  ): Promise<void> {
    if (hash === null || hashInUse(items, hash, except)) return;
    const dropped = await store.discardCandidate(hash);
    if (!dropped.ok) {
      log.error("plugin.review.candidate_drop_failed", { kind: dropped.error.kind });
    }
  }

  /** 대기 항목 하나를 `superseded`나 `withdrawn`으로 닫는다. 기록도 남긴다 */
  async function closeItem(
    item: ReviewItem,
    state: "superseded" | "withdrawn",
    items: readonly ReviewItem[],
  ): Promise<void> {
    const saved = await save({ ...item, state, decidedAt: deps.now() });
    if (!saved.ok) {
      log.error("plugin.review.close_failed", { itemId: item.itemId, state });
      return;
    }
    await dropCandidate(item.candidateHash, items, item.itemId);
    const logged = await logDecision(item, state, []);
    if (!logged.ok) log.error("plugin.review.log_failed", { itemId: item.itemId, state });
  }

  /**
   * 후보 해시 하나에서 항목을 만든다. 같은 이름의 대기 항목 가운데 다른 해시는 `superseded`로 닫는다.
   * 같은 해시의 대기 항목이 있으면 그것을 돌려주고 새로 만들지 않는다
   */
  async function proposeItem(input: {
    readonly candidateHash: string;
    readonly origin: PluginOriginKind;
    /** 프로젝트 출처의 프로젝트 id. 다른 출처는 null이다 */
    readonly projectId: string | null;
    readonly provenance: Provenance;
    readonly originThreadId: string | null;
    readonly originProfileId: string | null;
    readonly evidence: readonly EvidenceRef[];
    readonly purpose: string | undefined;
    /** 가져온 훅의 출처(가져오기 계획의 값). 카드의 훅 출처는 이 값에서만 나온다 */
    readonly importedHookOrigin?: ImportedHookOrigin | undefined;
  }): Promise<Result<{ readonly item: ReviewItem; readonly created: boolean }, PluginPortFailure>> {
    const tree = store.candidateTree(input.candidateHash);
    if (!tree.ok) return err(storeFailure(tree.error));
    const read = readPluginFolder(tree.value, { origin: input.origin });
    if (!read.ok) return err(rejectionFailure(read.error));
    const folder = read.value;
    // 비교 대상은 자기 프로젝트의 키다. 같은 이름이 다른 프로젝트에 승인되어 있어도 섞지 않는다
    const keyed = keyOfOrigin(originOf(input.origin, input.projectId), folder.name);
    if (!keyed.ok) return err(keyed.error);
    const key = keyed.value;
    if (key === null) return err({ kind: "store", code: "origin_unsupported" });
    const listed = await allItems();
    if (!listed.ok) return listed;
    const pending = oldestFirst(listed.value.filter((item) => sameKey(item, key))).filter(
      (item) => item.state === "pending",
    );
    const same = pending.find((item) => item.candidateHash === input.candidateHash);
    if (same !== undefined) return ok({ item: same, created: false });

    const reviewed = await store.current(key);
    if (!reviewed.ok) return err(storeFailure(reviewed.error));
    const itemId = deps.ids.next("rvw");
    const card = candidateCard(
      folder,
      input.origin,
      input.projectId,
      itemId,
      reviewed.value,
      deps.envSandboxed?.() === true,
      deps.narrowDrafts?.() === true,
      input.importedHookOrigin,
    );
    const withPurpose: PluginCard = { ...card, purpose: card.purpose ?? input.purpose ?? null };
    const item = pendingItemOf(
      itemId,
      {
        kind: reviewed.value === null ? "new" : "update",
        name: folder.name,
        candidateHash: input.candidateHash,
        baseHash: reviewed.value?.contentHash ?? null,
        provenance: input.provenance,
        originThreadId: input.originThreadId,
        originProfileId: input.originProfileId,
        card: withPurpose,
        diff: diffCards(reviewed.value?.meta.card ?? null, withPurpose),
        evidence: input.evidence,
        files: filesOf(folder),
        ...baseFilesOf(reviewed.value, input.origin),
        removal: null,
      },
      deps.now(),
    );
    await sequentially(
      pending.filter((old) => old.candidateHash !== input.candidateHash),
      (old) => closeItem(old, "superseded", listed.value),
    );
    const saved = await save(item);
    if (!saved.ok) return err(saved.error);
    return ok({ item: saved.value, created: true });
  }

  /** 검토본 기준을 모은다(키마다). 읽지 못한 검토본의 키는 이번 훑기에서 건드리지 않는다 */
  async function baselineOf(keys: readonly string[]): Promise<Baseline> {
    const reviewed = new Map<string, ReviewedVersion | null>();
    const unreadable = new Set<string>();
    await sequentially(keys, async (key) => {
      const current = await store.current(key);
      if (!current.ok) {
        log.error("plugin.review.current_failed", { key, kind: current.error.kind });
        unreadable.add(key);
        return;
      }
      reviewed.set(key, current.value);
    });
    return { reviewed, unreadable };
  }

  /** 원본 하나를 검토한다. 새 항목을 만들었으면 그 id를, 아니면 빈 목록을 돌려준다 */
  async function scanEntry(
    entry: PluginSourceEntry,
    base: Baseline,
  ): Promise<Result<readonly string[], PluginPortFailure>> {
    // 번들은 릴리스가 시작 때 넣는다(§4.7.1). 내장과 관리는 검토하지 않는다. 프로젝트 id가 없는 프로젝트 원본은 키가 없어 건너뛴다
    if (entry.origin !== "user" && entry.origin !== "project") return ok([]);
    const key = entry.reviewKey;
    if (key === null) return ok([]);
    if (base.unreadable.has(key)) return ok([]);
    const current = base.reviewed.get(key) ?? null;
    if (current !== null && entry.sourceHash === current.contentHash) return ok([]);
    const items = await reloadItems();
    const pending = items.filter((item) => sameKey(item, key) && item.state === "pending");
    if (pending.some((item) => item.candidateHash === entry.sourceHash)) return ok([]);
    if (discardedAgain(items, key, entry.sourceHash)) return ok([]);

    const snapshot = await store.snapshotCandidate(entry.dir);
    if (!snapshot.ok) {
      log.warn("plugin.scan.skipped", { name: entry.name, kind: snapshot.error.kind });
      return ok([]);
    }
    const made = await proposeItem({
      candidateHash: snapshot.value.contentHash,
      origin: entry.origin,
      projectId: entry.projectId,
      provenance: entry.origin === "user" ? "unknown" : "project",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: undefined,
    });
    if (!made.ok) {
      // 읽을 수 없는 후보는 항목을 만들지 않고 진단으로만 남긴다(M5c §5)
      log.warn("plugin.scan.skipped", { name: entry.name, kind: made.error.kind });
      await dropCandidate(snapshot.value.contentHash, items, "");
      return ok([]);
    }
    return ok(made.value.created ? [made.value.item.itemId] : []);
  }

  /** 원본이 검토본 내용으로 되돌아왔으면 그 대기 항목은 철회다(§4.7.7). 제거 항목은 사용자가 정하므로 여기서 닫지 않는다 */
  async function withdrawMatching(sources: PluginSources, base: Baseline): Promise<void> {
    const items = await reloadItems();
    const bySource = new Map(
      sources.entries.flatMap((entry) =>
        entry.reviewKey === null ? [] : [[entry.reviewKey, entry] as const],
      ),
    );
    await sequentially(
      items.filter((item) => item.state === "pending" && item.kind === "update"),
      async (item) => {
        const key = itemKeyOf(item);
        if (key === null) return;
        const source = bySource.get(key);
        const current = base.reviewed.get(key) ?? null;
        if (source === undefined || current === null || source.sourceHash !== current.contentHash)
          return;
        await closeItem(item, "withdrawn", items);
      },
    );
  }

  /**
   * 원본 폴더가 사라진 사용자 플러그인은 제거 항목이다(M5c §4.7.1). 폴더가 있는데 읽지 못한 것은 진단일 뿐이다.
   * 같은 이름의 제거 항목이 대기 중이거나 방금 버려졌으면 새로 만들지 않는다
   */
  async function scanGone(
    key: string,
    current: ReviewedVersion,
    sources: PluginSources,
  ): Promise<Result<readonly string[], PluginPortFailure>> {
    if (current.meta.origin !== "user") return ok([]);
    const name = current.meta.name;
    if (sources.entries.some((entry) => entry.reviewKey === key)) return ok([]);
    if (sources.discoveredNames.includes(name)) return ok([]);
    const items = await reloadItems();
    const named = oldestFirst(items.filter((item) => sameKey(item, key)));
    const removePending = named.some((item) => item.kind === "remove" && item.state === "pending");
    const latest = named.at(-1);
    const removeDiscarded =
      latest !== undefined && latest.kind === "remove" && latest.state === "discarded";
    if (removePending || removeDiscarded) return ok([]);
    const profiles = await deps.profiles.list();
    if (!profiles.ok) {
      log.error("plugin.review.profiles_failed", { name });
      return ok([]);
    }
    const itemId = deps.ids.next("rvw");
    const card: PluginCard = {
      ...current.meta.card,
      review: {
        state: "pending",
        currentHash: current.contentHash,
        pendingItemId: itemId,
        approvedAt: current.meta.approvedAt,
      },
    };
    const saved = await save(
      pendingItemOf(
        itemId,
        {
          kind: "remove",
          name,
          candidateHash: null,
          baseHash: current.contentHash,
          // 원본이 사라진 것은 손으로 지운 것으로 보이는 변화라서 `unknown`을 쓴다. 제거는 손 수정 판정을 받지 않는다(§4.7.4) [제안]
          provenance: "unknown",
          originThreadId: null,
          originProfileId: null,
          card,
          diff: diffCards(current.meta.card, null),
          evidence: [],
          files: [],
          removal: removalOf(profiles.value, name, current.meta.card),
        },
        deps.now(),
      ),
    );
    if (!saved.ok) return err(saved.error);
    return ok([itemId]);
  }

  /**
   * 원본 훑기 한 번. 캐시가 이미 새 것이어야 한다(`plugins.scan()` 뒤에 부른다).
   * 내용이 검토본과 다른 원본마다 항목을 만들고, 되돌아온 원본의 대기 항목을 철회하고, 사라진 사용자 플러그인의 제거 항목을 만든다
   */
  async function scanSources(): Promise<Result<{ readonly queued: string[] }, PluginPortFailure>> {
    const sources = await plugins.sources();
    if (!sources.ok) return err(sources.error);
    const keys = await store.names();
    if (!keys.ok) return err(storeFailure(keys.error));
    const base = await baselineOf(keys.value);
    const created = await collectInOrder(sources.value.entries, (entry) => scanEntry(entry, base));
    if (!created.ok) return created;
    await withdrawMatching(sources.value, base);
    const removed = await collectInOrder(
      [...base.reviewed],
      async ([key, current]): Promise<Result<readonly string[], PluginPortFailure>> =>
        current === null ? ok([]) : scanGone(key, current, sources.value),
    );
    if (!removed.ok) return removed;
    return ok({ queued: [...created.value, ...removed.value] });
  }

  /**
   * 항목의 한 쪽 스냅샷에서 파일 바이트를 읽는다. 그 쪽 스냅샷이 보관소에 없으면 null이다(`missing`).
   * 새 판은 대기 중이면 후보 스냅샷이고, 승인된 뒤에는 후보가 승인본 보관소로 옮겨 갔으므로 거기서 읽는다.
   * 지난 승인 버전은 승인본 보관소에서 읽는다(보관 `KEEP_VERSIONS`개를 넘으면 지워져 null이다)
   */
  async function readSnapshotFile(
    item: ReviewItem,
    side: ReviewFileSide,
    hash: string,
    path: string,
  ): Promise<Result<Uint8Array | null, PluginPortFailure>> {
    const keyed = keyOfOrigin(item.card.origin, item.name);
    if (!keyed.ok) return err(keyed.error);
    const key = keyed.value;
    const fromReviewed = side === "base" || item.state === "approved";
    const bytes =
      fromReviewed && key !== null
        ? await store.readReviewedFile(key, hash, path)
        : await store.readCandidateFile(hash, path);
    if (bytes.ok) return ok(bytes.value);
    if (bytes.error.kind === "not_found") return ok(null);
    return err(storeFailure(bytes.error));
  }

  async function reloadItems(): Promise<readonly ReviewItem[]> {
    const listed = await store.listItems();
    return listed.ok ? listed.value : [];
  }

  /**
   * 승인 한 번을 커밋한다. 순서는 검사, `beforeCommit`(검증만), 승격과 `current` 교체, `afterCommit`(프로필 갱신), 보관 정리,
   * 기록, 항목 상태, 목록 갱신, `reflect`(실행 중인 판 맞추기)다. `afterCommit`이 실패하면 `current`를 옛 검토본으로 되돌린다.
   * 중간에 끊기면 current는 옛 검토본이고, 기록에 없는 검토본은 다음 시작의 `recover`가 치운다(M5c §4.7.11)
   */
  async function applyApproval(
    item: ReviewItem,
    decision: ApproveDecision,
    hooks: ApprovalHooks,
  ): Promise<Result<DecisionOutcome, PluginPortFailure>> {
    if (item.state !== "pending") return err({ kind: "not_pending", itemId: item.itemId });
    const removing = item.kind === "remove";
    // 손 수정은 검토된 것을 고친 변경이다(되돌릴 검토본이 있어야 한다). 처음 만드는 플러그인은 사용자가 쓴 것이라 승인할 수 있다 [제안]
    if (
      item.kind === "update" &&
      item.provenance === "unknown" &&
      item.card.origin.kind === "user"
    ) {
      return err({ kind: "hand_edit", itemId: item.itemId });
    }
    const purpose = decision.purpose ?? item.card.purpose;
    if (!removing && (purpose === null || purpose.trim() === "")) {
      return err({ kind: "purpose_required", itemId: item.itemId });
    }
    const approvedAt = deps.now();
    // 검토본 키: 사용자·번들은 이름, 프로젝트는 `<projectId>/<이름>`. 내장·관리는 검토본이 없어 null이다
    const keyed = keyOfOrigin(item.card.origin, item.name);
    if (!keyed.ok) return err(keyed.error);
    const key = keyed.value;
    // 후보는 한 번만 읽는다. 검증(사실)과 승격(매니페스트 버전)이 같은 읽기를 쓴다. 원본은 다시 읽지 않는다
    let read: PluginFolder | null = null;
    let origin: ReviewOrigin | null = null;
    let candidateRoot = "";
    if (!removing) {
      if (item.candidateHash === null) return err({ kind: "store", code: "candidate_missing" });
      origin = reviewOriginOf(item.card.origin.kind);
      if (origin === null) return err({ kind: "store", code: "origin_unsupported" });
      const located = store.candidateTree(item.candidateHash);
      if (!located.ok) return err(storeFailure(located.error));
      const folder = readPluginFolder(located.value, { origin: item.card.origin.kind });
      if (!folder.ok) return err({ kind: "store", code: "candidate_invalid" });
      read = folder.value;
      candidateRoot = located.value;
    }
    const context: ApprovalContext = {
      item,
      decision,
      approvedAt,
      facts: read === null ? null : pluginFactOf(read.manifest, candidateRoot),
    };
    if (hooks.beforeCommit !== undefined) {
      const checked = await hooks.beforeCommit(context);
      if (!checked.ok) return checked;
    }

    // 옛 검토본(되돌리기용). 키가 없는 출처(내장·관리)의 제거는 저장소를 건드리지 않는다
    let previous: ReviewedVersion | null = null;
    if (key !== null) {
      const found = await store.current(key);
      if (!found.ok) return err(storeFailure(found.error));
      previous = found.value;
    }
    if (removing) {
      if (key !== null) {
        const cleared = await store.clearCurrent(key);
        if (!cleared.ok) return err(storeFailure(cleared.error));
      }
    } else {
      // 위에서 후보를 읽었으므로 아래 값들은 있다. 없으면 스냅샷이 그사이 사라진 것이다
      if (item.candidateHash === null || origin === null || read === null || key === null) {
        return err({ kind: "store", code: "candidate_missing" });
      }
      const meta: PluginReviewMeta = {
        name: item.name,
        version: read.manifest.version,
        contentHash: item.candidateHash,
        approvedAt,
        decisionId: item.itemId,
        origin,
        inferredManifest: read.inferred,
        // 출처가 마이그레이션인 항목을 승인한 검토본만 환경 모드 스크립트를 받는다(AGE-58 [제안]). 매니페스트가 아니라 이 호스트 기록이 근거다
        ...(item.provenance === "migration" ? { importedScripts: true } : {}),
        card: {
          ...item.card,
          purpose,
          review: {
            state: "approved",
            currentHash: item.candidateHash,
            pendingItemId: null,
            approvedAt,
          },
          usedBy: [],
        },
      };
      const promoted = await store.promote(item.candidateHash, meta);
      if (!promoted.ok) return err(storeFailure(promoted.error));
      const switched = await store.setCurrent(key, item.candidateHash);
      if (!switched.ok) return err(storeFailure(switched.error));
    }

    // 프로필 갱신이 실패하면 `current`를 옛 검토본으로 되돌린다. 되돌리기도 실패하면 로그에만 남긴다
    let appliedTo: readonly string[] = [];
    let missingPlugins: readonly string[] = [];
    if (hooks.afterCommit !== undefined) {
      const done = await hooks.afterCommit(context);
      if (!done.ok) {
        if (key !== null) {
          const back =
            previous === null
              ? await store.clearCurrent(key)
              : await store.setCurrent(key, previous.contentHash);
          if (!back.ok) log.error("plugin.review.restore_failed", { name: item.name });
        }
        return done;
      }
      appliedTo = done.value.profileIds;
      missingPlugins = done.value.missingPlugins;
    }

    // 보관 정리가 실패해도 승인은 되돌리지 않는다(검토본은 이미 current다). 실패는 로그에 남긴다
    if (key !== null) {
      const pruned = await store.prune(key, { keep: KEEP_VERSIONS, inUse: new Set<string>() });
      if (!pruned.ok) {
        log.error("plugin.review.prune_failed", { name: item.name, kind: pruned.error.kind });
      }
    }

    const appended = await store.appendLog({
      at: approvedAt,
      itemId: item.itemId,
      name: item.name,
      ...projectFieldOf(item.card.origin),
      kind: item.kind,
      candidateHash: item.candidateHash,
      baseHash: item.baseHash,
      decision: "approved",
      profileIds: [...appliedTo],
      actor: "user",
      provenance: item.provenance,
      originThreadId: item.originThreadId,
    });
    if (!appended.ok) return err(storeFailure(appended.error));

    const saved = await save({
      ...item,
      state: "approved",
      decidedAt: approvedAt,
      card: { ...item.card, purpose },
    });
    if (!saved.ok) return err(saved.error);
    // 읽기 쪽 캐시가 새 검토본을 보게 한다. 실패해도 승인은 끝났다(다음 `plugin.scan`이 맞춘다)
    const refreshed = await plugins.scan();
    if (!refreshed.ok) log.error("plugin.review.refresh_failed", { name: item.name });
    if (hooks.reflect !== undefined) await hooks.reflect(context);
    emit({ kind: "plugin", name: item.name });
    return ok({
      item: saved.value,
      appliedTo: [...appliedTo],
      missingPlugins: [...missingPlugins],
    });
  }

  async function sendBack(
    item: ReviewItem,
    reason: string,
  ): Promise<Result<DecisionOutcome, PluginPortFailure>> {
    const saved = await save({ ...item, state: "sent_back", reason, decidedAt: deps.now() });
    if (!saved.ok) return err(saved.error);
    const logged = await logDecision(item, "sent_back", []);
    if (!logged.ok) return err(logged.error);
    if (item.originThreadId !== null && deps.notifyOrigin !== undefined) {
      const delivered = await deps.notifyOrigin({
        threadId: item.originThreadId,
        reason,
        itemId: item.itemId,
      });
      if (!delivered) log.warn("plugin.review.origin_not_notified", { itemId: item.itemId });
    }
    return ok({ item: saved.value, appliedTo: [], missingPlugins: [] });
  }

  async function discard(item: ReviewItem): Promise<Result<DecisionOutcome, PluginPortFailure>> {
    const listed = await allItems();
    if (!listed.ok) return err(listed.error);
    const saved = await save({ ...item, state: "discarded", decidedAt: deps.now() });
    if (!saved.ok) return err(saved.error);
    await dropCandidate(item.candidateHash, listed.value, item.itemId);
    const logged = await logDecision(item, "discarded", []);
    if (!logged.ok) return err(logged.error);
    return ok({ item: saved.value, appliedTo: [], missingPlugins: [] });
  }

  /**
   * 초안 한 버전의 파일 목록. 스냅샷 트리를 다시 해시해 목록을 만들고, 기록된 해시와 다르면 `draft_changed`다.
   * 읽기만 한다: 초안을 싣거나 실행하지 않는다
   */
  async function listDraftFiles(
    draftId: string,
  ): Promise<Result<PluginDraftFilesResult, PluginPortFailure>> {
    const info = await store.readDraft(draftId);
    if (!info.ok) {
      return info.error.kind === "not_found"
        ? err({ kind: "draft_not_found", draftId })
        : err(storeFailure(info.error));
    }
    const hashed = hashPluginTree(join(store.draftDir(draftId), "tree"));
    if (!hashed.ok) return err(treeFailure(hashed.error));
    if (hashed.value.contentHash !== info.value.contentHash) {
      return err({ kind: "store", code: "draft_changed" });
    }
    return ok({
      draftId,
      name: info.value.name,
      contentHash: info.value.contentHash,
      files: hashed.value.files.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    });
  }

  /** 같은 이름의 초안을 최근 `KEEP_DRAFTS`개만 남긴다. 검토 항목이 가리키는 초안은 남긴다 */
  async function retainDrafts(name: string): Promise<void> {
    const listed = await store.listDrafts();
    if (!listed.ok) {
      log.error("plugin.draft.retain_failed", { name, kind: listed.error.kind });
      return;
    }
    const named = draftsNamed(listed.value, name);
    const extra = named.length - KEEP_DRAFTS;
    if (extra <= 0) return;
    const doomed = named.filter((info) => info.submittedItemId === null).slice(0, extra);
    await sequentially(doomed, async (info) => {
      const removed = await store.removeDraft(info.draftId);
      if (!removed.ok) log.error("plugin.draft.retain_failed", { name, kind: removed.error.kind });
    });
  }

  /** 초안 만들기의 본체. 호출자가 직렬화 안에 있다 */
  async function createDraft(
    dir: string,
    originThreadId: string | null,
  ): Promise<Result<DraftCreated, PluginPortFailure>> {
    const pre = hashPluginTree(dir);
    if (!pre.ok) return err(treeFailure(pre.error));
    const read = readPluginFolder(dir, { origin: "user" });
    if (!read.ok) return err(rejectionFailure(read.error));
    const folder = read.value;
    const reviewed = await store.current(folder.name);
    if (!reviewed.ok) return err(storeFailure(reviewed.error));
    const listed = await store.listDrafts();
    if (!listed.ok) return err(storeFailure(listed.error));
    const parent = draftsNamed(listed.value, folder.name).at(-1)?.draftId ?? null;
    const draftId = deps.ids.next("drf");
    const saved = await store.saveDraft(dir, draftId, (contentHash) => ({
      draftId,
      name: folder.name,
      contentHash,
      parent,
      createdAt: deps.now(),
      originThreadId,
      label: null,
      submittedItemId: null,
    }));
    if (!saved.ok) return err(draftStoreFailure(saved.error));
    await retainDrafts(folder.name);
    const card = buildPluginCard({
      folder,
      origin: { kind: "user" },
      review: {
        state: "draft",
        currentHash: reviewed.value?.contentHash ?? null,
        pendingItemId: null,
        approvedAt: reviewed.value?.meta.approvedAt ?? null,
      },
      usedBy: [],
      health: IDLE_HEALTH,
    });
    return ok({ draftId, contentHash: saved.value.contentHash, card, info: saved.value });
  }

  /** 초안 하나를 검토 항목으로 보낸다. 만든 초안은 `submittedItemId`로 항목을 가리킨다 */
  async function submitDraftItem(
    draftId: string,
    options: {
      readonly evidence: readonly EvidenceRef[];
      readonly purpose: string | undefined;
      readonly provenance: Provenance;
      readonly originProfileId: string | null;
      readonly importedHookOrigin?: ImportedHookOrigin | undefined;
    },
  ): Promise<Result<{ readonly item: ReviewItem; readonly created: boolean }, PluginPortFailure>> {
    const info = await store.readDraft(draftId);
    if (!info.ok) {
      return info.error.kind === "not_found"
        ? err({ kind: "draft_not_found", draftId })
        : err(storeFailure(info.error));
    }
    const candidate = await store.snapshotCandidate(join(store.draftDir(draftId), "tree"));
    if (!candidate.ok) return err(draftStoreFailure(candidate.error));
    if (candidate.value.contentHash !== info.value.contentHash) {
      return err({ kind: "store", code: "draft_changed" });
    }
    const made = await proposeItem({
      candidateHash: candidate.value.contentHash,
      origin: "user",
      projectId: null,
      provenance: options.provenance,
      originThreadId: info.value.originThreadId,
      originProfileId: options.originProfileId,
      evidence: options.evidence,
      purpose: options.purpose,
      importedHookOrigin: options.importedHookOrigin,
    });
    if (!made.ok) return made;
    const linked = await store.writeDraft({
      ...info.value,
      submittedItemId: made.value.item.itemId,
    });
    if (!linked.ok) return err(storeFailure(linked.error));
    return made;
  }

  /** 같은 이름의 가장 최근 검토본이 이 기능이 만든 지침이면 그 이름의 새 버전을 허용한다(§4.10.4). 모호하면 아니다 */
  async function replaceableInstruction(name: string, dir: string): Promise<boolean> {
    const reviewed = await store.current(name);
    if (!reviewed.ok || reviewed.value === null) return false;
    const decided = await store.readItem(reviewed.value.meta.decisionId);
    if (!decided.ok || decided.value.provenance !== "user_instruction") return false;
    return isInstructionFolder(dir, name);
  }

  /** 대상 프로필이 있는가. 내장 `default`는 파일에 없어도 있다(§4.1.1) */
  async function profileKnown(id: string): Promise<Result<void, PluginPortFailure>> {
    if (id === DEFAULT_PROFILE_ID) return ok(undefined);
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profiles", failure: listed.error });
    if (listed.value.profiles.some((profile) => profile.id === id)) return ok(undefined);
    return err({ kind: "profiles", failure: { kind: "not_found", id } });
  }

  /**
   * 입구의 본체(§7.5 [제안]). 호출자가 직렬화 안에 있다: 준비(폴더 쓰기), 초안 만들기, 검토 항목 만들기를 이 순서로 한다.
   * 준비가 실패하면 초안도 항목도 없다
   */
  async function admitCore(input: AdmitInput): Promise<Result<AdmitResult, PluginPortFailure>> {
    if (input.prepare !== undefined) {
      const prepared = await input.prepare();
      if (!prepared.ok) return prepared;
    }
    const created = await createDraft(input.dir, input.originThreadId);
    if (!created.ok) return created;
    const made = await submitDraftItem(created.value.draftId, {
      evidence: input.evidence,
      purpose: input.purpose,
      provenance: input.provenance,
      originProfileId: input.originProfileId,
      importedHookOrigin: input.importedHookOrigin,
    });
    if (!made.ok) return made;
    return ok({ draftId: created.value.draftId, itemId: made.value.item.itemId });
  }

  const intake = createPluginDraftIntake({
    admit: (input) => serial(() => admitCore(input)),
  });

  /**
   * 한 줄 지침의 본체(§4.10). 입력을 검사하고, 입구로 원본 폴더를 쓰고 초안과 `user_instruction` 항목을 만든다.
   * 폴더 쓰기는 입구의 준비 단계에서 직렬 구간 안에서 한다. 같은 이름의 폴더는 이름을 명시로 준 경우에만 새 버전으로 덮어쓴다. 그 밖의 충돌은 `plugin.exists`다
   */
  async function instructionDraft(
    request: PluginDraftFromInstructionParams,
  ): Promise<Result<PluginDraftFromInstructionResult, PluginPortFailure>> {
    const issues = instructionIssuesOf(request.text, request.name);
    if (issues.length > 0) return err({ kind: "draft_invalid", issues });
    const name = request.name ?? generatedNameOf(request.text);
    const dir = join(deps.userDir, name);
    const profileId = request.profileId ?? DEFAULT_PROFILE_ID;
    const purpose = purposeOf(request.text);
    const made = await intake.submit({
      dir,
      provenance: "user_instruction",
      originThreadId: null,
      originProfileId: profileId,
      evidence: [],
      purpose,
      prepare: async (): Promise<Result<void, PluginPortFailure>> => {
        const replacing =
          request.name !== undefined &&
          existsSync(dir) &&
          (await replaceableInstruction(name, dir));
        if (existsSync(dir) && !replacing) return err({ kind: "exists", name });
        const known = await profileKnown(profileId);
        if (!known.ok) return err(known.error);
        const written = await writeInstructionFolder(
          dir,
          manifestTextOf(name, purpose),
          request.text,
        );
        return written.ok ? ok(undefined) : err({ kind: "store", code: "io" });
      },
    });
    if (!made.ok) return made;
    return ok({ draftId: made.value.draftId, itemId: made.value.itemId });
  }

  const submitPort: PluginSubmitPort = {
    submit: async (
      request: PluginSubmitRequest,
    ): Promise<Result<PluginSubmitResult, PluginSubmitError>> => {
      const made = await intake.submit({
        dir: request.dir,
        provenance: "assistant",
        originThreadId: request.originThreadId,
        originProfileId: null,
        evidence: request.evidence,
        purpose: request.purpose,
      });
      if (!made.ok) return err(submitFailureOf(made.error));
      return ok({ draftId: made.value.draftId, itemId: made.value.itemId });
    },
  };

  return {
    scan: () =>
      serial(async () => {
        const rebuilt = await plugins.scan();
        if (!rebuilt.ok) return err(rebuilt.error);
        return scanSources();
      }),

    scanOpened: async () => {
      const scanned = await serial(async () => {
        const rebuilt = await plugins.scan();
        if (!rebuilt.ok) return err(rebuilt.error);
        return scanSources();
      });
      if (!scanned.ok) log.error("plugin.scan.opened_failed", { kind: scanned.error.kind });
    },

    requestRemove: (name) =>
      serial(async () => {
        const got = await plugins.get(name);
        if (!got.ok) return err(got.error);
        const keyed = keyOfOrigin(got.value.card.origin, name);
        if (!keyed.ok) return err(keyed.error);
        const key = keyed.value;
        const listed = await allItems();
        if (!listed.ok) return err(listed.error);
        const pendingRemove = listed.value.find(
          (item) =>
            key !== null &&
            itemKeyOf(item) === key &&
            item.kind === "remove" &&
            item.state === "pending",
        );
        if (pendingRemove !== undefined) return ok({ itemId: pendingRemove.itemId });
        // 다른 플러그인이 hard로 기대면 제거 항목을 만들지 않는다(AGE-33). 승인 때도 같은 검사를 한다
        const dependedOn =
          deps.facts === undefined ? null : requiredByRefusalOf(name, deps.facts());
        if (dependedOn !== null) return err(dependedOn);
        const profiles = await deps.profiles.list();
        if (!profiles.ok) return err({ kind: "profiles", failure: profiles.error });
        const reviewed: Result<ReviewedVersion | null, PluginStoreError> =
          key === null ? ok(null) : await store.current(key);
        if (!reviewed.ok) return err(storeFailure(reviewed.error));
        const itemId = deps.ids.next("rvw");
        const card: PluginCard = {
          ...got.value.card,
          review: {
            state: "pending",
            currentHash: reviewed.value?.contentHash ?? null,
            pendingItemId: itemId,
            approvedAt: reviewed.value?.meta.approvedAt ?? null,
          },
        };
        const saved = await save(
          pendingItemOf(
            itemId,
            {
              kind: "remove",
              name,
              candidateHash: null,
              baseHash: reviewed.value?.contentHash ?? null,
              // 사용자가 직접 요청한 제거다. 출처 칸에 맞는 값이 없어 `unknown`을 쓰고, 제거 항목은 손 수정 판정을 받지 않는다 [제안]
              provenance: "unknown",
              originThreadId: null,
              originProfileId: null,
              card,
              diff: diffCards(reviewed.value?.meta.card ?? null, null),
              evidence: [],
              files: [],
              removal: removalOf(profiles.value, name, got.value.card),
            },
            deps.now(),
          ),
        );
        if (!saved.ok) return err(saved.error);
        return ok({ itemId });
      }),

    revert: (name) =>
      serial(async () => {
        const sources = await plugins.sources();
        if (!sources.ok) return err(sources.error);
        const entry = sources.value.entries.find((item) => item.name === name);
        // 되돌릴 사용자 원본 폴더가 없으면 이름이 없는 것과 같이 본다
        if (entry === undefined || entry.origin !== "user")
          return err({ kind: "unknown_plugin", name });
        const reviewed = await store.current(name);
        if (!reviewed.ok) return err(storeFailure(reviewed.error));
        if (reviewed.value === null) return err({ kind: "no_reviewed_copy", name });
        const wanted = hashPluginTree(reviewed.value.treePath);
        if (!wanted.ok) return err(treeFailure(wanted.error));
        const present = hashPluginTree(entry.dir);
        if (!present.ok) return err(treeFailure(present.error));
        const mirrored = await mirrorInto(
          wanted.value.files,
          reviewed.value.treePath,
          entry.dir,
          present.value.files,
        );
        if (!mirrored.ok) return err(mirrored.error);
        // 원본이 바뀌었으니 목록을 새로 읽고, 검토본과 같아진 대기 항목을 철회한다
        const rebuilt = await plugins.scan();
        if (!rebuilt.ok) return err(rebuilt.error);
        const scanned = await scanSources();
        if (!scanned.ok) return err(scanned.error);
        return ok({ restored: true as const });
      }),

    draftCreate: (dir, originThreadId) => serial(() => createDraft(dir, originThreadId ?? null)),

    draftList: async (name) => {
      const listed = await store.listDrafts();
      if (!listed.ok) return err(storeFailure(listed.error));
      const drafts = draftsNamed(listed.value, name).toReversed();
      if (drafts.length > 0) return ok({ drafts });
      // 초안이 없을 때만 이름이 있는지 본다. 없는 이름이면 `extension.notFound`다
      const known = await plugins.get(name);
      if (!known.ok) return err(known.error);
      return ok({ drafts });
    },

    fromInstruction: (request) => instructionDraft(request),

    draftOf: async (draftId) => {
      const info = await store.readDraft(draftId);
      if (!info.ok) {
        return info.error.kind === "not_found" ? ok(undefined) : err(storeFailure(info.error));
      }
      return ok({
        name: info.value.name,
        draftId: info.value.draftId,
        contentHash: info.value.contentHash,
        tree: join(store.draftDir(draftId), "tree"),
      });
    },

    draftFiles: (draftId) => listDraftFiles(draftId),

    draftFile: async (draftId, path) => {
      const listed = await listDraftFiles(draftId);
      if (!listed.ok) return listed;
      if (!listed.value.files.some((file) => file.path === path)) {
        return err({ kind: "path_invalid" });
      }
      const bytes = await store.readDraftFile(draftId, path);
      if (!bytes.ok) {
        return bytes.error.kind === "not_found"
          ? err({ kind: "path_invalid" })
          : err(storeFailure(bytes.error));
      }
      return ok(fileTextOf(path, bytes.value));
    },

    draftDiscard: (draftId) =>
      serial(async () => {
        const info = await store.readDraft(draftId);
        if (!info.ok) {
          return info.error.kind === "not_found"
            ? err({ kind: "draft_not_found", draftId })
            : err(storeFailure(info.error));
        }
        const removed = await store.removeDraft(draftId);
        if (!removed.ok) return err(storeFailure(removed.error));
        return ok(undefined);
      }),

    pendingNames: async () => {
      const listed = await allItems();
      if (!listed.ok) return listed;
      const names = new Set(
        listed.value.filter((item) => item.state === "pending").map((item) => item.name),
      );
      return ok([...names].toSorted(compareUtf8));
    },

    list: async (filter) => {
      const listed = await allItems();
      if (!listed.ok) return listed;
      const items = listed.value
        .filter((item) => filter.state === undefined || item.state === filter.state)
        .filter((item) => filter.name === undefined || item.name === filter.name);
      // 최신이 앞에 오도록 돌려준다. 카드의 의존 칸은 응답에서만 설치된 사실로 다시 채운다(AGE-33)
      const ordered = oldestFirst(items).toReversed();
      const facts = deps.facts?.();
      return ok({
        items:
          facts === undefined ? ordered : ordered.map((item) => withInstalledCard(item, facts)),
      });
    },

    get: async (itemId) => {
      const read = await store.readItem(itemId);
      if (!read.ok) {
        return read.error.kind === "not_found"
          ? err({ kind: "review_not_found", itemId })
          : err(storeFailure(read.error));
      }
      // 카드의 의존 칸은 응답에서만 설치된 사실로 다시 채운다(AGE-33). 저장된 항목은 그대로다
      const facts = deps.facts?.();
      const item =
        facts === undefined
          ? read.value
          : { ...read.value, card: withInstalledDependencies(read.value.card, facts) };
      return ok({ item });
    },

    file: async (itemId, path, side = "candidate") => {
      const read = await store.readItem(itemId);
      if (!read.ok) {
        return read.error.kind === "not_found"
          ? err({ kind: "review_not_found", itemId })
          : err(storeFailure(read.error));
      }
      const item = read.value;
      // 목록에 없는 경로(상위 이동, 절대 경로 포함)는 스냅샷 밖이다. 새 판은 `files`, 지난 승인 버전은 `baseFiles`가 가른다
      const listed = side === "base" ? (item.baseFiles ?? []) : item.files;
      const hash = side === "base" ? item.baseHash : item.candidateHash;
      if (hash === null || !listed.some((file) => file.path === path)) {
        return err({ kind: "path_invalid" });
      }
      const bytes = await readSnapshotFile(item, side, hash, path);
      if (!bytes.ok) return bytes;
      if (bytes.value === null) return ok({ path, text: null, truncated: false, missing: true });
      return ok(fileTextOf(path, bytes.value));
    },

    submitDraft: (draftId) =>
      serial(async () => {
        const made = await submitDraftItem(draftId, {
          evidence: [],
          purpose: undefined,
          provenance: "assistant",
          originProfileId: null,
        });
        if (!made.ok) return err(made.error);
        return ok({ itemId: made.value.item.itemId });
      }),

    decide: (itemId, decision) =>
      serial(async (): Promise<Result<DecisionOutcome, PluginPortFailure>> => {
        const read = await store.readItem(itemId);
        if (!read.ok) {
          return read.error.kind === "not_found"
            ? err({ kind: "review_not_found", itemId })
            : err(storeFailure(read.error));
        }
        const item = read.value;
        if (decision.kind === "approve") {
          return applyApproval(item, decision, deps.approvalHooks ?? {});
        }
        if (item.state !== "pending") return err({ kind: "not_pending", itemId });
        if (decision.kind === "sendBack") return sendBack(item, decision.reason);
        return discard(item);
      }),

    applyApproval: (item, decision, hooks) => serial(() => applyApproval(item, decision, hooks)),

    submitPort,
    intake,

    onChanged(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
