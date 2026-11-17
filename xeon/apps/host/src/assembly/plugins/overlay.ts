import { Bug, err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { OVERLAY_LIMIT, type InvocableKind, type OverlayRef } from "@fresnel/contracts/wire";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";

// 턴 덧씌우기의 검사와 계획(M5c §4.3.1~4, §4.3.9). `turn.start.overlay`를 입력 처리 앞에서 본다.
// 검사 순서는 한도, 이름, 검토본, 항목, 초안이다. 이미 대화의 집합에 든 플러그인은 아무 일도 하지 않으므로 `alreadyInProfile`로만 표시한다.

/** 덧씌우기 대상 하나의 재료. 검토본이 없으면 `reviewedHash`가 null이다 */
export interface OverlayTarget {
  readonly name: string;
  /** 현재 검토본의 내용 해시. 검토본이 없는 후보는 null이다 */
  readonly reviewedHash: string | null;
  /** 호출할 수 있는 항목(스킬, 명령, Drive 시작, 플러그인 전체) */
  readonly entries: readonly { readonly entry: string; readonly kind: InvocableKind }[];
  /** 도구나 MCP 서버를 더한다 */
  readonly addsTools: boolean;
}

/** 덧씌우기를 거절하는 이유 */
export type OverlayRefusal =
  /** 한 턴의 덧씌우기가 `OVERLAY_LIMIT`를 넘었다 */
  | { readonly kind: "limit" }
  /** 그 이름의 플러그인이 없다 */
  | { readonly kind: "not_found"; readonly name: string }
  /** 현재 검토본이 없다(승인 대기뿐이거나 내장 패키지다) */
  | { readonly kind: "not_reviewed"; readonly name: string }
  /** 그 플러그인에 그 항목이 없다. 시작 Drive 항목도 여기로 거절한다(§4.3.2, M5c-2의 일회 Drive 전까지) */
  | { readonly kind: "no_entry"; readonly name: string }
  /** 초안 덧씌우기는 격리 1단계 전에는 쓸 수 없다(§4.3.8) */
  | { readonly kind: "draft_unavailable"; readonly name: string }
  /** 대상을 읽는 저장소나 프로필의 실패. 처리기가 그 실패의 와이어 오류로 옮긴다 */
  | { readonly kind: "plugin"; readonly failure: PluginPortFailure };

/** 검사를 통과한 덧씌우기 하나 */
export interface PlannedOverlay {
  readonly plugin: string;
  /** 요청 시점의 현재 검토본 해시(§5 "요청 시점의 검토본") */
  readonly contentHash: string;
  /** 이미 대화의 집합에 든 플러그인이면 참이다. 적용하지 않는다 */
  readonly alreadyInProfile: boolean;
  readonly addsTools: boolean;
}

/**
 * 덧씌우기 요청을 검사하고 계획을 세운다. 같은 플러그인이 여럿이면 첫 것만 남긴다.
 * `targetOf`가 저장소 실패를 내면 그 실패를 그대로 돌려준다.
 */
export async function planOverlay(
  refs: readonly OverlayRef[],
  targetOf: (name: string) => Promise<Result<OverlayTarget | undefined, PluginPortFailure>>,
  inSet: ReadonlySet<string>,
): Promise<Result<readonly PlannedOverlay[], OverlayRefusal>> {
  if (refs.length > OVERLAY_LIMIT) return err({ kind: "limit" });
  // 대상 조회는 서로 독립이라 함께 읽고, 검사는 요청 순서대로 본다(첫 거절이 이긴다)
  const found = await Promise.all(refs.map((ref) => targetOf(ref.plugin)));
  const planned: PlannedOverlay[] = [];
  for (const [index, ref] of refs.entries()) {
    const lookup = found[index];
    if (lookup === undefined) throw new Bug("overlay.lookup_missing");
    if (!lookup.ok) return err({ kind: "plugin", failure: lookup.error });
    const target = lookup.value;
    if (target === undefined) return err({ kind: "not_found", name: ref.plugin });
    if (target.reviewedHash === null) return err({ kind: "not_reviewed", name: ref.plugin });
    if (ref.entry !== undefined && !entryOpens(target, ref.entry)) {
      return err({ kind: "no_entry", name: ref.plugin });
    }
    if (ref.draftId !== undefined) return err({ kind: "draft_unavailable", name: ref.plugin });
    if (planned.some((item) => item.plugin === ref.plugin)) continue;
    planned.push({
      plugin: ref.plugin,
      contentHash: target.reviewedHash,
      alreadyInProfile: inSet.has(ref.plugin),
      addsTools: target.addsTools,
    });
  }
  return ok(planned);
}

/**
 * 이름으로 지정한 항목을 얹을 수 있는가. 시작 Drive 항목은 얹지 않는다(M5c-2의 일이다). 스킬, 명령, 플러그인 항목만 연다.
 */
function entryOpens(target: OverlayTarget, entry: string): boolean {
  return target.entries.some((item) => item.entry === entry && item.kind !== "drive");
}

/** 얹은 결과. 도구를 더하면 `tool_change_append`다. 실제 캐시 처리는 하지 않는다(범위 밖, [제안]) */
interface OverlayAttachResult {
  readonly cacheImpact: "none" | "tool_change_append";
}

/** 턴 덧씌우기를 얹고 되돌리는 통로. 처리기가 `turn.start`에서 부른다 */
export interface OverlayPort {
  /** 검사하고 통과한 것만 그 대화에 얹은 뒤 입력 처리 앞에 적용을 기다린다 */
  attach(
    threadId: ThreadId,
    refs: readonly OverlayRef[],
  ): Promise<Result<OverlayAttachResult, OverlayRefusal>>;
  /** 입력이 접수되지 않았을 때 얹은 것을 되돌린다 */
  cancel(threadId: ThreadId): Promise<void>;
}

export interface OverlayPortDeps {
  /** 이름의 대상. 없으면 undefined. 검토본의 항목은 검토본 폴더를 읽어 만든다 */
  readonly targetOf: (
    name: string,
  ) => Promise<Result<OverlayTarget | undefined, PluginPortFailure>>;
  /** 대화의 현재 집합(E(T))의 플러그인 이름 */
  readonly inSet: (threadId: ThreadId) => readonly string[];
  /** 적재되지 않은 플러그인을 검토본 로더로 적재한다. 실패는 이 함수가 기록하고 계속한다 */
  readonly ensureLoaded: (names: readonly string[]) => Promise<void>;
  readonly pluginSet: {
    attachOverlay(
      threadId: ThreadId,
      marks: readonly {
        readonly plugin: string;
        readonly contentHash: string;
        readonly until: "turn";
      }[],
    ): Promise<void>;
    cancelOverlay(threadId: ThreadId): Promise<void>;
  };
}

export function createOverlayPort(deps: OverlayPortDeps): OverlayPort {
  return {
    async attach(threadId, refs) {
      const planned = await planOverlay(refs, deps.targetOf, new Set(deps.inSet(threadId)));
      if (!planned.ok) return err(planned.error);
      // 이미 집합에 든 플러그인은 아무 일도 하지 않는다(§4.3.3)
      const fresh = planned.value.filter((item) => !item.alreadyInProfile);
      if (fresh.length > 0) {
        await deps.ensureLoaded(fresh.map((item) => item.plugin));
        await deps.pluginSet.attachOverlay(
          threadId,
          fresh.map((item) => ({
            plugin: item.plugin,
            contentHash: item.contentHash,
            until: "turn" as const,
          })),
        );
      }
      return ok({
        cacheImpact: fresh.some((item) => item.addsTools) ? "tool_change_append" : "none",
      });
    },
    cancel: (threadId) => deps.pluginSet.cancelOverlay(threadId),
  };
}
