// 플러그인 자세히 보기: 캔버스 전체에 플러그인 하나(또는 그룹 하나)를 편다.
// 가운데는 한 턴의 흐름(위에서 아래 생명선). 이 플러그인이 끼어드는 순간만 펼치고 나머지는 얇은 눈금으로 접어 한 턴이 다 보이게 한다.
// 그룹은 구성원마다 열 하나, 같은 생명선 위에 놓아 구성원 사이 손 넘김이 보인다. 옆에는 넣어 주는 것·켜진 곳·설정·버전·코드.
import { useState, type ReactNode } from "react";
import { Button } from "@caustic/react";
import { T } from "../_shell/terms";
import {
  FOLD_LABEL,
  ORIGIN_LABEL,
  PHASES,
  groupById,
  manifestText,
  pluginById,
  type Group,
  type Plugin,
} from "./data";
import { Code, Provides, ReachControl, reachHint } from "./card";
import {
  DEFAULT_SETTINGS,
  MOMENTS,
  OFF_TURN,
  OUTCOME_LABEL,
  SETTINGS,
  STEPS,
  VERB_LABEL,
  stepRan,
  type Moment,
  type Outcome,
  type Step,
} from "./flow";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { RIGHT_GAP } from "./panels";
import { groupState, useMock, type Mock } from "./store";

const LABEL = "text-footnote text-text-tertiary";
const railOf = (n: number): string => (n > 1 ? "9.5rem" : "13rem");

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}초` : `${ms}ms`);

interface Col {
  p: Plugin;
  steps: Step[];
}

/** 같은 순간(없으면 그 뒤 처음 나오는 순간)에서 이 열을 받는 쪽이 누구에게서 받았나 */
function handoffs(cols: readonly Col[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const order = [...MOMENTS, ...OFF_TURN].map((m) => m.id);
  for (const c of cols)
    for (const st of c.steps) {
      if (st.to === undefined) continue;
      const target = cols.find((x) => x.p.id === st.to);
      if (target === undefined) continue;
      const from = order.indexOf(st.at);
      const next = target.steps
        .filter((x) => order.indexOf(x.at) >= from)
        .sort((a, b) => order.indexOf(a.at) - order.indexOf(b.at))[0];
      if (next === undefined) continue;
      const key = `${target.p.id}@${next.at}`;
      out.set(key, [...(out.get(key) ?? []), c.p.name]);
    }
  return out;
}

const OUTCOME_TONE: Record<Outcome, string> = {
  ok: "border-border-default text-text-secondary",
  changed: "border-text-primary text-text-primary",
  blocked: "border-text-primary bg-text-primary text-surface-base",
  failed: "border-danger-border bg-danger-soft text-danger-text",
  skipped: "border-dashed border-border-default text-text-tertiary",
};

function VerbPill({ verb }: { verb: Step["verb"] }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-footnote leading-none ${verb === "first" ? "border-text-primary text-text-primary" : verb === "chain" ? "border-text-secondary text-text-primary" : verb === "collect" ? "border-dashed border-text-secondary text-text-primary" : "border-border-default text-text-secondary"}`}
    >
      {VERB_LABEL[verb]}
    </span>
  );
}

function StepCard({
  col,
  st,
  grp,
  recent,
  from,
  names,
  wide,
}: {
  col: Col;
  st: Step;
  grp: boolean;
  recent: boolean;
  from: string[];
  names: (id: string) => string;
  wide: boolean;
}) {
  const ran = stepRan(col.p.id, st);
  const failed = recent && ran.out === "failed";
  return (
    <div
      className={`grid gap-2 rounded-2xl border bg-surface-base px-3 py-2.5 ${failed ? "border-danger-border" : "border-border-default"}`}
      style={grp && !failed ? { borderTopColor: GRP.graphic, borderTopWidth: 2 } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <VerbPill verb={st.verb} />
        {from.length > 0 && (
          <span
            className="inline-flex h-5 items-center rounded-full px-2 text-footnote leading-none text-text-primary"
            style={{ background: GRP.soft, border: `1px solid ${GRP.border}` }}
          >
            ← {from.join(", ")}
          </span>
        )}
        {recent && (
          <span
            className={`ms-auto inline-flex h-5 items-center rounded-full border px-2 text-footnote leading-none ${OUTCOME_TONE[ran.out]}`}
          >
            {OUTCOME_LABEL[ran.out]}
          </span>
        )}
      </div>
      {wide ? (
        <dl className="m-0 grid grid-cols-3 gap-x-4">
          <div className="grid content-start gap-0.5">
            <dt className={LABEL}>받는 것</dt>
            <dd className="m-0 text-body text-text-secondary">{st.gets}</dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className={LABEL}>
              {st.verb === "tap" || st.verb === "draw" || st.verb === "call"
                ? "하는 일"
                : "정하는 것"}
            </dt>
            <dd className="m-0 text-body text-text-primary">{st.does}</dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className={LABEL}>넘기는 것</dt>
            <dd className="m-0 text-body text-text-secondary">{st.hands}</dd>
          </div>
        </dl>
      ) : (
        <div className="grid gap-1.5">
          <p className="m-0 text-body text-text-primary">{st.does}</p>
          <p className="m-0 text-footnote text-text-secondary">
            <span className="text-text-tertiary">받음 </span>
            {st.gets}
          </p>
          <p className="m-0 text-footnote text-text-secondary">
            <span className="text-text-tertiary">넘김 </span>
            {st.hands}
            {grp && st.to !== undefined && (
              <span
                className="ms-1.5 inline-flex h-5 items-center rounded-full px-2 align-middle text-footnote leading-none text-text-primary"
                style={{ background: GRP.soft, border: `1px solid ${GRP.border}` }}
              >
                → {names(st.to)}
              </span>
            )}
          </p>
        </div>
      )}
      {recent && (
        <div className="grid gap-1.5 border-t border-border-subtle pt-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-inset">
              <span
                className={`block h-full rounded-full ${failed ? "bg-danger-graphic" : "bg-text-primary"}`}
                style={{ width: `${Math.max(3, Math.min(100, (ran.ms / 1500) * 100))}%` }}
              />
            </span>
            <span className="flex-none font-mono text-mono-sm text-text-secondary">
              {fmtMs(ran.ms)}
            </span>
          </div>
          <span className="text-body text-text-primary">{ran.note}</span>
          {failed && ran.reason !== undefined && (
            <p className="m-0 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-body text-danger-text">
              {ran.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  mo,
  cols,
  grp,
  recent,
  links,
  names,
}: {
  mo: Moment;
  cols: readonly Col[];
  grp: boolean;
  recent: boolean;
  links: Map<string, string[]>;
  names: (id: string) => string;
}) {
  const acting = cols.filter((c) => c.steps.some((s) => s.at === mo.id));
  const time = recent ? (
    <span className="w-10 flex-none text-end font-mono text-mono-sm text-text-tertiary">
      {mo.at.toFixed(1)}s
    </span>
  ) : null;
  const line = (
    <span aria-hidden className="absolute bottom-0 left-[3.1rem] top-0 w-px bg-border-default" />
  );
  if (acting.length === 0)
    return (
      <div className="relative flex h-6 scroll-mt-14 items-center gap-2" data-moment={mo.id}>
        {line}
        {recent ? time : <span className="w-10 flex-none" />}
        <span aria-hidden className="z-10 h-px w-3 flex-none bg-border-strong" />
        <span className="truncate text-footnote text-text-tertiary">{mo.label}</span>
        {mo.fold !== null && (
          <span className="text-footnote text-text-tertiary opacity-60">
            · {FOLD_LABEL[mo.fold]}
          </span>
        )}
      </div>
    );
  return (
    <div
      className="relative grid scroll-mt-14 gap-x-3 py-2"
      style={{
        gridTemplateColumns: `${railOf(cols.length)} repeat(${cols.length}, minmax(0,1fr))`,
      }}
      data-moment={mo.id}
    >
      {line}
      <div className="relative flex items-start gap-2 pt-2.5">
        {recent ? time : <span className="w-10 flex-none" />}
        <span
          aria-hidden
          className="z-10 mt-1 size-2.5 flex-none rounded-full bg-text-primary ring-4 ring-surface-base"
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="text-ui-strong text-text-primary">{mo.label}</span>
          <span className="font-mono text-mono-sm text-text-tertiary [overflow-wrap:anywhere]">
            {mo.id === "tool.run" ? "도구 실행" : mo.id}
          </span>
        </div>
      </div>
      {cols.map((c) => {
        const st = c.steps.find((s) => s.at === mo.id);
        if (st === undefined)
          return (
            <div key={c.p.id} aria-hidden className="relative">
              <span className="absolute inset-y-0 left-1/2 w-px border-l border-dashed border-border-default" />
            </div>
          );
        return (
          <StepCard
            key={c.p.id}
            col={c}
            st={st}
            grp={grp}
            recent={recent}
            from={links.get(`${c.p.id}@${mo.id}`) ?? []}
            names={names}
            wide={cols.length === 1}
          />
        );
      })}
    </div>
  );
}

/** 한 턴 전체를 한 줄로: 끼어드는 순간은 짙게, 아닌 순간은 옅게. 누르면 그 순간으로 간다. 최근 실행에서는 막음·실패가 색으로 보인다. */
function Overview({ cols, recent }: { cols: readonly Col[]; recent: boolean }) {
  const all = [
    ...MOMENTS,
    ...OFF_TURN.filter((mo) => cols.some((c) => c.steps.some((s) => s.at === mo.id))),
  ];
  return (
    <div role="group" aria-label="한 턴 전체" className="-mx-1 flex gap-1 px-1 pb-2 pt-1">
      {all.map((mo) => {
        const here = cols.flatMap((c) =>
          c.steps.filter((s) => s.at === mo.id).map((s) => stepRan(c.p.id, s)),
        );
        const out = here.some((r) => r.out === "failed")
          ? "failed"
          : here.some((r) => r.out === "blocked")
            ? "blocked"
            : null;
        const tone =
          here.length === 0
            ? "bg-border-subtle"
            : recent && out === "failed"
              ? "bg-danger-graphic"
              : "bg-text-primary";
        return (
          <button
            key={mo.id}
            type="button"
            title={`${mo.label}${here.length === 0 ? "" : " · 끼어들어요"}`}
            aria-label={`${mo.label}으로 가기`}
            onClick={() =>
              document
                .querySelector(`[data-moment="${mo.id}"]`)
                ?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
            className="group/ov grid h-5 min-w-0 flex-1 cursor-pointer place-items-center border-0 bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
          >
            <span
              className={`block rounded-full ${tone} ${here.length === 0 ? "h-1" : "h-2.5"} w-full`}
            />
          </button>
        );
      })}
    </div>
  );
}

function Flow({ cols, grp, recent }: { cols: readonly Col[]; grp: boolean; recent: boolean }) {
  const links = handoffs(cols);
  const names = (id: string): string =>
    cols.find((c) => c.p.id === id)?.p.name ?? pluginById(id)?.name ?? id;
  const off = OFF_TURN.filter((mo) => cols.some((c) => c.steps.some((s) => s.at === mo.id)));
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div className="sticky top-0 z-10 bg-surface-base">
        <Overview cols={cols} recent={recent} />
        {grp && (
          <div
            className="grid gap-x-3 pb-2"
            style={{
              gridTemplateColumns: `${railOf(cols.length)} repeat(${cols.length}, minmax(0,1fr))`,
            }}
          >
            <span />
            {cols.map((c) => (
              <div
                key={c.p.id}
                className="flex min-w-0 items-center gap-2 rounded-full border px-3 py-1"
                style={{ background: GRP.soft, borderColor: GRP.border }}
              >
                <Mark shape={SHAPE_OF[c.p.layer]} size={18} group />
                <span className="truncate text-ui-strong text-text-primary">{c.p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {PHASES.map((ph) => (
        <div key={ph.id}>
          <div className="flex items-center gap-3 pb-0.5 pt-3 ps-[3.4rem] text-footnote text-text-tertiary">
            {ph.label}
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>
          {MOMENTS.filter((mo) => mo.phase === ph.id).map((mo) => (
            <Row
              key={mo.id}
              mo={mo}
              cols={cols}
              grp={grp}
              recent={recent}
              links={links}
              names={names}
            />
          ))}
        </div>
      ))}
      {off.length > 0 && (
        <div>
          <div className="flex items-center gap-3 pb-0.5 pt-3 ps-[3.4rem] text-footnote text-text-tertiary">
            턴 밖
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>
          {off.map((mo) => (
            <Row
              key={mo.id}
              mo={mo}
              cols={cols}
              grp={grp}
              recent={recent}
              links={links}
              names={names}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 rounded-2xl bg-bg-inset p-4">
      <h3 className="m-0 text-footnote text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function Aside({
  plugin,
  group,
  members,
  m,
}: {
  plugin: Plugin;
  group: Group | undefined;
  members: readonly Plugin[];
  m: Mock;
}) {
  const [code, setCode] = useState(m.detailCode);
  const st = group === undefined ? undefined : groupState(group.id, m.reach, m.isOn);
  const settings =
    group === undefined
      ? (SETTINGS[plugin.id] ?? DEFAULT_SETTINGS)
      : [...(SETTINGS[group.id] ?? DEFAULT_SETTINGS)];
  const origin = group === undefined ? plugin.origin : group.origin;
  const version = group === undefined ? (plugin.version ?? "0.1.0") : group.version;
  const maxRank = origin === "project" ? 2 : 3;
  const reachNow = st === undefined ? m.reach(plugin.id) : st.widest;
  return (
    <aside
      aria-label="이 플러그인에 대해"
      className="grid min-h-0 content-start gap-3 overflow-y-auto pb-6"
    >
      <Section title="켜진 곳">
        <ReachControl
          value={reachNow}
          onChange={(r) =>
            group === undefined ? m.setReach(plugin.id, r) : m.setGroupReach(group.id, r)
          }
          maxRank={maxRank}
          hint={reachHint(
            origin,
            reachNow,
            group === undefined && m.health(plugin.id)?.autoOff === true,
          )}
        />
      </Section>
      <Section title="넣어 주는 것">
        {members.map((p) => (
          <div key={p.id} className="grid gap-2">
            {group !== undefined && (
              <div className="flex items-center gap-1.5 text-ui-strong text-text-primary">
                <Mark shape={SHAPE_OF[p.layer]} size={16} group on={m.isOn(p.id)} />
                {p.name}
              </div>
            )}
            <Provides p={p} m={m} />
          </div>
        ))}
      </Section>
      <Section title="설정">
        <dl className="m-0 grid gap-1.5">
          {settings.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <dt className="text-body text-text-secondary">{k}</dt>
              <dd className="m-0 text-body text-text-primary">{v}</dd>
            </div>
          ))}
        </dl>
        <Button
          size="xs"
          variant="outline"
          onClick={() => m.notify("설정 고치기는 아직 모형이에요")}
        >
          설정 고치기
        </Button>
      </Section>
      <Section title="버전">
        <div className="flex flex-wrap items-baseline gap-x-3 text-body text-text-primary">
          <span>v{version}</span>
          <span className="text-text-secondary">{ORIGIN_LABEL[origin]}</span>
          {group !== undefined && <span className="text-text-secondary">{st?.total}개 구성</span>}
        </div>
      </Section>
      <section className="grid gap-2">
        <Button size="sm" variant="outline" aria-pressed={code} onClick={() => setCode((v) => !v)}>
          {code ? "코드 접기" : "코드 보기"}
        </Button>
        {code && (
          <Code
            text={
              group === undefined
                ? manifestText({ plugin }, m.reach)
                : manifestText({ group }, m.reach)
            }
          />
        )}
        {code && <p className={`m-0 ${LABEL}`}>확장 정보 파일이에요. 저장은 아직 모형이에요.</p>}
      </section>
    </aside>
  );
}

export function PluginDetail() {
  const m = useMock();
  const t = m.detail;
  const group = t?.k === "group" ? groupById(t.id) : undefined;
  const one = t?.k === "plugin" ? m.plugins.find((p) => p.id === t.id) : undefined;
  const members =
    group !== undefined
      ? group.members
          .map((id) => m.plugins.find((p) => p.id === id))
          .filter((p): p is Plugin => p !== undefined)
      : one === undefined
        ? []
        : [one];
  const head = group === undefined ? one : (members.find((p) => p.id === group.id) ?? members[0]);
  if (head === undefined) return null;
  const cols: Col[] = members.map((p) => ({ p, steps: STEPS[p.id] ?? [] }));
  const grp = group !== undefined;
  const headGroup = group ?? (head.group === undefined ? undefined : groupById(head.group));
  const recent = m.run === "recent";
  const failing = members.map((p) => ({ p, h: m.health(p.id) })).filter((x) => x.h !== undefined);
  const title = group === undefined ? head.name : group.name;
  const acting = new Set(cols.flatMap((c) => c.steps.map((s) => s.at))).size;
  return (
    <section
      aria-label={`${title} 자세히`}
      className="absolute inset-0 z-10 flex flex-col bg-surface-base"
      style={{ paddingRight: RIGHT_GAP }}
    >
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border-subtle ps-4">
        <button
          type="button"
          onClick={m.closeDetail}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border-default bg-surface-base px-3.5 text-ui-sm text-text-primary outline-none hover:bg-neutral-hover focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
        >
          <span aria-hidden>←</span>
          {m.back === "strata" ? "순서로" : "지도로"}
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          {grp ? (
            <span
              aria-hidden
              className="size-3 flex-none rounded-full"
              style={{ background: GRP.mark }}
            />
          ) : (
            <Mark shape={SHAPE_OF[head.layer]} size={22} on={m.isOn(head.id)} />
          )}
          <h2 className="m-0 truncate text-title-2 text-text-primary">{title}</h2>
          <span
            className="inline-flex h-6 flex-none items-center rounded-full border px-2.5 text-footnote text-text-primary"
            style={
              headGroup !== undefined
                ? { background: GRP.soft, borderColor: GRP.border }
                : { borderColor: "var(--cs-color-border-default)" }
            }
          >
            {grp
              ? T.group
              : headGroup !== undefined
                ? `${headGroup.name} 그룹 구성원`
                : `단일 ${T.plugin}`}
          </span>
          <span className="truncate text-body text-text-secondary">
            {group === undefined ? head.role : group.role}
          </span>
        </div>
        {headGroup !== undefined && (
          <div
            role="radiogroup"
            aria-label="범위"
            className="ms-auto inline-flex flex-none rounded-full bg-bg-inset p-0.5"
          >
            {(
              [
                ["plugin", `${head.name}만`],
                ["group", `${headGroup.name} ${T.group} 전체`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={(k === "group") === grp}
                onClick={() =>
                  m.openDetail(
                    k === "group" ? { k, id: headGroup.id } : { k, id: head.id },
                    m.detailCode,
                  )
                }
                className={`h-8 cursor-pointer whitespace-nowrap rounded-full border-0 px-3.5 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${(k === "group") === grp ? "bg-text-primary text-surface-base" : "bg-transparent text-text-secondary hover:bg-neutral-hover"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-6 ps-4 pt-4">
        <div className="min-h-0 overflow-y-auto pb-6 pe-1">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="m-0 text-title-3 text-text-primary">한 턴의 흐름</h3>
            <span className="text-footnote text-text-tertiary">
              {acting}곳에서 끼어들어요 · 나머지는 눈금으로 접었어요
            </span>
            <div
              role="radiogroup"
              aria-label="흐름 보기"
              className="ms-auto inline-flex rounded-full bg-bg-inset p-0.5"
            >
              {(["sample", "recent"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={m.run === r}
                  onClick={() => m.setRun(r)}
                  className={`h-8 cursor-pointer rounded-full border-0 px-3.5 text-ui-sm outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)] ${m.run === r ? "bg-text-primary text-surface-base" : "bg-transparent text-text-secondary hover:bg-neutral-hover"}`}
                >
                  {r === "sample" ? "예시 흐름" : "최근 실행"}
                </button>
              ))}
            </div>
          </div>
          {recent && (
            <p className="m-0 mb-2 rounded-xl bg-bg-inset px-3 py-2 text-body text-text-secondary">
              마지막 실행 14:01 · 14.2초 한 턴 · 아래 숫자는 턴이 시작한 뒤 몇 초째인지예요
            </p>
          )}
          {failing.length > 0 && !recent && (
            <button
              type="button"
              onClick={() => m.setRun("recent")}
              className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-start text-body text-danger-text outline-none focus-visible:shadow-[0_0_0_2px_var(--cs-color-focus-ring)]"
            >
              <span aria-hidden className="size-1.5 flex-none rounded-full bg-danger-graphic" />
              <span className="min-w-0 flex-1 truncate">
                {failing.map((x) => `${x.p.name}: ${x.h?.text ?? ""}`).join(" · ")}
              </span>
              <span className="flex-none text-footnote">최근 실행에서 보기</span>
            </button>
          )}
          <Flow cols={cols} grp={grp} recent={recent} />
        </div>
        <Aside plugin={head} group={group} members={members} m={m} />
      </div>
    </section>
  );
}
