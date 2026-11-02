// 카드: 고른 것 하나를 물건처럼 보여 준다. 이름·버전, 켜진 곳, 넣어 주는 것(훅·기능·스킬·명령·도구·MCP·서브에이전트·화면), 구성원, 코드, 할 수 있는 일.
// 지도와 순서 어디서 골라도 여기로 온다. 아무것도 안 골랐으면 에이전트 전체가 카드다.
import { useState, type ReactNode } from "react";
import { Button } from "@caustic/react";
import { T } from "../_shell/terms";
import {
  CAPS,
  CONTEXT,
  FOLD_LABEL,
  FOLD_ORDER,
  GROUPS,
  LAYER_CODE,
  LAYER_NAME,
  ORIGIN_LABEL,
  PIECE_LABEL,
  PIECE_ORDER,
  REACHES,
  REACH_LABEL,
  capSlot,
  groupById,
  hookDef,
  manifestText,
  pluginById,
  providersOf,
  reachRank,
  type Group,
  type Origin,
  type PieceKind,
  type Plugin,
  type Reach,
} from "./data";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { groupState, useMock, type Mock } from "./store";

const LABEL = "text-footnote text-text-tertiary";

function Head({
  title,
  sub,
  aside,
  mark,
}: {
  title: ReactNode;
  sub: ReactNode;
  aside?: ReactNode;
  mark?: ReactNode;
}) {
  return (
    <header className="grid gap-1 pe-8">
      <div className="flex min-w-0 items-center gap-2">
        {mark}
        <h2 className="m-0 truncate text-title-2 text-text-primary">{title}</h2>
      </div>
      <div className="truncate text-body text-text-secondary">{sub}</div>
      {aside !== undefined && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-text-tertiary">
          {aside}
        </div>
      )}
    </header>
  );
}

/** 누구에게 켜져 있나. 꺼짐, 이 대화, 이 프로젝트, 모든 대화 중 하나. 값 아래에 출처를 조용히 적는다. */
export function ReachControl({
  value,
  onChange,
  maxRank,
  hint,
}: {
  value: Reach;
  onChange: (r: Reach) => void;
  maxRank: number;
  hint: string;
}) {
  return (
    <div className="grid gap-1.5">
      <div
        role="radiogroup"
        aria-label="켜진 곳"
        className="inline-flex w-full rounded-full border border-border-default bg-bg-inset p-0.5"
      >
        {REACHES.map((r) => {
          const on = value === r;
          const off = reachRank(r) > maxRank;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={off}
              onClick={() => onChange(r)}
              className={`h-7 min-w-0 flex-1 cursor-pointer whitespace-nowrap rounded-full border-0 px-2 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-40 ${
                on
                  ? "bg-text-primary text-surface-base"
                  : "bg-transparent text-text-secondary hover:bg-neutral-hover"
              }`}
            >
              {REACH_LABEL[r]}
            </button>
          );
        })}
      </div>
      <span className={LABEL}>{hint}</span>
    </div>
  );
}

export function reachHint(origin: Origin, r: Reach, autoOff: boolean): string {
  if (autoOff)
    return `${T.autoDisabled} · 다시 켜면 ${REACH_LABEL[r === "off" ? "project" : r]}에 돌아가요`;
  if (r === "off") return "꺼져 있어요";
  if (r === "thread") return `이 ${T.thread}에서만 · ${CONTEXT.thread}`;
  if (r === "project")
    return `${origin === "project" ? "프로젝트가 가져왔어요" : "프로젝트 설정에서 켜짐"} · ${CONTEXT.project}`;
  return "모든 대화에서 켜짐";
}

export function Provides({ p, m }: { p: Plugin; m: Mock }) {
  const hooks = p.hooks;
  const kinds = PIECE_ORDER.filter((k) => p.pieces.some((x) => x.kind === k));
  const optional = p.optional ?? [];
  const rows: { label: string; body: ReactNode }[] = [];
  if (hooks.length > 0)
    rows.push({
      label: T.hook,
      body: hooks.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => m.select({ k: "hook", id: h })}
          className="grid cursor-pointer gap-0 border-0 bg-transparent p-0 text-start outline-none hover:underline focus-visible:underline"
        >
          <span className="text-body text-text-primary">{hookDef(h)?.label ?? ""}</span>
          <span className="font-mono text-mono-sm text-text-tertiary">{h}</span>
        </button>
      )),
    });
  if (p.provides.length > 0)
    rows.push({
      label: T.capability,
      body: p.provides.map((c) => (
        <span key={c} className="font-mono text-mono-sm text-text-primary">
          {c}
        </span>
      )),
    });
  for (const k of kinds)
    rows.push({
      label: PIECE_LABEL[k],
      body: p.pieces
        .filter((x) => x.kind === k)
        .map((x) => (
          <span
            key={x.name}
            className={
              k === "view"
                ? "text-body text-text-primary"
                : "font-mono text-mono-sm text-text-primary"
            }
          >
            {x.name}
          </span>
        )),
    });
  if (optional.length > 0)
    rows.push({
      label: "쓰면 좋은 것",
      body: optional.map((c) => (
        <span key={c} className="font-mono text-mono-sm text-text-tertiary">
          {c}
          {(() => {
            const by = m.replaced[capSlot(c)] ?? CAPS.find((x) => x.id === c)?.builtin;
            const name = by === undefined ? undefined : pluginById(by)?.name;
            return name === undefined ? "" : ` ← ${name}`;
          })()}
        </span>
      )),
    });
  if (rows.length === 0) return <p className={`m-0 ${LABEL}`}>넣어 주는 것이 없어요</p>;
  return (
    <dl className="m-0 grid gap-2.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-3"
        >
          <dt className={LABEL}>{r.label}</dt>
          <dd className="m-0 flex flex-wrap gap-x-4 gap-y-1.5">{r.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Code({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-44 overflow-auto rounded-2xl bg-text-primary px-4 py-3 font-mono text-mono-sm text-surface-base">
      {text}
    </pre>
  );
}

// ── 플러그인 ──────────────────────────────────────────────────────
function PluginCard({ p }: { p: Plugin }) {
  const m = useMock();
  const g = p.group === undefined ? undefined : groupById(p.group);
  const h = m.health(p.id);
  const maxRank = p.origin === "project" ? reachRank("project") : 3;
  const idx = g === undefined ? -1 : g.members.indexOf(p.id);
  const [code, setCode] = useState(false);
  return (
    <div className="grid gap-3 p-4">
      <Head
        mark={
          <Mark shape={SHAPE_OF[p.layer]} size={22} group={g !== undefined} on={m.isOn(p.id)} />
        }
        title={p.name}
        sub={p.role}
        aside={
          <>
            <span>
              {g === undefined ? `단일 ${T.plugin}` : T.plugin} ·{" "}
              {p.layer === "plugin"
                ? LAYER_NAME.plugin
                : `${LAYER_NAME[p.layer]} ${LAYER_CODE[p.layer]}`}{" "}
              · v{p.version ?? "0.1.0"}
            </span>
            {g === undefined ? (
              <span>· {ORIGIN_LABEL[p.origin]}</span>
            ) : (
              <button
                type="button"
                onClick={() => m.select({ k: "group", id: g.id })}
                className="cursor-pointer rounded-full border px-2 text-footnote text-text-primary outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
                style={{ background: GRP.soft, borderColor: GRP.border }}
              >
                {g.name} {T.group} {idx + 1}/{g.members.length}
              </button>
            )}
          </>
        }
      />
      <ReachControl
        value={m.reach(p.id)}
        onChange={(r) => m.setReach(p.id, r)}
        maxRank={maxRank}
        hint={reachHint(p.origin, m.reach(p.id), h?.autoOff === true)}
      />
      {h !== undefined && (
        <button
          type="button"
          onClick={() => m.openDrawer(p.id)}
          className="flex cursor-pointer items-center gap-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-start text-body text-danger-text outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
        >
          <span aria-hidden className="size-1.5 flex-none rounded-full bg-danger-graphic" />
          <span className="min-w-0 flex-1 truncate">{h.text}</span>
          <span className="flex-none font-mono text-mono-sm">{h.hook}</span>
        </button>
      )}
      {code ? (
        <Code text={manifestText({ plugin: p }, m.reach)} />
      ) : (
        <section className="grid gap-2.5 rounded-2xl bg-bg-inset p-4">
          <h3 className="m-0 text-footnote text-text-tertiary">넣어 주는 것</h3>
          <Provides p={p} m={m} />
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="solid" onClick={() => m.openDetail({ k: "plugin", id: p.id })}>
          자세히 보기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.openBuilder(p.hooks[0] ?? null)}>
          구성 고치기
        </Button>
        <Button size="sm" variant="outline" aria-pressed={code} onClick={() => setCode((v) => !v)}>
          {code ? "넣어 주는 것" : "코드"}
        </Button>
        {g !== undefined && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => m.notify(`${g.name}에서 빼면 따로 설치된 플러그인이 돼요`)}
          >
            그룹에서 빼기
          </Button>
        )}
        {p.origin !== "builtin" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => m.notify(`${p.name}을 지우는 건 아직 모형이에요`)}
          >
            {T.uninstall}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── 그룹 ──────────────────────────────────────────────────────────
function GroupCard({ g }: { g: Group }) {
  const m = useMock();
  const st = groupState(g.id, m.reach, m.isOn);
  const members = g.members
    .map((id) => m.plugins.find((p) => p.id === id))
    .filter((p): p is Plugin => p !== undefined);
  const all = members.flatMap((p) => p.pieces);
  const count = (k: PieceKind): number => all.filter((x) => x.kind === k).length;
  const sum: [string, number][] = [
    [T.hook, new Set(members.flatMap((p) => p.hooks)).size],
    ...PIECE_ORDER.map((k): [string, number] => [PIECE_LABEL[k], count(k)]),
  ];
  const shown = sum.filter(([, n]) => n > 0);
  const maxRank = g.origin === "project" ? reachRank("project") : 3;
  const [code, setCode] = useState(false);
  return (
    <div className="grid gap-3 p-4">
      <Head
        mark={
          <span
            aria-hidden
            className="size-3 flex-none rounded-full"
            style={{ background: GRP.mark }}
          />
        }
        title={g.name}
        sub={g.role}
        aside={
          <>
            <span
              className="rounded-full border px-2 text-text-primary"
              style={{ background: GRP.soft, borderColor: GRP.border }}
            >
              {T.group}
            </span>
            <span>
              v{g.version} · {st.total}개 구성 · {ORIGIN_LABEL[g.origin]}
            </span>
          </>
        }
      />
      <ReachControl
        value={st.widest}
        onChange={(r) => m.setGroupReach(g.id, r)}
        maxRank={maxRank}
        hint={
          st.on === st.total
            ? reachHint(g.origin, st.widest, false)
            : `${st.on}/${st.total} 켜짐 · ${REACH_LABEL[st.widest]}`
        }
      />
      <section aria-label="구성원" className="grid gap-2 rounded-2xl bg-bg-inset p-2.5">
        {members.map((p) => {
          const on = m.isOn(p.id);
          return (
            <div
              key={p.id}
              className="flex min-h-11 items-center gap-1.5 rounded-2xl border border-border-default bg-surface-base ps-2.5 pe-2"
            >
              <button
                type="button"
                onClick={() => m.select({ k: "plugin", id: p.id })}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-start outline-none focus-visible:underline"
              >
                <Mark shape={SHAPE_OF[p.layer]} size={18} group on={on} />
                <span
                  className={`min-w-0 flex-1 truncate text-body ${on ? "text-text-primary" : "text-text-tertiary"}`}
                >
                  {p.name}
                </span>
                <span className="flex-none text-footnote text-text-tertiary">
                  {LAYER_NAME[p.layer]}
                </span>
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${p.name} ${on ? "끄기" : "켜기"}`}
                onClick={() => m.toggle(p.id)}
                className="grid size-6 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
              >
                <span
                  className={`size-2.5 rounded-full ${on ? "bg-text-primary" : "border border-text-tertiary"}`}
                />
              </button>
            </div>
          );
        })}
      </section>
      {code ? (
        <Code text={manifestText({ group: g }, m.reach)} />
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-body text-text-primary">
          {shown.map(([label, n]) => (
            <span key={label}>
              <span className={LABEL}>{label} </span>
              {n}
            </span>
          ))}
          {g.config !== undefined && (
            <span className="font-mono text-mono-sm text-text-tertiary">{g.config}</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="solid" onClick={() => m.openDetail({ k: "group", id: g.id })}>
          자세히 보기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.openBuilder(null)}>
          구성 고치기
        </Button>
        <Button size="sm" variant="outline" aria-pressed={code} onClick={() => setCode((v) => !v)}>
          {code ? "구성" : "코드"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => m.notify(`${g.name}을 풀면 ${st.total}개가 따로 설치돼요`)}
        >
          {st.total}개로 풀기
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => m.notify("하나씩 꺼 보며 테스트를 돌리는 건 아직 모형이에요")}
        >
          하나씩 꺼 보기
        </Button>
      </div>
    </div>
  );
}

// ── 훅(순간) ──────────────────────────────────────────────────────
const FAIL_TEXT = {
  closed: "실패하면 막아요",
  open: "실패해도 계속해요",
  skip: "실패한 핸들러만 건너뛰어요",
} as const;

function HookCard({ id }: { id: string }) {
  const m = useMock();
  const def = hookDef(id);
  const ids = m.order[id] ?? [];
  const members = ids
    .map((x) => m.plugins.find((p) => p.id === x))
    .filter((p): p is Plugin => p !== undefined);
  const fold = def?.fold ?? "tap";
  return (
    <div className="grid gap-3 p-4">
      <Head
        title={def?.label ?? id}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">{id}</span>}
        aside={<span>{FOLD_LABEL[fold]}</span>}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-body text-text-secondary">
        {FOLD_ORDER[fold] !== undefined && <span>{FOLD_ORDER[fold]}</span>}
        {def !== undefined && <span>{FAIL_TEXT[def.failure]}</span>}
      </div>
      <section aria-label={T.handler} className="grid gap-2 rounded-2xl bg-bg-inset p-3">
        {members.length === 0 && <span className={`px-1 ${LABEL}`}>걸린 핸들러가 없어요</span>}
        {members.map((p, i) => (
          <div
            key={p.id}
            className="flex min-h-12 items-center gap-2 rounded-2xl border border-border-default bg-surface-base ps-3 pe-2"
          >
            <span className="font-mono text-mono-sm text-text-tertiary">{i + 1}</span>
            <button
              type="button"
              onClick={() => m.select({ k: "plugin", id: p.id })}
              className={`min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-start text-body outline-none focus-visible:underline ${m.isOn(p.id) ? "text-text-primary" : "text-text-tertiary"}`}
            >
              {p.name}
            </button>
            <button
              type="button"
              aria-label={`${p.name} 앞으로`}
              disabled={i === 0}
              onClick={() => m.move(id, p.id, i - 1)}
              className="size-7 cursor-pointer rounded-full border-0 bg-transparent text-text-secondary outline-none hover:bg-neutral-hover disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={`${p.name} 뒤로`}
              disabled={i === members.length - 1}
              onClick={() => m.move(id, p.id, i + 1)}
              className="size-7 cursor-pointer rounded-full border-0 bg-transparent text-text-secondary outline-none hover:bg-neutral-hover disabled:opacity-30"
            >
              ›
            </button>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(id)}>
          여기에 플러그인 만들기
        </Button>
      </div>
    </div>
  );
}

// ── 내장·기능 줄 ──────────────────────────────────────────────────
function BuiltinCard({ slot }: { slot: string }) {
  const m = useMock();
  const isHook = slot.startsWith("hook:");
  const key = isHook ? slot.slice(5) : slot.slice(4);
  const def = isHook ? hookDef(key) : undefined;
  const cap = isHook ? undefined : CAPS.find((c) => c.id === key);
  const by = m.replaced[slot];
  const name = isHook ? (def?.builtin ?? key) : (pluginById(cap?.builtin ?? "")?.name ?? key);
  const candidates = isHook
    ? m.plugins.filter((p) => p.hooks.includes(key))
    : providersOf(key).filter((p) => p.id !== cap?.builtin);
  const replacer = by === undefined ? undefined : pluginById(by);
  return (
    <div className="grid gap-3 p-4">
      <Head
        title={name}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">{key}</span>}
        aside={
          <>
            <span>{isHook ? `${LAYER_NAME.L1} L1` : T.capability}</span>
            <span>{replacer === undefined ? ORIGIN_LABEL.builtin : "대체됨"}</span>
          </>
        }
      />
      <section className="grid gap-2 rounded-2xl bg-bg-inset p-3">
        <h3 className="m-0 px-1 text-footnote text-text-tertiary">대체할 수 있는 것</h3>
        {candidates.length === 0 && <span className={`px-1 ${LABEL}`}>대체할 것이 없어요</span>}
        {candidates.map((p) => (
          <div
            key={p.id}
            className="flex min-h-12 items-center gap-2 rounded-2xl border border-border-default bg-surface-base ps-3 pe-2"
          >
            <button
              type="button"
              onClick={() => m.select({ k: "plugin", id: p.id })}
              className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-start text-body text-text-primary outline-none focus-visible:underline"
            >
              {p.name}
            </button>
            <span className="font-mono text-mono-sm text-text-tertiary">v{p.version}</span>
            {by === p.id ? (
              <Button size="xs" variant="outline" onClick={() => m.replace(slot, null)}>
                내장으로 되돌리기
              </Button>
            ) : (
              <Button size="xs" variant="outline" onClick={() => m.replace(slot, p.id)}>
                대체
              </Button>
            )}
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(isHook ? key : null)}>
          대체할 플러그인 만들기
        </Button>
      </div>
    </div>
  );
}

// ── 에이전트 전체 ─────────────────────────────────────────────────
function AgentCard() {
  const m = useMock();
  const on = m.plugins.filter((p) => m.isOn(p.id));
  const pieces = on.flatMap((p) => p.pieces);
  const count = (k: PieceKind): number => pieces.filter((x) => x.kind === k).length;
  const failing = m.plugins.filter((p) => m.health(p.id) !== undefined).length;
  const hooks = new Set(on.flatMap((p) => p.hooks)).size;
  const facts: [string, string][] = [
    [T.plugin, `${on.length}/${m.plugins.length}`],
    [
      T.group,
      `${GROUPS.filter((g) => g.members.some((id) => m.isOn(id))).length}/${GROUPS.length}`,
    ],
    [T.hook, `${hooks}`],
    ...PIECE_ORDER.filter((k) => k !== "view").map((k): [string, string] => [
      PIECE_LABEL[k],
      `${count(k)}`,
    ]),
  ];
  return (
    <div className="grid gap-3 p-4">
      <Head
        title={`내 ${T.baseAgent}`}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">core.loop</span>}
        aside={
          <>
            <span>{CONTEXT.project}</span>
            <span>{CONTEXT.thread}</span>
          </>
        }
      />
      <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-3">
        {facts.map(([label, v]) => (
          <div key={label} className="grid gap-0.5">
            <dt className={LABEL}>{label}</dt>
            <dd className="m-0 text-title-3 text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 rounded-2xl bg-bg-inset p-4 text-body text-text-primary">
        <div className="flex items-center justify-between gap-3">
          <span className={LABEL}>{T.lead}</span>
          <span>
            {pluginById("helm")?.name} · {T.turn} 1/4
          </span>
        </div>
        <button
          type="button"
          onClick={() => m.openDrawer(null)}
          className="flex cursor-pointer items-center justify-between gap-3 border-0 bg-transparent p-0 text-start text-body text-text-primary outline-none focus-visible:underline"
        >
          <span className={LABEL}>{T.extFailed}</span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-danger-graphic" />
            {failing}
          </span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(null)}>
          {T.plugin} 만들기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.notify("가져오기는 아직 모형이에요")}>
          {T.install}
        </Button>
      </div>
    </div>
  );
}

export function CardBody() {
  const m = useMock();
  const s = m.sel;
  if (s.k === "plugin") {
    const p = m.plugins.find((x) => x.id === s.id);
    return p === undefined ? <AgentCard /> : <PluginCard p={p} />;
  }
  if (s.k === "group") {
    const g = groupById(s.id);
    return g === undefined ? <AgentCard /> : <GroupCard g={g} />;
  }
  if (s.k === "hook") return <HookCard id={s.id} />;
  if (s.k === "builtin") return <BuiltinCard slot={s.slot} />;
  return <AgentCard />;
}
