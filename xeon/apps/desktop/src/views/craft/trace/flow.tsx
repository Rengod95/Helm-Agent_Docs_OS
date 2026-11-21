// 트레이스의 블록 자리 그림. 기본 턴 흐름의 여섯 블록을 위에서 아래로 놓고, 블록마다
// 이 턴에서 그 블록이 한 일(실린 재료, 모델 호출, 도구 호출, 물음, 자식 대화, 기록)과 앞·뒤에 걸린 Hook의 결정을 단다.
// 경계(대화 시작, 입력 받기)는 맨 위, 턴 종료 직전은 맨 아래다. 블록 이름은 엔진의 블록 모델 문구다.
import { activeLocale, t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { TurnRecord } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { countText, msText, tokensText } from "../metrics/format.ts";
import { KindGlyph } from "../metrics/glyphs.tsx";
import {
  BLOCK_IDS,
  blockLabelOf,
  isFault,
  loadedOf,
  totalsOf,
  type BlockId,
  type HookEntry,
} from "./model.ts";
import { DecisionMark, OUTCOME_WORD } from "./timeline.tsx";

/**
 * Hook 실행 하나의 작은 표. 외곽선 칩: 결정의 점 구슬 + 플러그인 + 결정 글. 점 구슬의 배치만으로도 막음·물음·고침·통과·고장이
 * 갈린다(글자를 읽지 않아도). `live`면 도는 턴에서 방금 끝나 아직 단계에 들지 않은 행이다
 */
export function HookChip(props: {
  readonly entry: HookEntry;
  readonly plugin?: boolean;
  readonly live?: boolean;
  readonly as?: "li" | "span";
}): ReactNode {
  const e = props.entry;
  const fault = isFault(e.outcome);
  const className = `inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-ui-sm ${fault ? "border-danger-border text-danger-text" : "border-border-subtle text-text-secondary"} ${props.live === true ? "viz-live" : ""}`;
  const body = (
    <>
      <DecisionMark decision={e.outcome} />
      {props.plugin === false ? null : <span className="text-text-primary">{e.run.plugin}</span>}
      <span>{t(OUTCOME_WORD[e.outcome])}</span>
    </>
  );
  return props.as === "span" ? (
    <span className={className}>{body}</span>
  ) : (
    <li className={className}>{body}</li>
  );
}

function HookRow(props: {
  readonly side: string;
  readonly entries: readonly HookEntry[];
}): ReactNode {
  if (props.entries.length === 0) return null;
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="w-6 shrink-0 pt-1 text-ui-sm text-text-tertiary">{props.side}</span>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {props.entries.map((e) => (
          <HookChip
            key={`${e.run.registrationId}:${String(e.run.seq)}:${String(e.run.atMs)}:${e.run.toolCallId ?? ""}`}
            entry={e}
          />
        ))}
      </ul>
    </div>
  );
}

/** 블록이 이 턴에서 한 일을 한 줄로. 기록에 없는 것은 말하지 않는다 */
function doneText(block: BlockId, record: TurnRecord): string {
  const totals = totalsOf(record);
  switch (block) {
    case "context": {
      const loaded = loadedOf(record);
      const sum = (pick: (g: (typeof loaded)[number]) => number): number =>
        loaded.reduce((s, g) => s + pick(g), 0);
      return t("desktop.craft.trace.flow.context", {
        instruction: tokensText(sum((g) => g.instruction)),
        skills: tokensText(sum((g) => g.skills)),
        tools: tokensText(sum((g) => g.tools)),
      });
    }
    case "model": {
      const ms = record.steps.reduce(
        (s, st) => s + st.modelCalls.reduce((a, c) => a + c.durationMs, 0),
        0,
      );
      return t("desktop.craft.trace.flow.model", {
        n: countText(totals.modelCalls),
        input: tokensText(totals.input),
        output: tokensText(totals.output),
        time: msText(ms),
      });
    }
    case "tools": {
      const calls = record.steps.flatMap((s) => s.calls);
      const stopped = calls.filter((c) => c.verdict !== "allowed").length;
      return t("desktop.craft.trace.flow.tools", {
        n: countText(calls.length),
        stopped: countText(stopped),
      });
    }
    case "ask": {
      const calls = record.steps.flatMap((s) => s.calls).filter((c) => c.approval !== null);
      const wait = calls.reduce((s, c) => s + (c.approval?.waitMs ?? 0), 0);
      return t("desktop.craft.trace.flow.ask", { n: countText(calls.length), wait: msText(wait) });
    }
    case "agents":
      return t("desktop.craft.trace.flow.agents", {
        children: countText(record.children.length),
        drive: countText(record.frames.length),
      });
    case "record":
      return record.complete
        ? t("desktop.craft.trace.flow.recordDone")
        : t("desktop.craft.trace.flow.recordPartial");
    default:
      return assertNever(block, "BlockId");
  }
}

export function BlockFlow(props: {
  readonly record: TurnRecord;
  readonly entries: readonly HookEntry[];
}): ReactNode {
  const locale = activeLocale();
  const at = (block: BlockId, side: "before" | "after" | "event"): HookEntry[] =>
    props.entries.filter(
      (e) => e.place.kind === "block" && e.place.block === block && e.place.side === side,
    );
  const boundary = (end: boolean): HookEntry[] =>
    props.entries.filter(
      (e) =>
        (e.place.kind === "boundary" && (e.place.id === "before-turn-end") === end) ||
        (!end && e.place.kind === "unknown"),
    );
  const start = boundary(false);
  const finish = boundary(true);
  return (
    <ol className="relative grid gap-0" aria-label={t("desktop.craft.trace.flow.label")}>
      {start.length > 0 ? (
        <li className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 pb-3">
          <div className="pt-1 text-ui-sm text-text-tertiary">
            {t("desktop.craft.trace.flow.start")}
          </div>
          <HookRow side="" entries={start} />
        </li>
      ) : null}
      {BLOCK_IDS.map((block, i) => {
        const before = at(block, "before");
        const after = at(block, "after");
        const events = at(block, "event");
        return (
          <li key={block} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4">
            <div className="relative flex gap-2.5 pb-4">
              {/* 흐름의 등뼈: 블록 사이를 잇는 선 */}
              {i < BLOCK_IDS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-7 bottom-0 left-[13px] w-px bg-border-default"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-base text-text-secondary"
              >
                <KindGlyph kind="block" />
              </span>
              <div className="min-w-0 pt-1">
                <div className="text-ui leading-5 font-medium text-text-primary">
                  {blockLabelOf(block, locale)}
                </div>
              </div>
            </div>
            <div className="grid min-w-0 content-start gap-1.5 pt-1 pb-4">
              <div className="text-ui leading-5 text-text-secondary">
                {doneText(block, props.record)}
              </div>
              <HookRow side={t("desktop.craft.trace.side.before")} entries={before} />
              <HookRow side={t("desktop.craft.trace.side.event")} entries={events} />
              <HookRow side={t("desktop.craft.trace.side.after")} entries={after} />
            </div>
          </li>
        );
      })}
      {finish.length > 0 ? (
        <li className="grid grid-cols-[11rem_minmax(0,1fr)] gap-4">
          <div className="pt-1 text-ui-sm text-text-tertiary">
            {t("desktop.craft.trace.flow.end")}
          </div>
          <HookRow side="" entries={finish} />
        </li>
      ) : null}
    </ol>
  );
}
