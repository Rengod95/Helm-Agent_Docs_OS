// 트레이스 화면의 원천. 실제 엔진에서 읽는다:
// - 대화의 턴 목록(`turnRecord.list`, 50개씩, "더 보기"로 다음 쪽). 수천 턴이어도 한 쪽만 들고 있다
// - 고른 턴 하나(`turnRecord.get`, 전부)
// - 턴이 도는 중이면(`status: open`) `turnRecord.watch`로 알림 행을 받아 누적본에 넣는다. 행이 가리키는 자리가 없으면 다시 읽는다
// 화면은 `TraceData` 모양만 보고 그린다. 개발 빌드의 표본(`sample.ts`)도 같은 모양을 만든다.
import { applyDeltaRows } from "@fresnel/client";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type {
  TurnRecord,
  TurnRecordDeltaParams,
  TurnRecordGetResult,
  TurnSummary,
} from "@fresnel/contracts/wire";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useSelectedThreadId } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import { tabLinkOf } from "../../workbench/tab-read.ts";
import { loadOf, type Link, type Load } from "../metrics/source.ts";
import { openTrace, useTraceTarget, type TraceTarget } from "./target.ts";

const TURN_PAGE = 50;

export interface TurnPage {
  readonly items: readonly TurnSummary[];
  readonly next: string | null;
  /** 이 대화의 기록이 꺼져 있다(`enabled: false`) */
  readonly off: boolean;
}

export interface TraceActions {
  readonly reload: () => void;
  readonly pick: (turnId: string) => void;
  readonly more: () => void;
  /** 온 자리로 돌아간다. 온 자리가 없으면 null */
  readonly back: (() => void) | null;
}

export interface TraceData {
  readonly link: Link;
  /** 펼칠 대화. 여는 쪽이 정했거나, 없으면 대화 영역에서 고른 대화 */
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly from: TraceTarget["from"] | null;
  readonly turns: Load<TurnPage>;
  readonly loadingMore: boolean;
  readonly record: Load<TurnRecordGetResult>;
  /** 알림으로 받는 중(턴이 도는 중) */
  readonly watching: boolean;
  readonly actions: TraceActions;
}

/** 알림 행을 누적본에 넣는다. 다른 턴의 행이면 그대로 둔다. 자리를 못 찾은 행이 있으면 `stale` */
export function withDelta(
  record: TurnRecord,
  delta: TurnRecordDeltaParams,
): { readonly record: TurnRecord; readonly stale: boolean } {
  if (delta.turnId !== record.turnId || delta.threadId !== record.threadId) {
    return { record, stale: false };
  }
  const applied = applyDeltaRows(record, delta.rows);
  return { record: applied.record, stale: applied.orphans > 0 };
}

interface Live {
  readonly turnId: string;
  readonly record: TurnRecord;
}

export function useTraceSource(): TraceData {
  const commands = useCommands();
  const shell = useShellActions();
  const link = tabLinkOf(useLinkPhase());
  const target = useTraceTarget();
  const selected = useSelectedThreadId();
  const m = commands.craftMetrics;
  const threadId = target?.threadId ?? selected;
  const [picked, setPicked] = useState<{
    readonly threadId: string;
    readonly turnId: string;
  } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  // 턴 목록: 첫 쪽은 대화가 바뀌거나 다시 읽을 때, 다음 쪽은 "더 보기"로 붙인다
  const [pages, setPages] = useState<{
    readonly key: string;
    readonly result: Awaited<ReturnType<typeof m.turns>>;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const listKey = `${threadId ?? ""}:${String(nonce)}`;
  useEffect(() => {
    if (link !== "live" || threadId === null) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const result = await m.turns({ threadId, limit: TURN_PAGE });
      if (active) setPages({ key: listKey, result });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [listKey, link]);
  const turnsLoad = loadOf(pages, listKey, link);
  const turns: Load<TurnPage> =
    turnsLoad.kind === "ready"
      ? {
          ...turnsLoad,
          value: {
            items: turnsLoad.value.items,
            next: turnsLoad.value.next,
            off: !turnsLoad.value.enabled,
          },
        }
      : turnsLoad;

  // 펼칠 턴: 고른 턴 > 여는 쪽이 정한 턴 > 목록의 가장 최근 턴
  const newest = turns.kind === "ready" ? (turns.value.items[0]?.turnId ?? null) : null;
  const turnId =
    picked !== null && picked.threadId === threadId
      ? picked.turnId
      : target !== null && target.threadId === threadId
        ? target.turnId
        : newest;

  const recordKey = `${threadId ?? ""}:${turnId ?? ""}:${String(nonce)}`;
  const [got, setGot] = useState<{
    readonly key: string;
    readonly result: Awaited<ReturnType<typeof m.turn>>;
  } | null>(null);
  useEffect(() => {
    if (link !== "live" || threadId === null || turnId === null) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const result = await m.turn(threadId, turnId);
      if (active) setGot({ key: recordKey, result });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [recordKey, link]);
  const recordLoad = loadOf(got, recordKey, link);

  // 도는 턴의 알림
  const [live, setLive] = useState<Live | null>(null);
  const base = recordLoad.kind === "ready" ? recordLoad.value.record : null;
  const open = base !== null && base.status === "open";
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!open || link !== "live" || threadId === null || turnId === null) return undefined;
    let active = true;
    let close: (() => void) | null = null;
    const run = async (): Promise<void> => {
      const sub = await m.watch(threadId, (delta) => {
        if (!active) return;
        setLive((prev) => {
          const from = prev !== null && prev.turnId === turnId ? prev.record : base;
          const next = withDelta(from, delta);
          if (next.stale) setNonce((n) => n + 1);
          return { turnId, record: next.record };
        });
      });
      if (!sub.ok) return;
      if (!active) {
        sub.value();
        return;
      }
      close = sub.value;
      setWatching(true);
    };
    detach(run(), rethrow);
    return () => {
      active = false;
      setWatching(false);
      close?.();
    };
  }, [open, link, recordKey]);

  const record: Load<TurnRecordGetResult> =
    recordLoad.kind === "ready" &&
    live !== null &&
    live.turnId === turnId &&
    recordLoad.value.record !== null
      ? { ...recordLoad, value: { ...recordLoad.value, record: live.record } }
      : recordLoad;

  const more = useCallback(() => {
    if (
      pages === null ||
      !pages.result.ok ||
      pages.result.value.next === null ||
      threadId === null
    ) {
      return;
    }
    const cursor = pages.result.value.next;
    const prior = pages.result.value;
    const key = pages.key;
    setLoadingMore(true);
    const run = async (): Promise<void> => {
      const next = await m.turns({ threadId, limit: TURN_PAGE, cursor });
      setLoadingMore(false);
      if (!next.ok) return;
      setPages({
        key,
        result: ok({ ...next.value, items: [...prior.items, ...next.value.items] }),
      });
    };
    detach(run(), rethrow);
  }, [pages, threadId, m]);

  const from = target?.from ?? null;
  const actions = useMemo<TraceActions>(
    () => ({
      reload,
      pick: (id) => {
        if (threadId === null) return;
        setPicked({ threadId, turnId: id });
        setLive(null);
        openTrace({ threadId, turnId: id, from: from ?? "trace" });
      },
      more,
      back:
        from === "metrics"
          ? () => {
              shell.updatePlace({ screen: "craft-metrics", scroll: 0 });
            }
          : from === "chat"
            ? () => {
                shell.switchArea("chat");
              }
            : null,
    }),
    [reload, more, threadId, from, shell],
  );

  return {
    link,
    threadId,
    turnId,
    from,
    turns,
    loadingMore,
    record,
    watching,
    actions,
  };
}
