// cvF 상세 판: 노드를 누르면 캔버스 위에 뜨는 큰 판(캔버스를 밀어내지 않는다). 머리를 끌어 옮길 수 있고, 처음에는 오른쪽 위에 뜬다.
// 카드의 칸을 다 보인다: 목적, 자리와 순서, 구성 요소, 권한과 위험, 비용, 출처·버전·해시·리뷰, 누가 넣었나, 관계, 최근 사용, 할 수 있는 일.
// 값은 계약의 필드(카드·매니페스트)에 있는 것만 쓴다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Button, IconButton } from "@caustic/react";
import { ArrowDown, ArrowUp, Play, X } from "@caustic/react/icons";
import { useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { InfoTip } from "../../info-tip.tsx";
import { agoText } from "../shared-sample.ts";
import { DecisionGlyph, KIND_COLOR, KindGlyph, KindTile } from "./glyphs.tsx";
import { zoneLetter } from "./layout.ts";
import {
  groupIn,
  inProfile,
  relationRows,
  sourceOf,
  spotOrder,
  type Catalog,
  type Group,
  type Plugin,
  type Profile,
  type RelationRow,
} from "./model.ts";
import { groupExtOf } from "./sample-ext.ts";
import {
  DECISION_WORD,
  ENFORCEMENT_WORD,
  HEALTH_WORD,
  KIND_WORD,
  LANE_WORD,
  ORIGIN_WORD,
  POWER_WORD,
  REVIEW_WORD,
  RISK_WORD,
  SPOT_WORD,
  STAGE_WORD,
} from "./words.ts";

export const PANEL_W = 440;
export const PANEL_INSET = 16;

export interface PanelActions {
  close(): void;
  focus(name: string): void;
  focusZone(id: string): void;
  open(name: string): void;
  add(name: string): void;
  remove(name: string): void;
  move(name: string, dir: -1 | 1): void;
  testRun(name: string): void;
  addGroup(id: string): void;
  removeGroup(id: string): void;
  toggleZone(id: string): void;
  moveInGroup(id: string, name: string, dir: -1 | 1): void;
}

/** 판 껍데기: 머리를 끌어 옮긴다. 두 번 누르면 제자리로 */
function Shell(props: {
  readonly label: string;
  readonly head: ReactNode;
  readonly foot: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  const [off, setOff] = useState({ x: 0, y: 0 });
  const box = useRef<HTMLElement>(null);
  const grab = (e: PointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest("button") !== null))
      return;
    const el = box.current;
    const host = el?.offsetParent;
    if (el === null || !(host instanceof HTMLElement)) return;
    const sx = e.clientX - off.x;
    const sy = e.clientY - off.y;
    const hr = host.getBoundingClientRect();
    const base = el.getBoundingClientRect();
    const minX = hr.left - (base.left - off.x) + 8;
    const maxX = hr.right - (base.right - off.x) - 8;
    const minY = hr.top - (base.top - off.y) + 8;
    const maxY = hr.bottom - (base.top - off.y) - 56;
    const move = (ev: globalThis.PointerEvent): void => {
      setOff({
        x: Math.min(maxX, Math.max(minX, ev.clientX - sx)),
        y: Math.min(maxY, Math.max(minY, ev.clientY - sy)),
      });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section
      ref={box}
      aria-label={props.label}
      className="cvf-panel"
      style={{
        width: PANEL_W,
        top: PANEL_INSET,
        right: PANEL_INSET,
        transform: `translate(${String(off.x)}px, ${String(off.y)}px)`,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <header
        className="cvf-panel-head"
        onPointerDown={grab}
        onDoubleClick={() => {
          setOff({ x: 0, y: 0 });
        }}
        title={t("desktop.craft.canvas.cvF.panel.drag")}
      >
        <div className="min-w-0 flex-1">{props.head}</div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvF.panel.close")}
          onClick={props.onClose}
        >
          <X aria-hidden />
        </IconButton>
      </header>
      <div className="cvf-panel-body">{props.children}</div>
      <footer className="cvf-panel-foot">{props.foot}</footer>
    </section>
  );
}

function Section(props: {
  readonly n: number;
  readonly title: string;
  readonly info?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="cvf-sec">
      <h4 className="cvf-sec-title">
        <span className="cvf-sec-n">{String(props.n).padStart(2, "0")}</span>
        <span>{props.title}</span>
        {props.info === undefined ? null : <InfoTip text={props.info} />}
        {props.aside === undefined ? null : <span className="ms-auto">{props.aside}</span>}
      </h4>
      {props.children}
    </section>
  );
}

function Row(props: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="cvf-kv">
      <dt>{props.k}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function Mono(props: { readonly children: ReactNode }): ReactElement {
  return <span className="font-mono text-[12px]">{props.children}</span>;
}

const RISK_STEPS = ["none", "read", "write", "exec"] as const;

function RiskScale(props: { readonly risk: Plugin["risk"] }): ReactElement {
  const at = RISK_STEPS.indexOf(props.risk);
  return (
    <div className="cvf-risk" data-level={props.risk}>
      {RISK_STEPS.map((r, i) => (
        <span key={r} className="cvf-risk-step" data-on={i <= at} data-top={i === at}>
          <span className="cvf-risk-bar" />
          <span className="cvf-risk-word">{t(RISK_WORD[r])}</span>
        </span>
      ))}
    </div>
  );
}

function tokens(n: number | null): string {
  if (n === null) return t("desktop.craft.canvas.cvF.cost.unknown");
  return t("desktop.craft.canvas.cvF.cost.tokens", { n: n.toLocaleString() });
}

function shortHash(hash: string | null): string {
  if (hash === null) return "—";
  return `${hash.slice(0, 15)}…`;
}

function day(iso: string | null): string {
  return iso === null ? "—" : iso.slice(0, 10);
}

/** 관계 줄의 기호: 캔버스의 관계 선과 같은 끝 기호 */
function RelationSymbol(props: { readonly kind: RelationRow["kind"] }): ReactElement {
  const k = props.kind;
  return (
    <svg width={28} height={12} viewBox="0 0 28 12" aria-hidden="true" className="cvf-rel-sym">
      {k === "handoffTo" || k === "handoffFrom" ? (
        <>
          <path d="M2 6h18" className="cvf-sym-line" />
          <path
            d={k === "handoffTo" ? "M18 2.5 25 6l-7 3.5Z" : "M10 2.5 3 6l7 3.5Z"}
            className="cvf-sym-fill"
          />
        </>
      ) : k === "requires" || k === "providesTo" ? (
        <>
          <path d="M2 6h17" className="cvf-sym-line" strokeDasharray="3 2.5" />
          <circle cx={k === "requires" ? 22.5 : 5.5} cy={6} r={3.4} className="cvf-sym-hollow" />
        </>
      ) : k === "replaces" ? (
        <>
          <path d="M2 6h15" className="cvf-sym-line" strokeDasharray="7 2 1.5 2" />
          <path d="M16 6 21 2.6 26 6 21 9.4Z" className="cvf-sym-hollow" />
        </>
      ) : (
        <rect x={3} y={1.5} width={22} height={9} rx={2} className="cvf-sym-zone" />
      )}
    </svg>
  );
}

function relationText(r: RelationRow): string {
  switch (r.kind) {
    case "handoffTo":
      return t("desktop.craft.canvas.cvF.rel.handoffTo", { other: r.other });
    case "handoffFrom":
      return t("desktop.craft.canvas.cvF.rel.handoffFrom", { other: r.other });
    case "requires":
      return r.engine
        ? t("desktop.craft.canvas.cvF.rel.requiresEngine", { cap: r.via ?? "" })
        : t("desktop.craft.canvas.cvF.rel.requires", { cap: r.via ?? "", other: r.other });
    case "providesTo":
      return t("desktop.craft.canvas.cvF.rel.providesTo", { cap: r.via ?? "", other: r.other });
    case "replaces":
      return t("desktop.craft.canvas.cvF.rel.replaces", { tool: r.other });
    case "member":
      return t("desktop.craft.canvas.cvF.rel.member", { group: r.other });
    default:
      return assertNever(r.kind, "cvF relationText");
  }
}

function Components(props: { readonly p: Plugin }): ReactNode {
  const { p } = props;
  const blocks: ReactElement[] = [];
  if (p.instructions.length > 0)
    blocks.push(
      <Row key="ins" k={t("desktop.craft.canvas.cvF.part.instructions")}>
        <span className="cvf-tags">
          {p.instructions.map((f) => (
            <span key={f} className="cvf-tag">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.skills.length > 0)
    blocks.push(
      <Row key="sk" k={t("desktop.craft.canvas.cvF.part.skills")}>
        <span className="cvf-tags">
          {p.skills.map((f) => (
            <span key={f} className="cvf-tag">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.memory.length > 0)
    blocks.push(
      <Row key="mem" k={t("desktop.craft.canvas.cvF.part.memory")}>
        <span className="cvf-tags">
          {p.memory.map((f) => (
            <span key={f} className="cvf-tag">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.mcp !== undefined)
    blocks.push(
      <Row key="mcp" k={t("desktop.craft.canvas.cvF.part.mcp", { server: p.mcp.server })}>
        <span className="cvf-tools">
          {p.mcp.tools.map((tool) => (
            <span key={tool.name} className="cvf-tool" data-writes={tool.writes}>
              {tool.name}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.ext.hooks.length > 0)
    blocks.push(
      <Row key="hooks" k={t("desktop.craft.canvas.cvF.part.hooks")}>
        <span className="flex flex-col gap-1">
          {p.ext.hooks.map((h) => (
            <span key={h.name} className="flex flex-wrap items-center gap-1.5">
              <Mono>{h.name}</Mono>
              <span className="cvf-tag">{h.fold}</span>
              {h.powers.map((w) => (
                <span key={w} className="text-[11.5px] text-text-tertiary">
                  {t(POWER_WORD[w])}
                </span>
              ))}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.steps !== undefined)
    blocks.push(
      <Row key="steps" k={t("desktop.craft.canvas.cvF.part.stages")}>
        <span className="cvf-steps">
          {p.steps.map((s, i) => (
            <span key={s.id} className="cvf-step-wrap">
              {i > 0 ? <span className="cvf-step-arrow" aria-hidden="true" /> : null}
              <span className="cvf-step">
                <span className="cvf-step-n">{i + 1}</span>
                {t(STAGE_WORD[s.id])}
                {s.parallel > 1 ? <span className="cvf-step-x">×{s.parallel}</span> : null}
              </span>
            </span>
          ))}
          {(p.handoffTo ?? []).map((to) => (
            <span key={to} className="cvf-step-wrap">
              <span className="cvf-step-arrow" aria-hidden="true" />
              <span className="cvf-step cvf-step-out">{to}</span>
            </span>
          ))}
        </span>
        {p.steps.some((s) => s.lanes !== undefined) ? (
          <span className="mt-1 block text-[11.5px] text-text-tertiary">
            {p.steps
              .flatMap((s) => s.lanes ?? [])
              .map((l) => t(LANE_WORD[l]))
              .join(" · ")}
          </span>
        ) : null}
      </Row>,
    );
  if (p.settings.length > 0)
    blocks.push(
      <Row key="set" k={t("desktop.craft.canvas.cvF.part.settings")}>
        <span className="cvf-settings">
          {p.settings.map((s) => (
            <span key={s.key} className="cvf-setting">
              <Mono>{s.key}</Mono>
              <Mono>{s.value}</Mono>
            </span>
          ))}
        </span>
      </Row>,
    );
  if (blocks.length === 0)
    return <p className="cvf-empty">{t("desktop.craft.canvas.cvF.part.none")}</p>;
  return <dl className="cvf-kvs">{blocks}</dl>;
}

export function PluginPanel(props: {
  readonly profile: Profile;
  readonly catalog: Catalog;
  readonly plugin: Plugin;
  readonly actions: PanelActions;
}): ReactElement {
  const { profile, catalog, plugin: p, actions } = props;
  const on = inProfile(profile, p.name);
  const source = sourceOf(profile, p.name);
  const order = spotOrder(profile, catalog, p.spot);
  const at = order.indexOf(p.name);
  const start = profile.startDrive === p.name;
  const rels = relationRows(profile, catalog, p.name);
  const ext = p.ext;
  const draft = ext.review.state !== "approved";
  const movable = on && source.kind === "profile" && p.guard !== true && !start;
  const head = (
    <div className="flex min-w-0 items-start gap-3">
      <KindTile kind={p.kind} size={34} draft={draft} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-[17px] font-semibold text-text-primary">
          {p.name}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-text-secondary">
          <span style={{ color: KIND_COLOR[p.kind] }} className="font-medium">
            {t(KIND_WORD[p.kind])}
          </span>
          <span className="text-text-tertiary">·</span>
          <span>{t(SPOT_WORD[p.spot])}</span>
          <span className="text-text-tertiary">·</span>
          <Mono>v{ext.version}</Mono>
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          <span className="cvf-chip" data-tone={draft ? "warning" : "plain"}>
            {t(REVIEW_WORD[ext.review.state])}
          </span>
          <span
            className="cvf-chip"
            data-tone={ext.health === "ok" ? "plain" : ext.health === "idle" ? "plain" : "danger"}
          >
            {t(HEALTH_WORD[ext.health])}
          </span>
          {start ? (
            <span className="cvf-chip" data-tone="kind" style={{ color: KIND_COLOR[p.kind] }}>
              {t("desktop.craft.canvas.cvF.startDrive")}
            </span>
          ) : null}
          {!on ? (
            <span className="cvf-chip">{t("desktop.craft.canvas.cvF.panel.notIn")}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
  const removeBlocked = source.kind === "base" || source.kind === "group";
  const foot = (
    <>
      <Button size="sm" variant="solid" onClick={() => actions.open(p.name)}>
        {t("desktop.craft.canvas.cvF.action.inside")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        iconStart={<Play aria-hidden />}
        onClick={() => actions.testRun(p.name)}
      >
        {t("desktop.craft.canvas.cvF.action.testRun")}
      </Button>
      <span className="ms-auto" />
      {on ? (
        source.kind === "group" ? (
          <Button size="sm" variant="ghost" onClick={() => actions.removeGroup(source.group)}>
            {t("desktop.craft.canvas.cvF.action.removeGroup", { name: source.group })}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={removeBlocked}
            onClick={() => actions.remove(p.name)}
          >
            {t("desktop.craft.canvas.cvF.action.removeShort")}
          </Button>
        )
      ) : (
        <Button size="sm" variant="soft" onClick={() => actions.add(p.name)}>
          {t("desktop.craft.canvas.cvF.action.addShort")}
        </Button>
      )}
    </>
  );
  let n = 0;
  return (
    <Shell
      label={t("desktop.craft.canvas.cvF.panel.label", { name: p.name })}
      head={head}
      foot={foot}
      onClose={() => {
        actions.close();
      }}
    >
      <p className="cvf-purpose-lg">{t(ext.purpose)}</p>
      <Section n={++n} title={t("desktop.craft.canvas.cvF.sec.where")}>
        <dl className="cvf-kvs">
          <Row k={t("desktop.craft.canvas.cvF.k.spot")}>{t(SPOT_WORD[p.spot])}</Row>
          {on && at >= 0 ? (
            <Row k={t("desktop.craft.canvas.cvF.k.order")}>
              <span className="flex items-center gap-1.5">
                <Mono>
                  {at + 1} / {order.length}
                </Mono>
                {movable ? (
                  <>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      label={t("desktop.craft.canvas.cvF.action.earlier")}
                      disabled={at === 0}
                      onClick={() => actions.move(p.name, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </IconButton>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      label={t("desktop.craft.canvas.cvF.action.later")}
                      disabled={at === order.length - 1}
                      onClick={() => actions.move(p.name, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </IconButton>
                  </>
                ) : (
                  <span className="text-[11.5px] text-text-tertiary">
                    {t(
                      source.kind === "base"
                        ? "desktop.craft.canvas.cvF.order.base"
                        : p.guard === true
                          ? "desktop.craft.canvas.cvF.order.guard"
                          : start
                            ? "desktop.craft.canvas.cvF.order.start"
                            : "desktop.craft.canvas.cvF.order.group",
                    )}
                  </span>
                )}
              </span>
            </Row>
          ) : null}
          {p.decision !== undefined ? (
            <Row k={t("desktop.craft.canvas.cvF.k.decision")}>
              <span className="flex items-center gap-1.5">
                <DecisionGlyph decision={p.decision} size={12} />
                {t(DECISION_WORD[p.decision])}
                {p.guard === true ? (
                  <span className="cvf-chip">{t("desktop.craft.canvas.cvF.guard")}</span>
                ) : null}
              </span>
            </Row>
          ) : null}
          <Row k={t("desktop.craft.canvas.cvF.k.enforcement")}>
            {t(ENFORCEMENT_WORD[ext.enforcement])}
          </Row>
          <Row k={t("desktop.craft.canvas.cvF.k.source")}>
            {!on ? (
              <span className="text-text-tertiary">
                {t("desktop.craft.canvas.cvF.panel.notIn")}
              </span>
            ) : source.kind === "base" ? (
              <span className="cvf-chip cvf-hatch">{t("desktop.craft.canvas.cvF.base")}</span>
            ) : source.kind === "group" ? (
              <button
                type="button"
                className="cvf-link"
                onClick={() => actions.focusZone(source.group)}
              >
                {t("desktop.craft.canvas.cvF.source.group", {
                  letter: zoneLetter(profile, source.group),
                  name: source.group,
                })}
              </button>
            ) : (
              t("desktop.craft.canvas.cvF.source.profile")
            )}
          </Row>
        </dl>
      </Section>
      <Section n={++n} title={t("desktop.craft.canvas.cvF.sec.parts")}>
        <Components p={p} />
      </Section>
      <Section
        n={++n}
        title={t("desktop.craft.canvas.cvF.sec.risk")}
        info={t("desktop.craft.canvas.cvF.risk.info")}
      >
        <RiskScale risk={p.risk} />
        <dl className="cvf-kvs mt-2">
          <Row k={t("desktop.craft.canvas.cvF.k.runs")}>
            {t(
              p.code ? "desktop.craft.canvas.cvF.runs.code" : "desktop.craft.canvas.cvF.runs.none",
            )}
          </Row>
          {p.code ? (
            <Row k={t("desktop.craft.canvas.cvF.k.isolated")}>
              {t(
                ext.isolated === true
                  ? "desktop.craft.canvas.cvF.isolated.yes"
                  : ext.isolated === false
                    ? "desktop.craft.canvas.cvF.isolated.no"
                    : "desktop.craft.canvas.cvF.isolated.unknown",
              )}
            </Row>
          ) : null}
          {p.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cvF.k.writes")}>
              <Mono>
                {p.mcp.tools.filter((x) => x.writes).length} / {p.mcp.tools.length}
              </Mono>
            </Row>
          ) : null}
        </dl>
      </Section>
      <Section
        n={++n}
        title={t("desktop.craft.canvas.cvF.sec.cost")}
        info={t("desktop.craft.canvas.cvF.cost.info")}
      >
        <div className="cvf-cost">
          <Cost k={t("desktop.craft.canvas.cvF.cost.always")} v={tokens(ext.cost.always)} />
          <Cost k={t("desktop.craft.canvas.cvF.cost.onDemand")} v={tokens(ext.cost.onDemand)} />
          {ext.cost.drive !== null ? (
            <Cost k={t("desktop.craft.canvas.cvF.cost.drive")} v={tokens(ext.cost.drive)} />
          ) : null}
          <Cost
            k={t("desktop.craft.canvas.cvF.cost.toolCount")}
            v={ext.cost.toolCount === null ? "—" : String(ext.cost.toolCount)}
          />
        </div>
      </Section>
      <Section n={++n} title={t("desktop.craft.canvas.cvF.sec.origin")}>
        <dl className="cvf-kvs">
          <Row k={t("desktop.craft.canvas.cvF.k.origin")}>{t(ORIGIN_WORD[ext.origin.kind])}</Row>
          <Row k={t("desktop.craft.canvas.cvF.k.version")}>
            <Mono>{ext.version}</Mono>
          </Row>
          <Row k={t("desktop.craft.canvas.cvF.k.hash")}>
            <Mono>{shortHash(ext.review.currentHash)}</Mono>
          </Row>
          <Row k={t("desktop.craft.canvas.cvF.k.review")}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t(REVIEW_WORD[ext.review.state])}
              {ext.review.approvedAt !== null ? <Mono>{day(ext.review.approvedAt)}</Mono> : null}
              {ext.review.pendingItemId !== null ? <Mono>{ext.review.pendingItemId}</Mono> : null}
            </span>
          </Row>
          {ext.origin.createdIn !== undefined ? (
            <Row k={t("desktop.craft.canvas.cvF.k.createdIn")}>
              <span className="flex flex-wrap items-center gap-1.5">
                {t("desktop.craft.canvas.cvF.createdIn")}
                <Mono>{ext.origin.createdIn.threadId}</Mono>
              </span>
            </Row>
          ) : null}
        </dl>
      </Section>
      <Section
        n={++n}
        title={t("desktop.craft.canvas.cvF.sec.relations")}
        info={t("desktop.craft.canvas.cvF.rel.info")}
      >
        {rels.length === 0 ? (
          <p className="cvf-empty">{t("desktop.craft.canvas.cvF.rel.none")}</p>
        ) : (
          <ul className="cvf-rels">
            {rels.map((r) => (
              <li
                key={`${r.kind}:${r.other}:${r.via ?? ""}`}
                className="cvf-rel-row"
                data-present={r.present}
              >
                <RelationSymbol kind={r.kind} />
                {r.kind === "member" ? (
                  <button
                    type="button"
                    className="cvf-link"
                    onClick={() => actions.focusZone(r.other)}
                  >
                    {relationText(r)}
                  </button>
                ) : r.kind !== "replaces" &&
                  !r.engine &&
                  r.present &&
                  inProfile(profile, r.other) ? (
                  <button type="button" className="cvf-link" onClick={() => actions.focus(r.other)}>
                    {relationText(r)}
                  </button>
                ) : (
                  <span>{relationText(r)}</span>
                )}
                {!r.present ? (
                  <span className="cvf-chip">{t("desktop.craft.canvas.cvF.panel.notIn")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section n={++n} title={t("desktop.craft.canvas.cvF.sec.recent")}>
        <dl className="cvf-kvs">
          <Row k={t("desktop.craft.canvas.cvF.k.lastUsed")}>{agoText(p.lastUsedMin)}</Row>
          <Row k={t("desktop.craft.canvas.cvF.k.health")}>{t(HEALTH_WORD[ext.health])}</Row>
        </dl>
      </Section>
    </Shell>
  );
}

function Cost(props: { readonly k: string; readonly v: string }): ReactElement {
  return (
    <div className="cvf-cost-cell">
      <span className="cvf-cost-k">{props.k}</span>
      <span className="cvf-cost-v">{props.v}</span>
    </div>
  );
}

export function ZonePanel(props: {
  readonly profile: Profile;
  readonly catalog: Catalog;
  readonly group: Group;
  readonly collapsed: boolean;
  readonly actions: PanelActions;
}): ReactElement {
  const { profile, catalog, group, actions } = props;
  const on = groupIn(profile, group);
  const gx = groupExtOf(group.id);
  const letter = zoneLetter(profile, group.id);
  const head = (
    <div className="flex min-w-0 items-start gap-3">
      <span className="cvf-zone-letter cvf-zone-letter-lg" aria-hidden="true">
        {letter}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-[17px] font-semibold text-text-primary">
          {group.id}
        </span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
          {t("desktop.craft.canvas.cvF.zone.word")}
          <span className="text-text-tertiary">·</span>
          {t("desktop.craft.canvas.cvF.zone.closedMeta", { n: group.members.length })}
          <span className="text-text-tertiary">·</span>
          <Mono>v{gx.version}</Mono>
        </span>
        {!on ? (
          <span className="mt-1">
            <span className="cvf-chip">{t("desktop.craft.canvas.cvF.panel.notIn")}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
  const foot = (
    <>
      {on ? (
        <Button size="sm" variant="outline" onClick={() => actions.toggleZone(group.id)}>
          {t(
            props.collapsed
              ? "desktop.craft.canvas.cvF.zone.expandShort"
              : "desktop.craft.canvas.cvF.zone.collapseShort",
          )}
        </Button>
      ) : null}
      <span className="ms-auto" />
      {on ? (
        <Button size="sm" variant="ghost" onClick={() => actions.removeGroup(group.id)}>
          {t("desktop.craft.canvas.cvF.action.removeGroup", { name: group.id })}
        </Button>
      ) : (
        <Button size="sm" variant="soft" onClick={() => actions.addGroup(group.id)}>
          {t("desktop.craft.canvas.cvF.action.addGroup", { name: group.id })}
        </Button>
      )}
    </>
  );
  return (
    <Shell
      label={t("desktop.craft.canvas.cvF.panel.label", { name: group.id })}
      head={head}
      foot={foot}
      onClose={() => {
        actions.close();
      }}
    >
      <p className="cvf-purpose-lg">{t(gx.purpose)}</p>
      <Section
        n={1}
        title={t("desktop.craft.canvas.cvF.sec.members")}
        info={t("desktop.craft.canvas.cvF.zone.info")}
      >
        <ol className="cvf-members">
          {group.members.map((m, i) => {
            const p = catalog.get(m);
            if (p === undefined) return null;
            return (
              <li key={m} className="cvf-member">
                <span className="cvf-ref-mark">
                  {letter}
                  {i + 1}
                </span>
                <KindGlyph kind={p.kind} size={14} />
                <button
                  type="button"
                  className="cvf-link min-w-0 flex-1 truncate text-left font-mono"
                  onClick={() => actions.focus(m)}
                  disabled={!on}
                >
                  {m}
                </button>
                <span className="truncate text-[11.5px] text-text-tertiary">
                  {t(SPOT_WORD[p.spot])}
                </span>
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.craft.canvas.cvF.action.earlier")}
                  disabled={i === 0}
                  onClick={() => actions.moveInGroup(group.id, m, -1)}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.craft.canvas.cvF.action.later")}
                  disabled={i === group.members.length - 1}
                  onClick={() => actions.moveInGroup(group.id, m, 1)}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section n={2} title={t("desktop.craft.canvas.cvF.sec.zoneRules")}>
        <ul className="cvf-notes">
          <li>{t("desktop.craft.canvas.cvF.zone.rule.together")}</li>
          <li>{t("desktop.craft.canvas.cvF.zone.rule.refs")}</li>
          <li>{t("desktop.craft.canvas.cvF.zone.rule.closed")}</li>
          <li>{t("desktop.craft.canvas.cvF.zone.rule.nest")}</li>
        </ul>
      </Section>
    </Shell>
  );
}
