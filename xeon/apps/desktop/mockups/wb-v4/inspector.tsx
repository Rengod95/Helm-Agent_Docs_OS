// 오른쪽 상세: 고른 것의 내용과 고치기. 탭 흐름 / 프로필 / 코드는 모두 지금 단위(전체 루프·플러그인 그룹·플러그인)의 것이고, 탭 제목이 단위 이름을 말한다.
// 내용 아이디어는 wb-compose에서(단계 머신, 층 쌓기, 뼈대 파일) 가져오되 배치는 가져오지 않았다.
import {
  Button,
  IconButton,
  SegmentedControl,
  SegmentedControlItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { X } from "../_shell/icons";
import { T } from "../_shell/terms";
import { helmInquiry, profiles } from "../_shell/workbench-fixtures";
import {
  ALLOWED,
  ALL_HOOKS,
  FOLD_LABEL,
  GROUP_MEMBERS,
  SCOPES,
  SETTINGS,
  STAGES,
  hooksAtStage,
  layerOf,
  ownerPlugin,
  pluginById,
  pluginsAt,
  pluginsIn,
  scopeOf,
  settingValue,
  stageOf,
  stagesOf,
  unitName,
  type HookRef,
  type Plugin,
  type ScopeId,
  type Selection,
  type Unit,
} from "./data";
import { useMock, type InspectorTab } from "./store";

const cn = (...p: Array<string | false | null | undefined>): string =>
  p.filter((x): x is string => typeof x === "string" && x !== "").join(" ");

const TAB_LABEL: Record<InspectorTab, string> = {
  flow: T.flow,
  profile: T.profile,
  code: T.composeCode,
};

function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border-subtle first:border-t-0">
      <div className="flex min-h-10 items-center justify-between gap-2 px-4 pt-3 pb-1">
        <h3 className="text-footnote text-text-tertiary">{title}</h3>
        {action}
      </div>
      <div className="pb-3">{children}</div>
    </section>
  );
}

function Row({
  left,
  right,
  onClick,
  selected,
}: {
  left: ReactNode;
  right?: ReactNode;
  onClick?: (() => void) | undefined;
  selected?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-start text-body text-text-primary">{left}</span>
      {right !== undefined && (
        <span className="flex-none text-footnote text-text-tertiary">{right}</span>
      )}
    </>
  );
  const base = cn(
    "flex min-h-9 w-full items-center gap-3 px-4 py-1.5",
    selected && "bg-neutral-soft",
  );
  return onClick === undefined ? (
    <div className={base}>{body}</div>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        "cursor-pointer outline-none hover:bg-neutral-hover focus-visible:shadow-[inset_0_0_0_2px_var(--cs-color-focus-ring)]",
      )}
    >
      {body}
    </button>
  );
}

const fromWord = (f: ScopeId | "default"): string => (f === "default" ? "기본값" : scopeOf(f).label);

/** 켜짐·꺼짐·물려받기. 늘 지금 범위에 쓴다. */
function EnableControl({ p }: { p: Plugin }) {
  const m = useMock();
  const e = m.eff(p);
  if (p.locked === true) return <span className="text-footnote text-text-tertiary">끌 수 없어요</span>;
  const value = e.here ? (e.on ? "on" : "off") : "inherit";
  return (
    <div className="grid justify-items-end gap-1">
      <SegmentedControl
        aria-label={`${p.name} 켜짐`}
        size="sm"
        value={value}
        onValueChange={(v) => m.write(p.id, v === "on" ? "on" : v === "off" ? "off" : null)}
        className="[&_[data-state=checked]]:font-semibold"
      >
        <SegmentedControlItem value="on">켜짐</SegmentedControlItem>
        <SegmentedControlItem value="off">꺼짐</SegmentedControlItem>
        <SegmentedControlItem value="inherit">물려받기</SegmentedControlItem>
      </SegmentedControl>
      {!e.here && (
        <span className="text-footnote text-text-tertiary">
          {fromWord(e.from)}에서 {e.on ? "켜짐" : "꺼짐"}
        </span>
      )}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-footnote">{children}</span>;
}

// ── 고른 것 ───────────────────────────────────────────────────────
function SelectionSection({ s, onClear }: { s: Selection; onClear: () => void }) {
  const m = useMock();
  const clear = (
    <Button size="xs" variant="ghost" onClick={onClear}>
      선택 풀기
    </Button>
  );
  if (s.kind === "hook") {
    const ref = ALL_HOOKS.find((x) => x.plugin.id === s.plugin && x.hook.point === s.point);
    if (ref === undefined) return null;
    const { plugin, hook } = ref;
    return (
      <Section title={`${T.hook} 하나`} action={clear}>
        <div className="px-4 pb-2 text-title-3 text-text-primary">
          <Mono>{hook.point}</Mono>
        </div>
        <Row left="플러그인" right={plugin.name} onClick={() => m.setUnit(plugin.kind === "group" ? { kind: "group", id: plugin.id } : { kind: "plugin", id: plugin.id })} />
        <Row left="단계" right={stageOf(ref.stage).label} />
        <Row left="방식" right={FOLD_LABEL[hook.fold]} />
        {hook.budget !== undefined && <Row left="한도" right={`${hook.budget}ms`} />}
        {hook.p95 !== undefined && <Row left="지연 p95" right={`${hook.p95}ms`} />}
        {hook.fails !== undefined && hook.fails > 0 && <Row left="실패" right={`${hook.fails}번`} />}
        <div className="flex items-center justify-between gap-2 px-4 pt-2">
          <EnableControl p={plugin} />
        </div>
        <div className="flex gap-2 px-4 pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => m.openBuilder({ layer: plugin.layer, stage: ref.stage }, null)}
          >
            {T.hook} 고치기
          </Button>
        </div>
      </Section>
    );
  }
  if (s.kind === "cell") {
    const items = pluginsAt(s.layer, s.stage);
    const allowed = ALLOWED[s.layer].includes(s.stage);
    return (
      <Section title={`${layerOf(s.layer).name} · ${stageOf(s.stage).label}`} action={clear}>
        {items.length === 0 && <Row left={<span className="text-text-tertiary">비어 있어요</span>} />}
        {items.map((p) => (
          <Row
            key={p.id}
            left={p.name}
            right={m.eff(p).on ? "켜짐" : "꺼짐"}
            onClick={() => m.setUnit(p.kind === "group" ? { kind: "group", id: p.id } : { kind: "plugin", id: p.id })}
          />
        ))}
        {allowed && (
          <div className="px-4 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => m.openBuilder({ layer: s.layer, stage: s.stage }, s.layer === "L3" ? "drive" : null)}
            >
              {layerOf(s.layer).noun} 더하기
            </Button>
          </div>
        )}
      </Section>
    );
  }
  if (s.kind === "stage") {
    const hooks = hooksAtStage(s.stage);
    return (
      <Section title={stageOf(s.stage).label} action={clear}>
        <p className="px-4 pb-2 text-body text-text-tertiary">{stageOf(s.stage).when}</p>
        {hooks.map((x) => (
          <Row
            key={`${x.plugin.id}:${x.hook.point}`}
            left={x.plugin.name}
            right={FOLD_LABEL[x.hook.fold]}
            onClick={() => m.select({ kind: "hook", plugin: x.plugin.id, point: x.hook.point })}
          />
        ))}
      </Section>
    );
  }
  const layer = layerOf(s.layer);
  const items = pluginsIn(s.layer);
  const addable = ALLOWED[s.layer].length > 0;
  return (
    <Section title={`${layer.name}`} action={clear}>
      <p className="px-4 pb-2 text-body text-text-tertiary">{layer.does}</p>
      {items.map((p) => (
        <Row
          key={p.id}
          left={p.name}
          right={m.eff(p).on ? "켜짐" : "꺼짐"}
          onClick={() => m.setUnit(p.kind === "group" ? { kind: "group", id: p.id } : { kind: "plugin", id: p.id })}
        />
      ))}
      {addable && (
        <div className="px-4 pt-2">
          <Button size="sm" variant="outline" onClick={() => m.openBuilder({ layer: s.layer, stage: ALLOWED[s.layer][0] ?? "tool" }, null)}>
            {layer.noun} 더하기
          </Button>
        </div>
      )}
    </Section>
  );
}

// ── 흐름 ─────────────────────────────────────────────────────────
const PHASES = ["대기", "확산", "탐색", "수렴", "적용"] as const;
const PHASE_NOW = helmInquiry.phase === "explore" ? "탐색" : "대기";

function HookRows({ hooks }: { hooks: HookRef[] }) {
  const m = useMock();
  return (
    <>
      {hooks.map((x) => {
        const on =
          m.selection?.kind === "hook" &&
          m.selection.plugin === x.plugin.id &&
          m.selection.point === x.hook.point;
        return (
          <Row
            key={`${x.plugin.id}:${x.hook.point}`}
            selected={on}
            left={
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="flex-none text-footnote text-text-tertiary">{stageOf(x.stage).label}</span>
                <Mono>{x.hook.point}</Mono>
              </span>
            }
            right={FOLD_LABEL[x.hook.fold]}
            onClick={() => m.select({ kind: "hook", plugin: x.plugin.id, point: x.hook.point })}
          />
        );
      })}
    </>
  );
}

function FlowTab({ unit }: { unit: Unit }) {
  const m = useMock();
  const owner = ownerPlugin(unit);
  if (owner === null) {
    return (
      <Section title="턴이 지나는 단계">
        {STAGES.map((s) => {
          const n = hooksAtStage(s.id).length;
          const on = m.selection?.kind === "stage" && m.selection.stage === s.id;
          return (
            <Row
              key={s.id}
              selected={on}
              left={s.label}
              right={n > 0 ? `${T.hook} ${n}` : undefined}
              onClick={() => m.select({ kind: "stage", stage: s.id })}
            />
          );
        })}
      </Section>
    );
  }
  const hooks = ALL_HOOKS.filter((x) => x.plugin.id === owner.id);
  const memberHooks =
    unit.kind === "group"
      ? ALL_HOOKS.filter((x) => (GROUP_MEMBERS[owner.id] ?? []).includes(x.plugin.id))
      : [];
  const addStage = stagesOf(owner)[0] ?? "tool";
  return (
    <>
      {owner.id === "helm" && unit.kind === "group" && (
        <Section title="단계 머신">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4">
            {PHASES.map((p, i) => (
              <span key={p} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-text-tertiary">
                    ›
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-body",
                    p === PHASE_NOW
                      ? "font-semibold text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-accent-graphic)]"
                      : "text-text-tertiary",
                  )}
                >
                  {p}
                </span>
              </span>
            ))}
          </div>
        </Section>
      )}
      <Section
        title={`${owner.name}이 끼어드는 ${T.hook}`}
        action={
          <Button size="xs" variant="outline" onClick={() => m.openBuilder({ layer: owner.layer, stage: addStage }, null)}>
            {T.hook} 더하기
          </Button>
        }
      >
        {hooks.length === 0 ? (
          <>
            {stagesOf(owner).map((s) => (
              <Row key={s} left={stageOf(s).label} right="일해요" onClick={() => m.select({ kind: "cell", layer: owner.layer, stage: s })} />
            ))}
          </>
        ) : (
          <HookRows hooks={hooks} />
        )}
      </Section>
      {memberHooks.length > 0 && (
        <Section title="함께 쓰는 것의 훅">
          <HookRows hooks={memberHooks} />
        </Section>
      )}
      {(owner.provides !== undefined || owner.requires !== undefined) &&
        ((owner.provides?.length ?? 0) > 0 || (owner.requires?.length ?? 0) > 0) && (
          <Section title={T.capability}>
            {(owner.provides ?? []).map((c) => (
              <Row key={`p${c}`} left={<Mono>{c}</Mono>} right="주는 것" />
            ))}
            {(owner.requires ?? []).map((c) => (
              <Row key={`r${c}`} left={<Mono>{c}</Mono>} right="필요한 것" />
            ))}
          </Section>
        )}
    </>
  );
}

// ── 프로필 ───────────────────────────────────────────────────────
function ScopeStack({ p }: { p: Plugin }) {
  const m = useMock();
  return (
    <>
      {SCOPES.map((s) => {
        const v = m.overrides[s.id][p.id];
        return (
          <Row
            key={s.id}
            selected={s.id === m.scope}
            left={
              <span className="flex items-baseline gap-2">
                {s.label}
                {s.id === m.scope && <span className="text-footnote text-text-tertiary">여기에 써요</span>}
              </span>
            }
            right={v === undefined ? "물려받음" : v === "on" ? "켜짐" : "꺼짐"}
            onClick={() => m.setScope(s.id)}
          />
        );
      })}
    </>
  );
}

function SettingRows({ id }: { id: string }) {
  const m = useMock();
  const list = SETTINGS[id] ?? [];
  if (list.length === 0) return null;
  return (
    <Section title="설정">
      {list.map((s) => {
        const v = settingValue(s, m.scope);
        return (
          <Row
            key={s.key}
            left={
              <span className="flex min-w-0 items-center gap-1.5">
                {v.here && (
                  <span role="img" aria-label="이 범위에서 바꿈" className="size-1.5 flex-none rounded-full bg-[var(--cs-color-accent-graphic)]" />
                )}
                <span className="truncate">{s.label}</span>
              </span>
            }
            right={
              <span>
                <span className="text-text-primary">{v.value}</span>
                {!v.here && <span> · {fromWord(v.from)}</span>}
              </span>
            }
            onClick={() => m.notify(`${scopeOf(m.scope).writes} 저장 · 이번 단계가 끝나면 적용돼요`)}
          />
        );
      })}
    </Section>
  );
}

function ProfileTab({ unit }: { unit: Unit }) {
  const m = useMock();
  const owner = ownerPlugin(unit);
  if (owner === null) {
    return (
      <>
        <Section title={T.profile}>
          {profiles.map((p, i) => (
            <Row
              key={p.id}
              selected={i === 0}
              left={p.title}
              right={i === 0 ? (
                "쓰는 중"
              ) : (
                <Button size="xs" variant="outline" onClick={() => m.notify(`${p.title}: ${T.applyToThread} · 이번 단계가 끝나면 적용돼요`)}>
                  {T.applyToThread}
                </Button>
              )}
            />
          ))}
        </Section>
        <Section title="범위마다 바꾼 것">
          {SCOPES.map((s) => {
            const mine = Object.entries(m.overrides[s.id]);
            return (
              <div key={s.id} className={cn("px-4 py-1.5", s.id === m.scope && "bg-neutral-soft")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-body text-text-primary">{s.label}</span>
                  <span className="text-footnote text-text-tertiary">{s.value}</span>
                </div>
                {mine.length === 0 ? (
                  <div className="text-footnote text-text-tertiary">바꾼 것 없음</div>
                ) : (
                  <div className="flex flex-wrap gap-x-3 text-footnote text-text-tertiary">
                    {mine.map(([id, v]) => (
                      <button
                        key={id}
                        type="button"
                        className="cursor-pointer hover:text-text-primary"
                        onClick={() => {
                          m.setScope(s.id);
                          const pl = pluginById(id);
                          m.setUnit(pl.kind === "group" ? { kind: "group", id } : { kind: "plugin", id });
                        }}
                      >
                        {pluginById(id).name} {v === "on" ? "켜짐" : "꺼짐"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      </>
    );
  }
  const members = (unit.kind === "group" ? (GROUP_MEMBERS[owner.id] ?? []) : []).map(pluginById);
  return (
    <>
      <Section title={`켜짐 · ${scopeOf(m.scope).label}에 써요`}>
        <ScopeStack p={owner} />
        <div className="px-4 pt-3">
          <EnableControl p={owner} />
        </div>
      </Section>
      <SettingRows id={owner.id} />
      {members.length > 0 && (
        <Section title="함께 쓰는 것">
          {members.map((p) => {
            const e = m.eff(p);
            return (
              <Row
                key={p.id}
                left={
                  <span className="flex min-w-0 items-center gap-1.5">
                    {e.here && (
                      <span role="img" aria-label="이 범위에서 바꿈" className="size-1.5 flex-none rounded-full bg-[var(--cs-color-accent-graphic)]" />
                    )}
                    <span className={cn("truncate", !e.on && "text-text-tertiary")}>{p.name}</span>
                  </span>
                }
                right={p.locked === true ? "끌 수 없어요" : e.on ? "켜짐" : "꺼짐"}
                onClick={() => m.setUnit({ kind: "plugin", id: p.id })}
              />
            );
          })}
        </Section>
      )}
    </>
  );
}

// ── 코드 ─────────────────────────────────────────────────────────
function Pre({ children }: { children: string }) {
  return (
    <pre className="mx-4 overflow-x-auto rounded-lg bg-neutral-soft px-3 py-2.5 font-mono text-footnote leading-5 text-text-primary">
      {children}
    </pre>
  );
}

function manifestOf(p: Plugin): string {
  return JSON.stringify(
    {
      name: p.id,
      layer: p.layer,
      version: p.version ?? "0.1.0",
      points: p.hooks.map((k) => k.point),
      requires: p.requires ?? [],
      provides: p.provides ?? [],
    },
    null,
    2,
  );
}
function sourceOf(p: Plugin): string {
  const lines = p.hooks.map(
    (k) => `  g.on("${k.point}", ${k.fold === "first" ? "guard" : k.fold}Handler);`,
  );
  return [`export function setup(g: Group) {`, ...(lines.length > 0 ? lines : ["  // 훅 없이 기능만 줘요"]), `}`].join("\n");
}

function CodeTab({ unit }: { unit: Unit }) {
  const m = useMock();
  const owner = ownerPlugin(unit);
  const [file, setFile] = useState(0);
  if (owner === null) {
    const s = scopeOf(m.scope);
    const body = JSON.stringify(
      {
        extensions: Object.fromEntries(
          Object.entries(m.overrides[m.scope]).map(([id, v]) => [id, v === "on"]),
        ),
      },
      null,
      2,
    );
    return (
      <Section title={`${s.label}에 쓰는 파일`}>
        <div className="px-4 pb-2 font-mono text-footnote text-text-tertiary">{s.target}</div>
        <Pre>{body}</Pre>
      </Section>
    );
  }
  if (owner.locked === true) {
    return (
      <Section title="소스">
        <Row left="내장 · 읽기 전용" />
      </Section>
    );
  }
  const files =
    owner.kind === "group"
      ? ["plugin.json", "src/index.ts", "src/phases.ts", "src/blocks/signal.ts", "test/index.test.ts"]
      : ["plugin.json", "src/index.ts", "test/index.test.ts"];
  const cur = files[file] ?? "plugin.json";
  const preview =
    cur === "plugin.json" ? manifestOf(owner) : cur === "src/index.ts" ? sourceOf(owner) : `// ${cur}`;
  return (
    <>
      <Section
        title="파일"
        action={
          <Button size="xs" variant="outline" onClick={() => m.openBuilder({ layer: owner.layer, stage: stagesOf(owner)[0] ?? "tool" }, null)}>
            에이전트로 고치기
          </Button>
        }
      >
        {files.map((f, i) => (
          <Row key={f} selected={i === file} left={<Mono>{f}</Mono>} onClick={() => setFile(i)} />
        ))}
      </Section>
      <Section title={cur}>
        <Pre>{preview}</Pre>
      </Section>
    </>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────
export function Inspector() {
  const m = useMock();
  const name = unitName(m.unit);
  return (
    <aside
      aria-label="상세"
      className="flex min-h-0 w-[21rem] flex-none flex-col border-s border-border-subtle bg-bg-app"
    >
      <Tabs
        value={m.tab}
        onValueChange={(v) => m.setTab(v === "profile" ? "profile" : v === "code" ? "code" : "flow")}
        variant="soft"
        size="sm"
        tone="neutral"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h2 className="min-w-0 truncate text-title-3 text-text-primary">
            {name} {TAB_LABEL[m.tab]}
          </h2>
          <IconButton size="sm" variant="ghost" label="닫기" onClick={() => m.setInspectorOpen(false)}>
            <X />
          </IconButton>
        </div>
        <div className="px-4 py-2">
          <TabsList aria-label="상세 탭">
            <TabsTrigger value="flow">{T.flow}</TabsTrigger>
            <TabsTrigger value="profile">{T.profile}</TabsTrigger>
            <TabsTrigger value="code">{T.composeCode}</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-subtle">
          {m.selection !== null && (
            <SelectionSection s={m.selection} onClear={() => m.select(null)} />
          )}
          <TabsContent value="flow">
            <FlowTab unit={m.unit} />
          </TabsContent>
          <TabsContent value="profile">
            <ProfileTab unit={m.unit} />
          </TabsContent>
          <TabsContent value="code">
            <CodeTab unit={m.unit} key={`${m.unit.kind}-${unitName(m.unit)}`} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
