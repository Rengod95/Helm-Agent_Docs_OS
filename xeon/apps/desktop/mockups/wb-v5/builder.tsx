// 플러그인 빌더: 에이전트 대화 + 틀 + 스킬. "더하기"나 빈 줄에서 열면 걸 훅을 이미 알고 시작한다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  ChoiceGroup,
  ChoiceGroupItem,
  IconButton,
  Message,
  SectionHeader,
  SegmentedControl,
  SegmentedControlItem,
  Textarea,
} from "@caustic/react";
import { X } from "../_shell";
import { T, josa } from "../_shell/terms";
import { BUILD_TEMPLATES, FOLD_LABEL, REACH_LABEL, hookDef, type Fold, type Reach } from "./data";

export interface BuilderProps {
  hook: string | null;
  templateId: string | null;
  onTemplate: (id: string) => void;
  onClose: () => void;
  onCreate: (c: { name: string; template: string | null; reach: Reach }) => void;
}

type SkillId = "web" | "work" | "code" | "latency";
const SKILLS: readonly { id: SkillId; label: string; cap: string }[] = [
  { id: "web", label: "웹 검색 읽기", cap: "web.search" },
  { id: "work", label: "작업 기록 쓰기", cap: "work.tasks" },
  { id: "code", label: "코드 읽기", cap: "code.read" },
  { id: "latency", label: `${T.hook} 지연 측정`, cap: "hooks.latency" },
];
const isSkill = (x: string): x is SkillId => SKILLS.some((s) => s.id === x);
const BUILD_REACHES: readonly Reach[] = ["thread", "project", "global"];
const pluginObj = josa(T.plugin, "을", "를");

interface Msg {
  id: number;
  who: "user" | "agent";
  text: string;
}

const ASK: Record<Fold, string> = {
  first: "어떤 경우에 막을까요?",
  chain: "무엇을 어떻게 고칠까요?",
  tap: "무엇을 기록하거나 알릴까요?",
  collect: "어떤 조각을 덧붙일까요?",
};
const REPLIES = [`이름과 ${T.hook}를 정리했어요.`, "스킬을 더했어요.", "고쳤어요."] as const;

function seed(hook: string | null): Msg[] {
  const def = hook === null ? undefined : hookDef(hook);
  if (hook === null) return [{ id: 0, who: "user", text: `새 ${pluginObj} 만들어 줘` }];
  const label = def?.label ?? hook;
  const fold = def?.fold ?? "tap";
  return [
    { id: 0, who: "user", text: `${label} 끼어들 ${pluginObj} 만들어 줘` },
    {
      id: 1,
      who: "agent",
      text: `${hook}는 ${FOLD_LABEL[fold]} ${T.hook}예요. ${ASK[fold]}`,
    },
  ];
}

function Line({ m, first }: { m: Msg; first: boolean }) {
  if (m.who === "user")
    return (
      <Message author="user" radius="lg">
        {m.text}
      </Message>
    );
  return (
    <Message author="agent" meta={first ? "에이전트" : undefined}>
      <p>{m.text}</p>
    </Message>
  );
}

export function Builder({
  hook,
  templateId,
  onTemplate,
  onClose,
  onCreate,
}: BuilderProps): ReactNode {
  const def = hook === null ? undefined : hookDef(hook);
  const [log, setLog] = useState<Msg[]>(() => seed(hook));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const [reach, setReach] = useState<Reach>("project");
  const [skills, setSkills] = useState<ReadonlySet<SkillId>>(() => new Set<SkillId>(["web"]));
  const [run, setRun] = useState<"idle" | "running" | "passed">("idle");
  const listRef = useRef<HTMLDivElement>(null);
  const firstAgent = log.find((x) => x.who === "agent")?.id;
  const sorted = [...BUILD_TEMPLATES].sort(
    (a, b) =>
      Number(b.fold === def?.fold && def !== undefined) -
      Number(a.fold === def?.fold && def !== undefined),
  );
  const tpl = BUILD_TEMPLATES.find((t) => t.id === templateId);

  useEffect(() => {
    if (pending === 0) return undefined;
    const t = window.setTimeout(() => {
      setLog((prev) => [
        ...prev,
        {
          id: prev.length,
          who: "agent",
          text:
            REPLIES[prev.filter((x) => x.who === "agent").length % REPLIES.length] ?? REPLIES[0],
        },
      ]);
      setPending((k) => k - 1);
    }, 600);
    return () => window.clearTimeout(t);
  }, [pending]);
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (run !== "running") return undefined;
    const t = window.setTimeout(() => setRun("passed"), 1200);
    return () => window.clearTimeout(t);
  }, [run]);

  const send = (): void => {
    const text = draft.trim();
    if (text === "") return;
    setLog((prev) => [...prev, { id: prev.length, who: "user", text }]);
    setDraft("");
    setPending((k) => k + 1);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const pick = (id: string): void => {
    if (id !== templateId) {
      const t = BUILD_TEMPLATES.find((x) => x.id === id);
      setLog((prev) => [
        ...prev,
        { id: prev.length, who: "agent", text: `${t?.label ?? id}로 시작할게요.` },
      ]);
    }
    onTemplate(id);
  };
  const pickReach = (v: string): void => {
    const r = BUILD_REACHES.find((x) => x === v);
    if (r !== undefined) setReach(r);
  };

  const manifest = JSON.stringify(
    {
      name: tpl?.id ?? "new-plugin",
      plugins: [
        {
          layer: "plugin",
          hooks: hook === null ? [] : [hook],
          optional: SKILLS.filter((s) => skills.has(s.id)).map((s) => ({
            id: s.cap,
            range: "^1.0.0",
          })),
        },
      ],
    },
    null,
    2,
  );
  const dest =
    reach === "global"
      ? "~/.fresnel/extensions"
      : reach === "project"
        ? ".fresnel-plugin/plugin.json"
        : "이 대화 안";
  const PROMPT = "무엇을 만들까요?";

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex h-12 flex-none items-center justify-between border-b border-border-subtle px-4">
        <h2 className="m-0 text-title-3 text-text-primary">{T.plugin} 만들기</h2>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className="flex flex-none flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-subtle px-4 py-2.5 text-footnote text-text-tertiary">
        <span className="flex items-center gap-2">
          걸 곳
          <span className="text-text-primary">
            {def === undefined ? (hook ?? "정하지 않음") : def.label}
          </span>
          {hook !== null && <Badge mono>{hook}</Badge>}
        </span>
        <span className="flex items-center gap-2">
          켤 곳
          <SegmentedControl size="sm" aria-label="켤 곳" value={reach} onValueChange={pickReach}>
            {BUILD_REACHES.map((r) => (
              <SegmentedControlItem key={r} value={r}>
                {REACH_LABEL[r]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </span>
        <span>
          저장 <span className="font-mono text-mono-sm text-text-primary">{dest}</span>
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
              {log.map((x) => (
                <Line key={x.id} m={x} first={x.id === firstAgent} />
              ))}
            </div>
          </div>
          <div className="flex flex-none items-end gap-2 border-t border-border-subtle px-4 py-3">
            <Textarea
              rows={2}
              value={draft}
              onValueChange={setDraft}
              onKeyDown={onKey}
              aria-label={PROMPT}
              containerClassName="min-w-0 flex-1"
            />
            <Button size="sm" variant="solid" onClick={send}>
              보내기
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-t border-border-subtle @min-[760px]:border-l @min-[760px]:border-t-0">
          <section aria-label="틀" className="flex-none">
            <SectionHeader size="xs" headingLevel={3} title="틀" className="px-4 pb-1 pt-3" />
            <ChoiceGroup
              appearance="answer"
              aria-label="틀"
              value={templateId ?? ""}
              onValueChange={(v) => {
                if (typeof v === "string") pick(v);
              }}
              className="px-4 pb-3"
            >
              {sorted.map((t) => (
                <ChoiceGroupItem
                  key={t.id}
                  value={t.id}
                  title={t.label}
                  description={
                    def !== undefined && t.fold === def.fold ? `${hook} · ${t.hint}` : t.hint
                  }
                />
              ))}
            </ChoiceGroup>
          </section>
          <section aria-label="스킬" className="flex-none border-t border-border-subtle">
            <SectionHeader size="xs" headingLevel={3} title="스킬" className="px-4 pb-1 pt-3" />
            <ChoiceGroup
              appearance="answer"
              type="multiple"
              aria-label="스킬"
              value={[...skills]}
              onValueChange={(v) => {
                if (Array.isArray(v)) setSkills(new Set(v.filter(isSkill)));
              }}
              className="px-4 pb-3"
            >
              {SKILLS.map((s) => (
                <ChoiceGroupItem key={s.id} value={s.id} title={s.label} />
              ))}
            </ChoiceGroup>
          </section>
          <section aria-label={T.manifest} className="flex-none border-t border-border-subtle">
            <SectionHeader
              size="xs"
              headingLevel={3}
              title={T.manifest}
              className="px-4 pb-1 pt-3"
            />
            <pre className="mx-4 mb-3 overflow-x-auto rounded-md bg-bg-inset px-3 py-2.5 font-mono text-footnote text-text-secondary">
              {manifest}
            </pre>
          </section>
          <section aria-label="실행 테스트" className="flex-none border-t border-border-subtle">
            <SectionHeader
              size="xs"
              headingLevel={3}
              title="실행 테스트"
              className="px-4 pb-1 pt-3"
            />
            <div className="px-4 py-2.5">
              <Button
                size="sm"
                variant="outline"
                loading={run === "running"}
                onClick={() => setRun("running")}
              >
                {run === "running"
                  ? "돌리는 중"
                  : run === "passed"
                    ? "다시 돌리기"
                    : `${T.trialThread}에서 돌려 보기`}
              </Button>
            </div>
            {run === "passed" && (
              <ul className="m-0 list-none p-0">
                {[`${T.hook} 등록 검사 통과`, `${REACH_LABEL[reach]}에 켜짐`, "지연 한도 안"].map(
                  (c) => (
                    <li
                      key={c}
                      className="border-t border-border-subtle px-4 py-2 text-footnote text-text-primary"
                    >
                      {c}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        </div>
      </div>

      <footer className="flex h-14 flex-none items-center justify-end gap-3 border-t border-border-subtle px-4">
        <div className="flex flex-none items-center gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="solid"
            disabled={templateId === null}
            onClick={() => onCreate({ name: "새 플러그인", template: templateId, reach })}
          >
            만들기
          </Button>
        </div>
      </footer>
    </div>
  );
}
