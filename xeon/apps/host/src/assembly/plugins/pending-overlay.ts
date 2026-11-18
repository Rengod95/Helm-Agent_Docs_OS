import { ok, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { ReviewItem } from "@fresnel/contracts/wire";
import type { PluginPort, PluginPortFailure } from "../../handlers/m5/plugins.ts";
import { reviewKeyOf } from "./review-key.ts";

// 리뷰 대기 덧씌우기(M5c §3.4, 사용자 결정 2026-11-18 AGE-56 6번). 읽기 서비스는 검토 서비스를 모른다(검토 서비스가 읽기 서비스를 쓴다).
// 그래서 대기 항목은 조립에서 읽기 결과 위에 얹는다. 대기 항목이 있는 플러그인의 검토 칸은 `pending`이고 그 항목 id를 싣는다.
// 검토본의 해시와 승인 시각은 그대로 둔다(이미 승인된 플러그인의 갱신 대기도 `pending`으로 본다).

type PendingItemView = Pick<ReviewItem, "itemId" | "name" | "card" | "createdAt">;

/** 덧씌우기가 보는 대기 항목의 면. 검토 서비스의 `list`가 맞는다 */
export interface PendingItemSource {
  list(filter: {
    readonly state: "pending";
  }): Promise<Result<{ readonly items: readonly PendingItemView[] }, PluginPortFailure>>;
}

/** 검토본 키(검토 서비스의 `itemKeyOf`와 같다). 검토본을 두지 않는 출처와 형식이 틀린 키는 null이다 */
function keyOfOrigin(origin: PluginCard["origin"], name: string): string | null {
  const kind = origin.kind;
  if (kind !== "user" && kind !== "project" && kind !== "bundled") return null;
  const key = reviewKeyOf({ origin: kind, name, projectId: origin.projectId });
  return key.ok ? key.value : null;
}

/** 검토본 키마다 가장 최근 대기 항목 */
function latestPendingOf(items: readonly PendingItemView[]): ReadonlyMap<string, PendingItemView> {
  const latest = new Map<string, PendingItemView>();
  for (const item of items) {
    const key = keyOfOrigin(item.card.origin, item.name);
    if (key === null) continue;
    const seen = latest.get(key);
    if (seen === undefined || seen.createdAt < item.createdAt) latest.set(key, item);
  }
  return latest;
}

async function pendingOf(
  source: PendingItemSource,
): Promise<Result<ReadonlyMap<string, PendingItemView>, PluginPortFailure>> {
  const listed = await source.list({ state: "pending" });
  if (!listed.ok) return listed;
  return ok(latestPendingOf(listed.value.items));
}

function withPending(card: PluginCard, latest: ReadonlyMap<string, PendingItemView>): PluginCard {
  const key = keyOfOrigin(card.origin, card.name);
  const item = key === null ? undefined : latest.get(key);
  if (item === undefined) return card;
  return { ...card, review: { ...card.review, state: "pending", pendingItemId: item.itemId } };
}

/**
 * `plugin.list`·`plugin.get`의 읽기 면에 대기 항목을 얹는다. `reviewState` 필터는 얹은 뒤에 적용한다
 * (기반 서비스는 대기를 모르므로 그 칸으로 먼저 거르면 대기 플러그인이 빠진다). 읽기 실패는 호출자에게 그대로 돌려준다.
 */
export function withPendingReview(
  base: Pick<PluginPort, "list" | "get">,
  pending: PendingItemSource,
): Pick<PluginPort, "list" | "get"> {
  return {
    list: async (filter) => {
      const { reviewState, ...rest } = filter;
      const listed = await base.list(rest);
      if (!listed.ok) return listed;
      const latest = await pendingOf(pending);
      if (!latest.ok) return latest;
      const plugins = listed.value.plugins
        .map((card) => withPending(card, latest.value))
        .filter((card) => reviewState === undefined || card.review.state === reviewState);
      return ok({ plugins });
    },
    get: async (name) => {
      const got = await base.get(name);
      if (!got.ok) return got;
      const latest = await pendingOf(pending);
      if (!latest.ok) return latest;
      return ok({ ...got.value, card: withPending(got.value.card, latest.value) });
    },
  };
}
