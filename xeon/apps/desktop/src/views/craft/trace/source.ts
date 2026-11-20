// 트레이스 화면의 원천. 실제 엔진에서 읽는다:
// - 대화의 턴 목록(`turnRecord.list`, 50개씩, "더 보기"로 다음 쪽). 수천 턴이어도 한 쪽만 들고 있다
// - 고른 턴 하나(`turnRecord.get`, 전부)
// - 턴이 도는 중이면(`status: open`) `turnRecord.watch`로 알림 행을 받아 누적본에 넣는다.
//   엔진은 Hook 실행이 끝나는 즉시 그 행을 보낸다(단계 끝을 기다리지 않는다). 그 단계·호출이 아직 기록에 없으면 행을
//   `pending`으로 들고 있다가 화면에 바로 보이고, 단계 행이 오면 같은 행(`seq`, 등록 id)이 기록에 들어가 `pending`에서 빠진다.
//   Hook이 아닌 행이 자리를 못 찾으면 다시 읽는다
// 화면은 `TraceData` 모양만 보고 그린다. 개발 빌드의 표본(`sample.ts`)도 같은 모양을 만든다.
import { applyDeltaRow } from "@fresnel/client";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type {
  HookRun,
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

/** 단계 끝 전에 먼저 온 Hook 행. 그 단계(또는 호출)가 기록에 생기면 빠진다 */
export interface PendingHook {
  readonly stepIndex: number | null;
  readonly run: HookRun;
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
  /** 도는 턴에서 방금 끝나 아직 단계에 들지 않은 Hook 행 */
  readonly pending: readonly PendingHook[];
  readonly actions: TraceActions;
}

/** 엔진이 먼저 보낸 Hook 행과 단계 끝의 행을 잇는 키(호스트 `liveHookKeyOf`와 같다) */
export function liveHookKey(run: HookRun): string {
  return `${String(run.seq)}:${run.registrationId}`;
}

/** 기록에 이미 든 Hook 행의 키 */
function recordedHookKeys(record: TurnRecord): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const run of record.turnHooks) keys.add(liveHookKey(run));
  for (const step of record.steps) {
    for (const run of step.hooks) keys.add(liveHookKey(run));
    for (const call of step.calls) for (const run of call.hooks) keys.add(liveHookKey(run));
  }
  return keys;
}

export interface LiveState {
  readonly record: TurnRecord;
  readonly pending: readonly PendingHook[];
}

/**
 * 알림 행을 누적본에 넣는다. 다른 턴의 행이면 그대로 둔다.
 * Hook 행이 자리(단계·호출)를 못 찾으면 버리지 않고 `pending`에 둔다(같은 키의 나중 행이 이긴다). 기록에 든 키는 `pending`에서 뺀다.
 * Hook이 아닌 행이 자리를 못 찾으면 `stale`(다시 읽는다)
 */
export function withDelta(
  state: LiveState,
  delta: TurnRecordDeltaParams,
): LiveState & { readonly stale: boolean } {
  const { record } = state;
  if (delta.turnId !== record.turnId || delta.threadId !== record.threadId) {
    return { ...state, stale: false };
  }
  let current = record;
  let stale = false;
  const pending = new Map(state.pending.map((p) => [liveHookKey(p.run), p]));
  for (const row of delta.rows) {
    const next = applyDeltaRow(current, row);
    current = next.record;
    if (!next.orphan) continue;
    if (row.kind === "hook")
      pending.set(liveHookKey(row.hook), { stepIndex: row.stepIndex, run: row.hook });
    else stale = true;
  }
  // 먼저 온 행의 단계가 이제 생겼으면 다시 넣어 본다(단계 행에 이미 들어 있으면 키로 빠진다)
  for (const [key, p] of pending) {
    const retry = applyDeltaRow(current, { kind: "hook", stepIndex: p.stepIndex, hook: p.run });
    if (!retry.orphan) {
      current = retry.record;
      pending.delete(key);
    }
  }
  const recorded = recordedHookKeys(current);
  const left = [...pending.values()].filter((p) => !recorded.has(liveHookKey(p.run)));
  return { record: current, pending: left, stale };
}

/** 누적본. `key`는 그 바탕이 된 읽기(`recordKey`)다: 다시 읽으면 새 기록 위에 먼저 온 Hook 행만 옮겨 쌓는다 */
interface Live {
  readonly turnId: string;
  readonly key: string;
  readonly state: LiveState;
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
          const same = prev !== null && prev.turnId === turnId;
          const from: LiveState =
            same && prev.key === recordKey
              ? prev.state
              : { record: base, pending: same ? prev.state.pending : [] };
          const next = withDelta(from, delta);
          if (next.stale) setNonce((n) => n + 1);
          return { turnId, key: recordKey, state: { record: next.record, pending: next.pending } };
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
    live.key === recordKey &&
    recordLoad.value.record !== null
      ? { ...recordLoad, value: { ...recordLoad.value, record: live.state.record } }
      : recordLoad;
  const shownRecord = record.kind === "ready" ? record.value.record : null;
  const recorded = shownRecord === null ? new Set<string>() : recordedHookKeys(shownRecord);
  const pending =
    live !== null && live.turnId === turnId
      ? live.state.pending.filter((p) => !recorded.has(liveHookKey(p.run)))
      : [];

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
    pending,
    actions,
  };
}
