import { Bug, err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId, TurnInvoked } from "@fresnel/contracts/conversation";
import type { PluginOriginKind } from "@fresnel/contracts/extensions";
import { OVERLAY_LIMIT, type InvocableKind, type OverlayRef } from "@fresnel/contracts/wire";
import { internalDraftName } from "@fresnel/ext-host";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";

// 턴 덧씌우기의 검사와 계획(M5c §4.3.1~4, §4.3.9). `turn.start.overlay`를 입력 처리 앞에서 본다.
// 검사 순서는 한도, 이름, 검토본, 항목, 초안이다. 이미 대화의 집합에 든 플러그인은 덧씌우지 않으므로 `alreadyInProfile`로만 표시한다.
// 시작 Drive 항목(`start`)은 얹은 뒤 주도를 요청한다(§4.3.2, drive-isolation.md 2.2). 그 표지는 프레임이 풀릴 때까지 산다(§4.3.4).
// 초안(`draftId`)은 검토본 자리를 대신한다(§4.3.8). 검토본이 없어도 되고, 격리 프로세스에 실리지 못하면 거절한다.

/** 덧씌우기 대상 하나의 재료. 검토본이 없으면 `reviewedHash`가 null이다 */
export interface OverlayTarget {
  readonly name: string;
  /** 현재 검토본의 내용 해시. 검토본이 없는 후보는 null이다 */
  readonly reviewedHash: string | null;
  /** 호출할 수 있는 항목(스킬, 명령, Drive 시작, 플러그인 전체) */
  readonly entries: readonly { readonly entry: string; readonly kind: InvocableKind }[];
  /** 도구나 MCP 서버를 더한다 */
  readonly addsTools: boolean;
  /** 출처. 프로젝트 동반 플러그인의 초안은 쓸 수 없다(§4.3.8). 모르면 undefined다 */
  readonly origin?: PluginOriginKind;
}

/** 초안 하나의 재료. 이름은 초안이 속한 플러그인 이름이고 `tree`는 초안 스냅샷의 트리 폴더다 */
export interface DraftRef {
  readonly name: string;
  readonly draftId: string;
  readonly contentHash: string;
  readonly tree: string;
}

/** 초안 조회. 없으면 undefined, 저장소가 읽지 못하면 실패다 */
export type DraftLookup = (
  draftId: string,
) => Promise<Result<DraftRef | undefined, PluginPortFailure>>;

/** 초안 저장소가 없을 때의 조회: 어떤 초안도 없다. 검토본만 보는 시험이 쓴다 */
export const NO_DRAFTS: DraftLookup = () => Promise.resolve(ok(undefined));

/** 초안을 싣지 못한 이유. 어느 플러그인의 초안인지와 로더가 준 종류다 */
export interface DraftLoadRefusal {
  readonly name: string;
  readonly kind: string;
}

/** 덧씌우기를 거절하는 이유 */
export type OverlayRefusal =
  /** 한 턴의 덧씌우기가 `OVERLAY_LIMIT`를 넘었다 */
  | { readonly kind: "limit" }
  /** 그 이름의 플러그인이 없다 */
  | { readonly kind: "not_found"; readonly name: string }
  /** 현재 검토본이 없다(승인 대기뿐이거나 내장 패키지다) */
  | { readonly kind: "not_reviewed"; readonly name: string }
  /** 그 플러그인에 그 항목이 없다. 시작 Drive 항목은 있으면 얹는다(§4.3.2). 초안은 플러그인 전체만 얹는다 [제안] */
  | { readonly kind: "no_entry"; readonly name: string }
  /** 초안 식별자가 없거나 다른 플러그인의 것이다. 와이어는 `draft.notFound`다 */
  | { readonly kind: "draft_not_found"; readonly name: string; readonly draftId: string }
  /** 시작 Drive를 주도로 요청하지 못했다(등록이 없거나 호스트가 거절했다). 얹은 표지는 되돌린다. 와이어는 `overlay.noEntry`다 [제안] */
  | { readonly kind: "drive_unavailable"; readonly name: string }
  /**
   * 초안을 격리 프로세스에 싣지 못했다(격리 포트가 없는 것을 포함한다), 프로젝트 동반 플러그인이다, 같은 플러그인의 다른 판과 섞였다.
   * 실린 것은 없다. 실패 종류는 `plugin.overlay.draft_load_failed`로 기록한다(§4.3.8)
   */
  | { readonly kind: "draft_unavailable"; readonly name: string }
  /** 대상을 읽는 저장소나 프로필의 실패. 처리기가 그 실패의 와이어 오류로 옮긴다 */
  | { readonly kind: "plugin"; readonly failure: PluginPortFailure };

/** 검사를 통과한 덧씌우기 하나. 같은 플러그인의 여러 항목은 한 덩어리로 모은다 */
export interface PlannedOverlay {
  readonly plugin: string;
  /** 요청 시점의 현재 검토본 해시(§5 "요청 시점의 검토본") */
  readonly contentHash: string;
  /** 이미 대화의 집합에 든 플러그인이면 참이다. 적용하지 않는다 */
  readonly alreadyInProfile: boolean;
  readonly addsTools: boolean;
  /** 이 플러그인을 부른 항목들(요청 순서, 같은 항목은 한 번). 적용된 것만 `turn.started.invoked`가 된다 */
  readonly invoked: readonly TurnInvoked[];
  /** 초안이면 그 재료다. `plugin`은 실제 이름이고 `contentHash`는 초안의 내용 해시다 [제안] */
  readonly draft?: PlannedDraft;
}

/** 얹을 초안의 내부 재료. 내부 이름은 `internalDraftName`이고 표지의 `plugin`이 된다(§4.3.8) */
interface PlannedDraft {
  readonly draftId: string;
  readonly internalName: string;
  readonly tree: string;
}

/**
 * 덧씌우기 요청을 검사하고 계획을 세운다. 같은 플러그인이 여럿이면 첫 것만 남긴다.
 * `targetOf`와 `draftOf`가 저장소 실패를 내면 그 실패를 그대로 돌려준다. 초안은 검토본이 없어도 되므로 대상이 목록에 없어도 된다.
 */
export async function planOverlay(
  refs: readonly OverlayRef[],
  targetOf: (name: string) => Promise<Result<OverlayTarget | undefined, PluginPortFailure>>,
  inSet: ReadonlySet<string>,
  draftOf: DraftLookup = NO_DRAFTS,
): Promise<Result<readonly PlannedOverlay[], OverlayRefusal>> {
  if (refs.length > OVERLAY_LIMIT) return err({ kind: "limit" });
  // 대상과 초안 조회는 서로 독립이라 함께 읽고, 검사는 요청 순서대로 본다(첫 거절이 이긴다)
  const found = await Promise.all(refs.map((ref) => targetOf(ref.plugin)));
  const drafts = await Promise.all(
    refs.map((ref) =>
      ref.draftId === undefined ? Promise.resolve(ok(undefined)) : draftOf(ref.draftId),
    ),
  );
  const byPlugin = new Map<string, Gathered>();
  for (const [index, ref] of refs.entries()) {
    const lookup = found[index];
    const draftLookup = drafts[index];
    if (lookup === undefined || draftLookup === undefined) throw new Bug("overlay.lookup_missing");
    if (!lookup.ok) return err({ kind: "plugin", failure: lookup.error });
    if (!draftLookup.ok) return err({ kind: "plugin", failure: draftLookup.error });
    const target = lookup.value;
    if (ref.draftId !== undefined) {
      const planned = plannedDraftOf(ref, draftLookup.value, target);
      if (!planned.ok) return err(planned.error);
      const existing = byPlugin.get(ref.plugin);
      if (existing === undefined) {
        byPlugin.set(ref.plugin, planned.value);
      } else if (existing.draft?.draftId !== ref.draftId) {
        // 같은 플러그인의 다른 초안이나 검토본과 섞이면 어느 것이 자리를 대신하는지 정할 수 없다
        return err({ kind: "draft_unavailable", name: ref.plugin });
      }
      continue;
    }
    if (target === undefined) return err({ kind: "not_found", name: ref.plugin });
    if (target.reviewedHash === null) return err({ kind: "not_reviewed", name: ref.plugin });
    // 이름만 준 것은 플러그인 항목으로 얹는다(Hook 전용, 도구 전용 플러그인, §4.3.2)
    let kind: InvocableKind = "plugin";
    if (ref.entry !== undefined) {
      const opened = kindOfEntry(target, ref.entry);
      if (opened === undefined) return err({ kind: "no_entry", name: ref.plugin });
      kind = opened;
    }
    const invoked: TurnInvoked = { plugin: ref.plugin, entry: ref.entry ?? ref.plugin, kind };
    const existing = byPlugin.get(ref.plugin);
    if (existing === undefined) {
      byPlugin.set(ref.plugin, {
        plugin: ref.plugin,
        contentHash: target.reviewedHash,
        alreadyInProfile: inSet.has(ref.plugin),
        addsTools: target.addsTools,
        invoked: [invoked],
      });
    } else if (existing.draft !== undefined) {
      return err({ kind: "draft_unavailable", name: ref.plugin });
    } else if (!existing.invoked.some((item) => sameInvoked(item, invoked))) {
      existing.invoked.push(invoked);
    }
  }
  return ok([...byPlugin.values()]);
}

/**
 * 초안 표지 하나의 계획. 초안이 없거나 그 플러그인의 것이 아니면 `draft_not_found`다. 검토본은 보지 않는다(새 플러그인도 된다).
 * 초안은 플러그인 전체만 얹는다. 도구를 더할 수 있으므로 `addsTools`는 참이다(캐시는 덧붙이는 쪽으로 본다)
 */
function plannedDraftOf(
  ref: OverlayRef,
  draft: DraftRef | undefined,
  target: OverlayTarget | undefined,
): Result<Gathered, OverlayRefusal> {
  if (ref.draftId === undefined) throw new Bug("overlay.draft_ref_without_id");
  if (draft === undefined || draft.name !== ref.plugin) {
    return err({ kind: "draft_not_found", name: ref.plugin, draftId: ref.draftId });
  }
  if (ref.entry !== undefined && ref.entry !== ref.plugin) {
    return err({ kind: "no_entry", name: ref.plugin });
  }
  // 프로젝트 동반 플러그인은 프로젝트 폴더의 것이다. 초안은 사용자 자신의 폴더에서만 만든다(§4.3.8)
  if (target?.origin === "project") return err({ kind: "draft_unavailable", name: ref.plugin });
  return ok({
    plugin: ref.plugin,
    contentHash: draft.contentHash,
    alreadyInProfile: false,
    addsTools: true,
    draft: {
      draftId: ref.draftId,
      internalName: internalDraftName(ref.plugin, ref.draftId),
      tree: draft.tree,
    },
    invoked: [{ plugin: ref.plugin, entry: ref.plugin, kind: "plugin" }],
  });
}

/** `planOverlay`가 한 플러그인의 항목을 모을 때 쓰는 값(정리 전의 모양) */
interface Gathered {
  plugin: string;
  contentHash: string;
  alreadyInProfile: boolean;
  addsTools: boolean;
  invoked: TurnInvoked[];
  draft?: PlannedDraft;
}

/** 이름으로 지정한 항목의 종류. 스킬, 명령, 플러그인 항목과 시작 Drive 항목을 연다. 없으면 undefined다 */
function kindOfEntry(target: OverlayTarget, entry: string): InvocableKind | undefined {
  const found = target.entries.find((item) => item.entry === entry);
  return found?.kind;
}

/** 시작 Drive 항목으로 얹은 것인가. 이 항목의 표지는 프레임이 풀릴 때까지 산다(§4.3.4) */
function startsDrive(item: TurnInvoked): boolean {
  return item.kind === "drive";
}

function sameInvoked(a: TurnInvoked, b: TurnInvoked): boolean {
  return a.plugin === b.plugin && a.entry === b.entry && a.kind === b.kind;
}

/**
 * 얹은 결과. 도구를 더하면 `tool_change_append`다. 실제 캐시 처리는 하지 않는다(범위 밖, [제안]). `invoked`는 이 턴에 실제로 얹은 항목이다
 * (집합에 이미 든 플러그인의 항목은 얹은 것이 없으므로 뺀다). 처리기가 턴 입력에 실어 `turn.started.invoked`가 된다
 */
interface OverlayAttachResult {
  readonly cacheImpact: "none" | "tool_change_append";
  readonly invoked: readonly TurnInvoked[];
}

/** 시작 Drive 요청을 큐에 넣지 못한 이유. 등록이 없거나(`no_drive`) 호스트가 거절했다(`not_started`) */
export type DriveStartRefusal =
  | { readonly kind: "no_drive" }
  | { readonly kind: "not_started"; readonly reason: string };

/** 턴 덧씌우기를 얹고 되돌리는 통로. 처리기가 `turn.start`에서 부른다 */
export interface OverlayPort {
  /** 검사하고 통과한 것만 그 대화에 얹은 뒤 입력 처리 앞에 적용을 기다린다 */
  attach(
    threadId: ThreadId,
    refs: readonly OverlayRef[],
  ): Promise<Result<OverlayAttachResult, OverlayRefusal>>;
  /**
   * 입력이 접수되지 않았거나 턴이 되지 않았을 때 얹은 것을 되돌린다. `keepDrive`가 참이면 시작 Drive의 요청이 큐에 있어 입력을
   * 주도 프레임이 받은 것이므로, 아직 부여되지 않은 Drive 표지는 남긴다(프레임이 풀리거나 정착할 때 뺀다)
   */
  cancel(threadId: ThreadId, keepDrive: boolean): Promise<void>;
}

export interface OverlayPortDeps {
  /** 이름의 대상. 없으면 undefined. 검토본의 항목은 검토본 폴더를 읽어 만든다 */
  readonly targetOf: (
    name: string,
  ) => Promise<Result<OverlayTarget | undefined, PluginPortFailure>>;
  /** 초안 식별자의 재료. 없으면 undefined. 저장소가 읽지 못하면 실패다 */
  readonly draftOf: DraftLookup;
  /**
   * 초안을 격리 프로세스에 싣는다(검사 뒤, 얹기 앞). 하나라도 못 싣으면 이 호출이 싣은 것을 내리고 실패를 돌려준다.
   * 격리 포트가 없으면 실패다(§4.3.8). 이미 실린 같은 초안은 그대로 쓴다
   */
  readonly loadDrafts: (drafts: readonly DraftRef[]) => Promise<Result<void, DraftLoadRefusal>>;
  /** 대화의 현재 집합(E(T))의 플러그인 이름 */
  readonly inSet: (threadId: ThreadId) => readonly string[];
  /** 적재되지 않은 플러그인을 검토본 로더로 적재한다. 실패는 이 함수가 기록하고 계속한다 */
  readonly ensureLoaded: (names: readonly string[]) => Promise<void>;
  readonly pluginSet: {
    attachOverlay(
      threadId: ThreadId,
      marks: readonly {
        /** 집합에 넣을 이름. 초안이면 내부 이름이다 */
        readonly plugin: string;
        readonly contentHash: string;
        readonly until: "turn" | "release";
        /** 초안이면 그 식별자와, 자리를 대신하는 실제 이름이다 */
        readonly draftId?: string;
        readonly replaces?: string;
      }[],
    ): Promise<void>;
    cancelOverlay(threadId: ThreadId, keepDrive: boolean): Promise<void>;
  };
  /**
   * 사용자 명령으로 그 플러그인의 주도를 요청한다(drive-isolation.md 2.2). 호출자는 대상이 E(T)에 든 뒤에 부른다.
   * 큐에 넣으면 값이고, 실제 부여는 다음 경계가 정한다(버려지면 표지가 정착할 때 빠진다)
   */
  readonly startDrive: (threadId: ThreadId, plugin: string) => Result<void, DriveStartRefusal>;
}

export function createOverlayPort(deps: OverlayPortDeps): OverlayPort {
  return {
    async attach(threadId, refs) {
      const planned = await planOverlay(
        refs,
        deps.targetOf,
        new Set(deps.inSet(threadId)),
        deps.draftOf,
      );
      if (!planned.ok) return err(planned.error);
      // 초안은 먼저 싣는다. 하나라도 못 싣으면 아무것도 얹지 않고 거절한다(검토본도 적재하지 않는다)
      const drafts = planned.value.flatMap((item) =>
        item.draft === undefined
          ? []
          : [
              {
                name: item.plugin,
                draftId: item.draft.draftId,
                contentHash: item.contentHash,
                tree: item.draft.tree,
              },
            ],
      );
      if (drafts.length > 0) {
        const loaded = await deps.loadDrafts(drafts);
        if (!loaded.ok) return err({ kind: "draft_unavailable", name: loaded.error.name });
      }
      // 이미 집합에 든 플러그인은 덧씌우지 않는다(§4.3.3). 초안은 검토본 자리를 대신하므로 집합에 들어 있어도 얹는다
      const fresh = planned.value.filter((item) => !item.alreadyInProfile);
      const reviewed = fresh.filter((item) => item.draft === undefined).map((item) => item.plugin);
      if (reviewed.length > 0) await deps.ensureLoaded(reviewed);
      if (fresh.length > 0) {
        await deps.pluginSet.attachOverlay(
          threadId,
          fresh.map((item) => ({
            plugin: item.draft?.internalName ?? item.plugin,
            contentHash: item.contentHash,
            until: item.invoked.some(startsDrive) ? "release" : "turn",
            ...(item.draft === undefined
              ? {}
              : { draftId: item.draft.draftId, replaces: item.plugin }),
          })),
        );
      }
      // 시작 요청은 표지를 얹고 적용한 뒤에 한다: 주도는 E(T)에 든 대상에만 준다(drive-isolation.md 2.2)
      let refused: string | undefined;
      for (const item of planned.value) {
        if (!item.invoked.some(startsDrive)) continue;
        if (!deps.startDrive(threadId, item.plugin).ok) {
          refused = item.plugin;
          break;
        }
      }
      if (refused !== undefined) {
        await deps.pluginSet.cancelOverlay(threadId, false);
        return err({ kind: "drive_unavailable", name: refused });
      }
      return ok({
        cacheImpact: fresh.some((item) => item.addsTools) ? "tool_change_append" : "none",
        invoked: fresh.flatMap((item) => item.invoked),
      });
    },
    cancel: (threadId, keepDrive) => deps.pluginSet.cancelOverlay(threadId, keepDrive),
  };
}
