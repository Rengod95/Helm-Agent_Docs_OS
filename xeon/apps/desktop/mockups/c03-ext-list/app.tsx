// P-13 확장 목록: 켜는 범위와 대기(N-35), X 훅 행(N-36). spec §6.23, §6.21, 결정 12.
// - 꺼진 확장의 스위치를 누르면 "켜는 범위" 팝오버(이 대화만·이 프로젝트·사용자 전체). 이 대화만은 session 범위라
//   "이번 단계가 끝나면 적용" 대기 뒤 켜진다. requires 미충족이면 "필요한 기능 기다림", 관리 정책이면 잠김 + 이유 툴팁.
// - 보기 기준이 프로필이면 스위치는 프로필 고치기, 시험이면 그 시험에만(session). 범위 팝오버를 띄우지 않는다.
// - X 훅은 층 묶음의 맨 아래 한 묶음(hooks.list): 훅 이벤트, p50, 실패. 안전 모드면 싣지 않음.
// 표는 투명한 가운데 위 ghost 격자(DP-26), 층은 mono 열(DP-31), 확장 이름은 표시 이름 + 회색 mono id(결정 13).
import {
  Alert,
  Badge,
  Button,
  Input,
  Popover,
  PopoverTitle,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
  Toaster,
  toast,
  Tooltip,
} from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  extName,
  FlaskConical,
  Lock,
  Plus,
  ScenarioDock,
  Search,
  T,
  threads,
  Upload,
  User,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  profiles,
  josa,
} from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { goFolder, WbFrame } from "../_wb-c/frame";
import { DotText, ExtName, LayerCell, Mono, SectionTitle } from "../_wb-c/parts";
import {
  effect,
  init,
  reduce,
  SCOPE_WORD,
  SCRIPTS,
  type A,
  type Row,
  type S,
  type Scope,
} from "./flow";

export const STATES = [
  { id: "list", label: "기본: 보기 기준 대화" },
  { id: "scope-pick", label: "켜는 범위 고르기" },
  { id: "pending", label: "이번 단계가 끝나면 적용" },
  { id: "applied", label: "이 대화만 켜짐" },
  { id: "capwait", label: "실패: 필요한 기능 기다림" },
  { id: "managed", label: "실패: 관리 정책 잠김(이유)" },
  { id: "all", label: "보기 기준 전체(이 대화 범위 없음)" },
  { id: "profile", label: "보기 기준 프로필: 프로필 고치기" },
  { id: "trial", label: "보기 기준 시험: 이 시험에만" },
  { id: "hooks", label: "X 훅 행(hooks.list)" },
  { id: "safe", label: "안전 모드: 바깥 확장·X 훅 빠짐" },
  { id: "narrow", label: "좁은 폭(390)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  list: { script: "base", n: 0 },
  "scope-pick": { script: "enable-scope", n: 2 },
  pending: { script: "enable-scope", n: 3 },
  applied: { script: "enable-scope", n: 4 },
  capwait: { script: "enable-capwait", n: 2 },
  managed: { script: "enable-managed", n: 1 },
  all: { script: "base", n: 0 },
  profile: { script: "base", n: 0 },
  trial: { script: "base", n: 0 },
  hooks: { script: "base", n: 0 },
  safe: { script: "base", n: 0 },
  narrow: { script: "base", n: 0 },
};

export const SCENARIOS = [
  { id: "enable-scope", label: "이 대화만 켜기 → 단계 사이 → 적용" },
  { id: "enable-capwait", label: "실패: 필요한 기능 기다림" },
  { id: "enable-managed", label: "실패: 관리 정책 잠김" },
];

const LAYER_WORD: Record<Row["layer"], string> = {
  L0: T.layerL0,
  L1: T.layerL1,
  L2: T.layerL2,
  L3: T.layerL3,
  plugin: T.plugin,
  X: `${T.layerX} · X ${T.hook}`,
};
const ORDER: Row["layer"][] = ["L3", "L2", "plugin", "L1", "X"];
const GRID =
  "grid grid-cols-[minmax(0,1.4fr)_3.5rem_5rem_minmax(0,1fr)_minmax(0,1.3fr)_3rem] items-center gap-3 max-compact:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem]";

type Mode = "scope" | "profile" | "trial";

function StatusCell({ r, safe, changed = false }: { r: Row; safe: boolean; changed?: boolean }) {
  if (safe && r.external)
    return <DotText tone="neutral">{`${josa(T.safeMode, "이라", "라")} 빠짐`}</DotText>;
  if (changed)
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <DotText tone={r.state === "on" ? "success" : "neutral"}>
          {r.state === "on" ? "켜짐" : "꺼짐"}
        </DotText>
        <span className="truncate text-ui-xs text-text-tertiary">{`${josa(T.profile, "이", "가")} 바꿈`}</span>
      </span>
    );
  switch (r.state) {
    case "on":
      return (
        <DotText
          tone={(r.failures ?? 0) > 0 ? "warning" : "success"}
        >{`켜짐${r.scope !== undefined ? ` · ${SCOPE_WORD[r.scope]}` : ""}`}</DotText>
      );
    case "pending":
      return <DotText tone="info">{T.atBoundary}</DotText>;
    case "capwait":
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <DotText tone="warning">{T.capabilityWait}</DotText>
          <Mono>{r.needs}</Mono>
        </span>
      );
    case "managed":
      return <DotText tone="neutral">꺼짐 · 관리 정책</DotText>;
    case "auto":
      return <DotText tone="danger">{`${T.autoDisabled} · 연속 ${r.failures ?? 0}`}</DotText>;
    case "exempt":
      return <DotText tone="success">항상 켜짐</DotText>;
    default:
      return (
        <DotText tone="neutral">{`꺼짐${(r.failures ?? 0) > 0 ? ` · 실패 ${r.failures}` : ""}`}</DotText>
      );
  }
}

function ScopePicker({
  open,
  scope,
  hasThread,
  threadTitle,
  onScope,
  onApply,
  onClose,
  anchor,
}: {
  open: boolean;
  scope: Scope;
  hasThread: boolean;
  threadTitle: string;
  onScope: (s: Scope) => void;
  onApply: () => void;
  onClose: () => void;
  anchor: ReactNode;
}) {
  const opts: { v: Scope; title: string; hint: string }[] = [
    ...(hasThread
      ? [
          {
            v: "session" as Scope,
            title: SCOPE_WORD.session,
            hint: `${threadTitle} · ${T.atBoundary}`,
          },
        ]
      : []),
    { v: "project", title: SCOPE_WORD.project, hint: "~/code/xeon/.xeon/settings.json" },
    { v: "user", title: SCOPE_WORD.user, hint: "모든 프로젝트 · ~/.xeon/settings.json" },
  ];
  return (
    <Popover
      open={open}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      side="bottom"
      align="end"
      size="sm"
      anchor={anchor}
    >
      <PopoverTitle>{T.enableScope}</PopoverTitle>
      <RadioGroup
        size="sm"
        value={scope}
        onValueChange={(v) => onScope(v as Scope)}
        aria-label={T.enableScope}
        className="gap-0 py-1"
      >
        {opts.map((o) => (
          <RadioGroupItem key={o.v} value={o.v}>
            <span className="grid min-w-0 gap-0 py-0.5">
              <span
                className={`text-ui-dense text-text-primary ${scope === o.v ? "font-semibold" : ""}`}
              >
                {o.title}
              </span>
              <span className="truncate text-ui-xs text-text-tertiary">{o.hint}</span>
            </span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <div className="flex justify-end gap-1 pt-1">
        <Button size="xs" tone="neutral" variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button size="xs" tone="neutral" variant="solid" onClick={onApply}>
          켜기
        </Button>
      </div>
    </Popover>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const pre = usePrefill(SCRIPTS, AT[state]);
  const [s, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const safe = state === "safe";
  const c = shell.context;
  const mode: Mode = c.kind === "profile" ? "profile" : c.kind === "trial" ? "trial" : "scope";
  const hasThread = c.kind === "thread";
  const threadTitle =
    c.kind === "thread" || c.kind === "trial"
      ? (threads.find((t) => t.id === c.threadId)?.title ?? "")
      : "";
  const profileTitle =
    c.kind === "profile" ? (profiles.find((p) => p.id === c.profileId)?.title ?? "") : "";

  const seen = useRef<number | null>(
    pre.live || state === "applied" || state === "capwait" ? null : (s.note?.id ?? null),
  );
  useEffect(() => {
    if (s.note === null || s.note.id === seen.current) return;
    seen.current = s.note.id;
    toast({
      title: s.note.title,
      ...(s.note.body !== undefined ? { description: s.note.body } : {}),
      tone: s.note.tone ?? "neutral",
    });
  }, [s.note]);
  useEffect(() => {
    shell.setEndOpen(false);
    if (state === "narrow") shell.setStartOpen(false);
    if (state === "safe" || state === "hooks")
      document.getElementById("layer-X")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint = (() => {
    if (!pre.live) return undefined;
    if (pre.script === "enable-scope") {
      if (s.picking !== null) return `"${SCOPE_WORD.session}" 고르고 "켜기"`;
      const r = s.rows.find((x) => x.id === "acme-notes");
      if (r?.state === "pending") return "이번 단계가 끝나길 기다려요";
      if (r?.state === "on") return "끝났어요";
      return `${extName("acme-notes")}의 스위치를 누르세요`;
    }
    if (pre.script === "enable-capwait")
      return s.picking !== null
        ? `"켜기"를 누르세요`
        : `${extName("provider-oauth")} 스위치를 누르세요`;
    if (pre.script === "enable-managed")
      return `${extName("authoring")}의 잠긴 스위치를 눌러 이유를 보세요`;
    return undefined;
  })();

  const control = (r: Row) => {
    const label = `${extName(r.id)} 켜기`;
    if (safe && r.external) return <Switch size="sm" aria-label={label} checked={false} disabled />;
    if (r.state === "exempt")
      return (
        <Tooltip content="보안·기본 동작이라 끌 수 없어요" side="left">
          <span
            tabIndex={0}
            className="inline-flex rounded-sm outline-none focus-visible:focus-ring"
          >
            <Switch size="sm" aria-label={label} checked disabled />
          </span>
        </Tooltip>
      );
    if (r.state === "managed")
      return (
        <Tooltip
          content={
            <span className="block max-w-60 whitespace-normal">
              관리 정책으로 꺼져 있어요. 바꾸려면 관리자에게 물어요 · /etc/xeon/managed.json
            </span>
          }
          side="left"
          {...(s.lockTip === r.id ? { open: true } : {})}
        >
          <span
            tabIndex={0}
            role="button"
            aria-label={`${extName(r.id)}: 관리 정책으로 잠김`}
            onClick={() => dispatch({ t: "lockTip", id: s.lockTip === r.id ? null : r.id })}
            className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:focus-ring"
          >
            <Lock aria-hidden emphasis="muted" className="size-icon-xs text-text-tertiary" />
            <Switch size="sm" aria-label={label} checked={false} disabled />
          </span>
        </Tooltip>
      );
    if (r.state === "auto")
      return (
        <Button size="xs" tone="neutral" variant="outline" className="-me-1">
          다시 켜기
        </Button>
      );
    const on = r.state === "on" || r.state === "pending";
    if (mode === "profile")
      return (
        <Switch
          size="sm"
          aria-label={`${T.editProfile}: ${label}`}
          checked={on}
          onCheckedChange={() => dispatch({ t: "profileToggle", id: r.id })}
        />
      );
    if (mode === "trial")
      return (
        <Switch
          size="sm"
          aria-label={`${T.trialOnly}: ${label}`}
          checked={on}
          disabled={r.state === "pending"}
          onCheckedChange={() => dispatch({ t: "profileToggle", id: r.id })}
        />
      );
    const sw = (
      <span className="inline-flex">
        <Switch
          size="sm"
          aria-label={label}
          checked={on}
          disabled={r.state === "pending"}
          onCheckedChange={(v) =>
            dispatch(v ? { t: "pick", id: r.id } : { t: "toggleOff", id: r.id })
          }
        />
      </span>
    );
    if (r.state === "off" || r.state === "capwait")
      return (
        <ScopePicker
          open={s.picking === r.id}
          scope={hasThread ? s.scope : s.scope === "session" ? "project" : s.scope}
          hasThread={hasThread}
          threadTitle={threadTitle}
          onScope={(scope) => dispatch({ t: "scope", scope })}
          onApply={() => dispatch({ t: "apply" })}
          onClose={() => dispatch({ t: "closePick" })}
          anchor={sw}
        />
      );
    return sw;
  };

  // 보기 기준이 프로필이면 "적용했다면"의 모습(profile.preview): 프로필 enable 목록대로 켜짐·꺼짐, 바뀐 행에 표지.
  const prof = c.kind === "profile" ? profiles.find((p) => p.id === c.profileId) : undefined;
  const base = new Map(s.rows.map((r) => [r.id, r.state]));
  const shown: (Row & { changed?: boolean })[] =
    prof === undefined
      ? s.rows
      : s.rows.map((r) => {
          if (r.hook !== undefined || (r.state !== "on" && r.state !== "off")) return r;
          const want = prof.enable.includes(r.id) ? "on" : "off";
          const { scope: _s, ...rest } = r;
          return { ...rest, state: want, changed: want !== base.get(r.id) };
        });
  const auto = s.rows.filter((r) => r.state === "auto");
  const capwait = s.rows.filter((r) => r.state === "capwait");

  return (
    <>
      <WbFrame active="extensions" stageLabel={T.extension} modalOpen={s.picking !== null}>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <WorkbenchHead
            title={T.extension}
            meta="20개 · 켜짐 17"
            actions={
              <>
                <Button
                  size="xs"
                  tone="neutral"
                  variant="ghost"
                  iconStart={<Upload />}
                  className="max-compact:hidden"
                >
                  가져오기
                </Button>
                <Button size="xs" tone="neutral" variant="outline" iconStart={<Plus />}>
                  새 {T.group}
                </Button>
              </>
            }
            sub={
              <span>
                {mode === "scope" && hasThread
                  ? `이 ${T.thread}: 켜진 ${T.group} 2 · ${T.lead} ${extName("helm")} · `
                  : ""}
                14:24 기준
              </span>
            }
          />
          <div className={`${WB_WIDTH} grid gap-4 pb-8`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                size="xs"
                variant="soft"
                prefix={<Search />}
                placeholder="찾기"
                aria-label={`${T.extension} 찾기`}
                containerClassName="w-56 max-compact:w-full"
              />
              <Select
                size="xs"
                variant="ghost"
                aria-label={T.layer}
                defaultValue="all"
                className="w-auto"
              >
                <SelectOption value="all">{`${T.layer} 전체`}</SelectOption>
              </Select>
              <Select
                size="xs"
                variant="ghost"
                aria-label="상태"
                defaultValue="all"
                className="w-auto"
              >
                <SelectOption value="all">상태 전체</SelectOption>
              </Select>
            </div>

            {mode !== "scope" && (
              <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-neutral-well px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
                {mode === "profile" ? (
                  <User aria-hidden emphasis="muted" className="size-icon-sm text-text-tertiary" />
                ) : (
                  <FlaskConical
                    aria-hidden
                    emphasis="muted"
                    className="size-icon-sm text-text-tertiary"
                  />
                )}
                <span className="text-ui-dense text-text-primary">
                  {mode === "profile"
                    ? `${T.editProfile} · ${profileTitle}`
                    : `${T.trialOnly} · ${threadTitle}`}
                </span>
                <span className="text-ui-xs text-text-tertiary">
                  {mode === "profile"
                    ? `스위치를 바꾸면 이 ${josa(T.profile, "을", "를")} 고쳐요. 보이는 값은 적용했다면의 모습이에요.`
                    : `스위치를 바꾸면 이 ${T.trialThread}에만 저장해요(session). ${T.atBoundary}.`}
                </span>
              </div>
            )}
            {safe && (
              <Alert tone="warning" layout="inline" size="sm">
                {`${T.safeMode}예요. 내장 확장만 싣고 사용자·프로젝트 확장과 X ${josa(T.hook, "은", "는")} 싣지 않았어요.`}
              </Alert>
            )}
            {!safe && (auto.length > 0 || capwait.length > 0) && (
              <Alert tone="danger" layout="inline" size="sm">
                {[
                  auto.length > 0 ? `${extName(auto[0]?.id ?? "")} ${T.autoDisabled}` : null,
                  capwait.length > 0
                    ? `${extName(capwait[0]?.id ?? "")}: ${T.capabilityWait}(${capwait[0]?.needs ?? ""} 없음)`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Alert>
            )}

            <div
              role="table"
              aria-label={`${T.extension} 목록`}
              className="grid gap-4 text-ui-dense"
            >
              <div role="row" className={`${GRID} h-7 px-2 text-ui-xs text-text-tertiary`}>
                <span role="columnheader">이름</span>
                <span role="columnheader" className="max-compact:hidden">
                  {T.layer}
                </span>
                <span role="columnheader" className="max-compact:hidden">
                  {T.kind}
                </span>
                <span role="columnheader" className="max-compact:hidden">
                  연산
                </span>
                <span role="columnheader">상태</span>
                <span role="columnheader" className="text-end">
                  켜기
                </span>
              </div>
              {ORDER.map((layer) => {
                const rows = shown.filter((r) => r.layer === layer);
                return (
                  <div key={layer} id={`layer-${layer}`} role="rowgroup" className="grid gap-0.5">
                    <SectionTitle
                      end={
                        layer === "X" ? (
                          <span>{safe ? "싣지 않음" : "hooks.list · 14:24"}</span>
                        ) : undefined
                      }
                    >
                      <span className="inline-flex items-baseline gap-2">
                        <LayerCell>{layer}</LayerCell>
                        {LAYER_WORD[layer]}
                      </span>
                    </SectionTitle>
                    {rows.map((r) => (
                      <div
                        key={r.id}
                        role="row"
                        className={`${GRID} min-h-8 rounded-md px-2 ${s.picking === r.id ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]" : "hover:bg-neutral-hover"}`}
                      >
                        <span role="cell" className="min-w-0">
                          <button
                            type="button"
                            className="min-w-0 max-w-full truncate rounded-sm text-start outline-none focus-visible:focus-ring"
                            onClick={() =>
                              goFolder("c02-ext-detail", r.layer === "X" ? "state=hook" : "")
                            }
                          >
                            <ExtName id={r.id} />
                          </button>
                        </span>
                        <span role="cell" className="max-compact:hidden">
                          <LayerCell>{r.layer}</LayerCell>
                        </span>
                        <span
                          role="cell"
                          className="truncate text-text-secondary max-compact:hidden"
                        >
                          {r.kind}
                        </span>
                        <span role="cell" className="truncate max-compact:hidden">
                          {r.hook !== undefined ? (
                            <span className="text-text-secondary">
                              {r.hook.event}{" "}
                              <span className="text-text-tertiary">
                                · {safe ? "-" : r.hook.p50}
                              </span>
                            </span>
                          ) : (
                            <Mono>{r.ops}</Mono>
                          )}
                        </span>
                        <span role="cell" className="min-w-0">
                          {r.hook !== undefined && !safe && r.hook.failures > 0 ? (
                            <DotText tone="warning">{`켜짐 · 실패 ${r.hook.failures}`}</DotText>
                          ) : (
                            <StatusCell
                              r={r}
                              safe={safe}
                              changed={"changed" in r && r.changed === true}
                            />
                          )}
                        </span>
                        <span role="cell" className="flex justify-end">
                          {control(r)}
                        </span>
                      </div>
                    ))}
                    {layer === "L1" && (
                      <div role="row" className={`${GRID} min-h-8 px-2`}>
                        <span role="cell" className="min-w-0 truncate text-text-secondary">
                          {T.layerL0} <Mono>sqlite · exec · sandbox · secrets</Mono>
                        </span>
                        <span role="cell" className="max-compact:hidden">
                          <LayerCell>L0</LayerCell>
                        </span>
                        <span role="cell" className="max-compact:hidden" />
                        <span role="cell" className="max-compact:hidden" />
                        <span role="cell">
                          <DotText tone="success">항상 켜짐</DotText>
                        </span>
                        <span role="cell" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="m-0 flex items-center gap-1.5 text-ui-xs text-text-tertiary">
              <Badge size="xs" tone="neutral" variant="soft">
                {SCOPE_WORD.session}
              </Badge>
              {`은 그 ${T.thread}에만 쓰고 ${T.atBoundary}돼요. 프로젝트·사용자 범위는 다음 단계부터 모든 ${T.thread}에 적용돼요.`}
            </p>
          </div>
        </div>
      </WbFrame>
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
