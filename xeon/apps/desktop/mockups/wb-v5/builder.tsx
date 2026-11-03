// 플러그인 빌더: 에이전트 대화, 템플릿 고르기, 지난 대화에서 만들기. hook이 있으면 그 훅을 알고 시작한다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Message,
  Textarea,
  Tooltip,
} from "@caustic/react";
import { X } from "../_shell";
import { T, josa } from "../_shell/terms";
import {
  BUILD_TEMPLATES,
  FOLD_LABEL,
  FOLD_TIP,
  PAST_THREADS,
  hookDef,
  type BuildTemplate,
  type Fold,
  type PastThread,
} from "./data";

export interface BuilderProps {
  /** 열 때 고른 훅 id. 없으면 null */
  hook: string | null;
  templateId: string | null;
  /** 고른 지난 대화(PAST_THREADS id). 없으면 null */
  threadId: string | null;
  onTemplate: (id: string) => void;
  onThread: (id: string | null) => void;
  onClose: () => void;
  onCreate: (c: { name: string; template: string | null }) => void;
}

const pluginObj = josa(T.plugin, "을", "를");
const PROMPT = "무엇을 만들까요?";

interface Msg {
  id: number;
  who: "user" | "agent";
  text: string;
  /** 에이전트 말의 둘째 문단 */
  next?: string;
}
type Turn = Omit<Msg, "id">;

function append(prev: readonly Msg[], turns: readonly Turn[]): Msg[] {
  return [...prev, ...turns.map((m, i) => ({ ...m, id: prev.length + i }))];
}

const ASK: Record<Fold, string> = {
  first: "어떤 경우에 차단할까요?",
  chain: "무엇을 어떻게 수정할까요?",
  tap: "무엇을 기록하거나 알릴까요?",
  collect: "어떤 내용을 합칠까요?",
};
const REPLIES = [
  `이름과 ${josa(T.hook, "을", "를")} 정리했어요.`,
  "조건을 더했어요.",
  "고쳤어요.",
] as const;

function hookTurns(hook: string | null): Turn[] {
  if (hook === null)
    return [
      { who: "user", text: `새 ${pluginObj} 만들어 줘` },
      { who: "agent", text: "지난 대화에서 시작하거나 템플릿을 골라 보세요." },
    ];
  const def = hookDef(hook);
  const label = def?.label ?? hook;
  const fold: Fold = def?.fold ?? "tap";
  return [
    { who: "user", text: `${label}에 끼어들 ${pluginObj} 만들어 줘` },
    {
      who: "agent",
      text: `${hook}는 ${FOLD_LABEL[fold]} ${josa(T.hook, "이에요", "예요")}. ${ASK[fold]}`,
    },
  ];
}

function threadTurns(t: PastThread): Turn[] {
  return [
    { who: "user", text: `「${t.title}」 대화에서 만들어 줘` },
    { who: "agent", text: t.gist, next: "이 내용으로 시작할까요?" },
  ];
}

function startTurns(hook: string | null, threadId: string | null): Turn[] {
  const past = PAST_THREADS.find((t) => t.id === threadId);
  return past === undefined ? hookTurns(hook) : threadTurns(past);
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
      {m.next !== undefined && <p>{m.next}</p>}
    </Message>
  );
}

export function Builder({
  hook,
  templateId,
  threadId,
  onTemplate,
  onThread,
  onClose,
  onCreate,
}: BuilderProps): ReactNode {
  const def = hook === null ? undefined : hookDef(hook);
  const tpl = BUILD_TEMPLATES.find((t) => t.id === templateId);
  const past = PAST_THREADS.find((t) => t.id === threadId);
  const [log, setLog] = useState<Msg[]>(() => append([], startTurns(hook, threadId)));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const firstAgent = log.find((x) => x.who === "agent")?.id;
  // 훅의 fold와 같은 템플릿을 앞에 둔다.
  const matchesHook = (t: BuildTemplate): boolean => def !== undefined && t.fold === def.fold;
  const sorted = [...BUILD_TEMPLATES].sort(
    (a, b) => Number(matchesHook(b)) - Number(matchesHook(a)),
  );

  useEffect(() => {
    if (pending === 0) return undefined;
    const t = window.setTimeout(() => {
      setLog((prev) => {
        const n = prev.filter((x) => x.who === "agent").length;
        return append(prev, [{ who: "agent", text: REPLIES[n % REPLIES.length] ?? REPLIES[0] }]);
      });
      setPending((k) => k - 1);
    }, 600);
    return () => window.clearTimeout(t);
  }, [pending]);
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [log]);

  const send = (): void => {
    const text = draft.trim();
    if (text === "") return;
    setLog((prev) => append(prev, [{ who: "user", text }]));
    setDraft("");
    setPending((k) => k + 1);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const pick = (t: BuildTemplate): void => {
    if (t.id !== templateId) {
      setLog((prev) => append(prev, [{ who: "agent", text: `${t.label} 템플릿으로 시작할게요.` }]));
    }
    onTemplate(t.id);
  };
  const pickThread = (t: PastThread): void => {
    if (t.id === threadId) return;
    setLog((prev) => append(prev, threadTurns(t)));
    onThread(t.id);
  };

  const manifest = JSON.stringify(
    {
      name: tpl?.id ?? "new-plugin",
      plugins: [{ layer: "plugin", hooks: hook === null ? [] : [hook] }],
    },
    null,
    2,
  );

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex h-12 flex-none items-center justify-between gap-3 border-b border-border-subtle ps-4 pe-16">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 flex-none text-title-3 text-text-primary">{T.plugin} 만들기</h2>
          {hook !== null && (
            <>
              {def !== undefined && (
                <span className="min-w-0 truncate text-footnote text-text-tertiary">
                  {def.label}
                </span>
              )}
              <Badge mono>{hook}</Badge>
              {def !== undefined && (
                <Tooltip content={FOLD_TIP[def.fold]} side="bottom" delayDuration={300}>
                  <Badge size="sm" variant="outline">
                    {FOLD_LABEL[def.fold]}
                  </Badge>
                </Tooltip>
              )}
            </>
          )}
        </div>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className="flex-none border-b border-border-subtle ps-4 pe-16">
        <Accordion type="multiple" size="sm">
          <AccordionItem value="template" className="min-w-0">
            <AccordionTrigger
              accessory={
                tpl === undefined ? undefined : (
                  <span className="text-footnote text-text-tertiary">{tpl.label}</span>
                )
              }
            >
              템플릿
            </AccordionTrigger>
            <AccordionContent className="max-w-none">
              <div
                role="group"
                aria-label="템플릿"
                className="flex snap-x gap-2 overflow-x-auto pb-2"
              >
                {sorted.map((t) => {
                  const on = t.id === templateId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(t)}
                      className={`flex w-44 flex-none snap-start flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left ${on ? "border-text-primary bg-neutral-soft" : "border-border-default"}`}
                    >
                      <span className="text-ui-strong text-text-primary">{t.label}</span>
                      <span className="text-footnote text-text-tertiary">{t.hint}</span>
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="manifest" className="min-w-0 border-b-0">
            <AccordionTrigger
              accessory={
                <span className="font-mono text-mono-sm text-text-tertiary">plugin.json</span>
              }
            >
              {T.plugin} 정보
            </AccordionTrigger>
            <AccordionContent>
              <pre className="overflow-x-auto rounded-md bg-bg-inset px-3 py-2.5 font-mono text-footnote text-text-secondary">
                {manifest}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-2 px-4 pt-3">
            <Menu
              size="sm"
              radius="lg"
              trigger={
                <Button size="sm" variant="outline">
                  대화에서 만들기
                </Button>
              }
            >
              {PAST_THREADS.map((t) => (
                <MenuItem
                  key={t.id}
                  selected={t.id === threadId}
                  end={t.when}
                  onSelect={() => pickThread(t)}
                >
                  {t.title}
                </MenuItem>
              ))}
            </Menu>
            {past !== undefined && (
              <Chip
                size="sm"
                variant="soft"
                removeLabel="선택 해제"
                onRemove={() => onThread(null)}
              >
                {past.title}
              </Chip>
            )}
          </div>

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
            onClick={() => onCreate({ name: "새 플러그인", template: templateId })}
          >
            만들기
          </Button>
        </div>
      </footer>
    </div>
  );
}
