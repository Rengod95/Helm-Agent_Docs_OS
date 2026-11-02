import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Checkbox, IconButton, Textarea } from "@caustic/react";
import { X } from "../_shell";
import { T, josa } from "../_shell/terms";
import { templates } from "../_shell/workbench-fixtures";
import { layerOf, stageOf, type BuilderContext, type LayerId } from "./data";

export interface BuilderProps {
  ctx: BuilderContext;
  /** 고른 템플릿(부모가 든다). */
  templateId: string | null;
  onTemplate: (id: string) => void;
  onClose: () => void;
  /** "만들기": 부모가 쓰고 닫는다. */
  onCreate: () => void;
}

type SkillId = "web" | "work" | "code" | "latency";
const SKILLS: readonly { id: SkillId; label: string; optional: string }[] = [
  { id: "web", label: "웹 검색 읽기", optional: "web.search" },
  { id: "work", label: "작업 기록 쓰기", optional: "work.tasks" },
  { id: "code", label: "코드 읽기", optional: "code.read" },
  { id: "latency", label: `${T.hook} 지연 측정`, optional: "hooks.latency" },
];

type RunState = "idle" | "running" | "passed";

const PROMPT = "무엇을 만들까요?";
const pluginObj = josa(T.plugin, "을", "를");
const hookObj = josa(T.hook, "을", "를");
const REPLIES = [
  `이름과 ${hookObj} 정리했어요. 오른쪽 ${T.manifest}에 반영했어요.`,
  `스킬을 더했어요. ${T.trialThread}에서 돌려 볼까요?`,
  "고쳤어요. 다시 돌려 검사할 수 있어요.",
] as const;
/** 준비 중 템플릿은 목록에서 숨기고, 그 자리(층)에 해당하는 것만 보인다. */
const SLOT_LAYERS: readonly LayerId[] = ["L2", "L1", "L0", "X"];
const HEAD = "m-0 px-4 pb-1 pt-3 text-footnote text-text-tertiary";

interface Msg {
  id: number;
  who: "user" | "agent";
  text: string;
  /** 돌려 쓰는 답. 다음 답의 순번을 세는 데 쓴다. */
  canned: boolean;
}
const msg = (id: number, who: Msg["who"], text: string, canned = false): Msg => ({
  id,
  who,
  text,
  canned,
});

function templateOf(id: string): (typeof templates)[number] | undefined {
  return templates.find((t) => t.id === id);
}

function shownTemplates(layer: LayerId | null) {
  return templates.filter(
    (t) =>
      t.disabled !== true ||
      (layer !== null && SLOT_LAYERS.includes(layer) && t.label.split(/[\s·]+/).includes(layer)),
  );
}

function openerText(ctx: BuilderContext): string {
  if (ctx.layer !== null) {
    const layer = layerOf(ctx.layer).name;
    const slot = ctx.stage === null ? layer : `${layer} · ${stageOf(ctx.stage).label}`;
    return `${slot} 자리에 끼어들 ${pluginObj} 만들어 줘`;
  }
  const group = ctx.unitPath[1];
  return group === undefined
    ? `새 ${pluginObj} 만들어 줘`
    : `${group}에 붙일 ${pluginObj} 만들어 줘`;
}

function templateLines(id: string, from: number): Msg[] {
  const t = templateOf(id);
  const head = msg(from, "agent", `템플릿을 골랐어요. ${T.manifest}부터 채울게요.`);
  return t === undefined ? [head] : [head, msg(from + 1, "agent", `${t.label} · plugin.json`)];
}

function seedLog(ctx: BuilderContext, templateId: string | null): Msg[] {
  const rest =
    templateId === null
      ? [msg(1, "agent", "오른쪽에서 템플릿을 고르거나 하고 싶은 일을 말해 주세요.")]
      : templateLines(templateId, 1);
  return [msg(0, "user", openerText(ctx)), ...rest];
}

function replyAt(n: number): string {
  return REPLIES[n % REPLIES.length] ?? REPLIES[0];
}

function runLabel(r: RunState): string {
  if (r === "running") return "돌리는 중";
  if (r === "passed") return "다시 돌리기";
  return `${T.trialThread}에서 돌려 보기`;
}

function Line({ m, first }: { m: Msg; first: boolean }) {
  if (m.who === "user") {
    return (
      <div className="flex justify-end">
        <p className="m-0 max-w-[85%] rounded-xl bg-neutral-soft px-3 py-2 text-body text-text-primary">
          {m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      {first && <span className="text-footnote text-text-tertiary">에이전트</span>}
      <p className="m-0 text-body text-text-primary">{m.text}</p>
    </div>
  );
}

export function Builder({
  ctx,
  templateId,
  onTemplate,
  onClose,
  onCreate,
}: BuilderProps): ReactNode {
  const uid = useId();
  const [log, setLog] = useState<Msg[]>(() => seedLog(ctx, templateId));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const [skills, setSkills] = useState<ReadonlySet<SkillId>>(
    () => new Set<SkillId>(["web", "work"]),
  );
  const [run, setRun] = useState<RunState>("idle");
  const listRef = useRef<HTMLDivElement>(null);
  const firstAgentId = log.find((m) => m.who === "agent")?.id;

  // 보낸 말마다 600ms 뒤에 답 하나. 정리 함수가 타이머를 지워서 닫힐 때나 다시 보낼 때 남지 않는다.
  useEffect(() => {
    if (pending === 0) return undefined;
    const t = window.setTimeout(() => {
      setLog((prev) => [
        ...prev,
        msg(prev.length, "agent", replyAt(prev.filter((m) => m.canned).length), true),
      ]);
      setPending((k) => k - 1);
    }, 600);
    return () => window.clearTimeout(t);
  }, [pending]);

  // 대화가 바뀌면 맨 아래로.
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log]);

  // 테스트 실행: 1.2초 뒤에 통과.
  useEffect(() => {
    if (run !== "running") return undefined;
    const t = window.setTimeout(() => setRun("passed"), 1200);
    return () => window.clearTimeout(t);
  }, [run]);

  const send = (): void => {
    const text = draft.trim();
    if (text === "") return;
    setLog((prev) => [...prev, msg(prev.length, "user", text)]);
    setDraft("");
    setPending((k) => k + 1);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 한글 조합 중의 Enter는 글자를 확정할 뿐 보내지 않는다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const pick = (id: string): void => {
    if (id !== templateId) setLog((prev) => [...prev, ...templateLines(id, prev.length)]);
    onTemplate(id);
  };
  const setSkill = (id: SkillId, on: boolean): void =>
    setSkills((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const manifest = JSON.stringify(
    {
      name: templateId ?? "new-plugin",
      layer: ctx.layer ?? "L3",
      points: ctx.stage === null ? [] : [`${ctx.stage}.before`],
      optional: SKILLS.filter((s) => skills.has(s.id)).map((s) => s.optional),
      scope: ctx.scopeId,
    },
    null,
    2,
  );
  const checks = [`${T.hook} 등록 검사 통과`, `범위 ${ctx.scopeLabel}에 켜짐`, "지연 한도 안"];

  return (
    <div className="@container flex h-full min-h-0 flex-col border-t border-border-subtle bg-surface-base">
      <header className="flex h-12 flex-none items-center justify-between border-b border-border-subtle px-4">
        <h2 className="m-0 text-title-3 text-text-primary">{T.plugin} 만들기</h2>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className="flex flex-none flex-wrap gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-2 text-footnote text-text-tertiary">
        <span>
          범위 <span className="text-text-primary">{ctx.scopeLabel} · {ctx.scopeValue}</span>
        </span>
        <span>
          단위 <span className="text-text-primary">{ctx.unitPath.join(" › ")}</span>
        </span>
        {ctx.layer !== null && (
          <span>
            자리{" "}
            <span className="text-text-primary">
              {layerOf(ctx.layer).name}
              {ctx.stage !== null && ` · ${stageOf(ctx.stage).label}`}
            </span>
          </span>
        )}
        <span>
          저장 <span className="font-mono text-mono-sm text-text-primary">{ctx.writeTarget}</span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @min-[760px]:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div
            ref={listRef}
            role="log"
            tabIndex={0}
            aria-label={T.thread}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="grid gap-4 px-4 py-4">
              {log.map((m) => (
                <Line key={m.id} m={m} first={m.id === firstAgentId} />
              ))}
            </div>
          </div>
          <div className="flex flex-none items-end gap-2 border-t border-border-subtle px-4 py-3">
            <Textarea
              rows={2}
              value={draft}
              onValueChange={setDraft}
              onKeyDown={onKey}
              placeholder={PROMPT}
              aria-label={PROMPT}
              containerClassName="min-w-0 flex-1"
            />
            <Button size="sm" variant="solid" onClick={send}>
              보내기
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-t border-border-subtle @min-[760px]:border-l @min-[760px]:border-t-0">
          <section aria-label="템플릿" className="flex-none border-t border-border-subtle first:border-t-0">
            <h3 className={HEAD}>템플릿</h3>
            <ul className="m-0 list-none p-0">
              {shownTemplates(ctx.layer).map((t) => {
                const sel = t.id === templateId;
                const off = t.disabled === true;
                return (
                  <li key={t.id} className="border-t border-border-subtle first:border-t-0">
                    <button
                      type="button"
                      disabled={off}
                      aria-pressed={sel}
                      onClick={() => pick(t.id)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left${sel ? " bg-neutral-soft" : ""}`}
                    >
                      <span
                        aria-hidden
                        className={`size-1.5 flex-none rounded-full${sel ? " bg-accent-solid" : ""}`}
                      />
                      <span className="grid min-w-0 gap-0.5">
                        <span className={`text-body ${off ? "text-text-tertiary" : "text-text-primary"}`}>
                          {t.label}
                        </span>
                        <span className="text-footnote text-text-tertiary">{t.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="스킬" className="flex-none border-t border-border-subtle first:border-t-0">
            <h3 className={HEAD}>스킬</h3>
            <ul className="m-0 list-none p-0">
              {SKILLS.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2.5 border-t border-border-subtle px-4 py-2.5 first:border-t-0"
                >
                  <Checkbox
                    id={`${uid}-${s.id}`}
                    aria-label={s.label}
                    checked={skills.has(s.id)}
                    onCheckedChange={(c) => setSkill(s.id, c === true)}
                  />
                  <label htmlFor={`${uid}-${s.id}`} className="text-body text-text-primary">
                    {s.label}
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={T.manifest} className="flex-none border-t border-border-subtle first:border-t-0">
            <h3 className={HEAD}>{T.manifest}</h3>
            <pre className="m-0 overflow-x-auto bg-bg-inset px-4 py-3 font-mono text-footnote text-text-secondary">
              {manifest}
            </pre>
          </section>

          <section aria-label="실행 테스트" className="flex-none border-t border-border-subtle first:border-t-0">
            <h3 className={HEAD}>실행 테스트</h3>
            <div className="px-4 py-2.5">
              <Button
                size="sm"
                variant="outline"
                loading={run === "running"}
                onClick={() => setRun("running")}
              >
                {runLabel(run)}
              </Button>
            </div>
            {run === "passed" && (
              <ul className="m-0 list-none p-0">
                {checks.map((c) => (
                  <li key={c} className="border-t border-border-subtle px-4 py-2 text-footnote text-text-primary">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <footer className="flex h-14 flex-none items-center justify-between gap-3 border-t border-border-subtle px-4">
        <span className="min-w-0 text-footnote text-text-tertiary">
          {ctx.scopeLabel}에 저장 · {T.atBoundary}돼요
        </span>
        <div className="flex flex-none items-center gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="solid" disabled={templateId === null} onClick={onCreate}>
            만들기
          </Button>
        </div>
      </footer>
    </div>
  );
}
