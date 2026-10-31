// 층 세계: 층 여섯을 위(L3)에서 아래(F)로 쌓은 띠. 띠마다 내장 타일, 내 것 타일(층 색 고리), "더하기" 자리.
// 왼쪽 열은 평소엔 층 설명(이 층이 해 주는 일 · 내장/내 것 수 · 붙는 방식), 포커스면 관계 렌즈(층마다 관계 줄 → 캔버스 대상 선).
// 렌즈 줄을 그 층 띠와 같은 높이에 두어 선이 짧고 수평이다(SPEC §3 포커스 규칙).
import { Button, IconButton } from "@caustic/react";
import type { ReactNode } from "react";
import { ArrowRight, Play, X as XIcon } from "../../_shell";
import {
  CONTRACTS,
  DECLARED,
  HOOKS,
  LAYERS,
  OPS,
  PRESET_DIFF,
  STAGES,
  THREAD_ON,
  THREAD_PENDING,
  layerById,
  pluginById,
  pluginsOf,
  stageOf,
  type LayerId,
  type Plugin,
  type Relation,
  relationsOf,
  type StageId,
} from "../data";
import {
  AddSlot,
  Face,
  FoldGlyph,
  ICON,
  LayerCode,
  Mine,
  Tile,
  ink,
  plate,
  type TileLook,
} from "../parts/kit";
import { useMock } from "../store";

export interface Band {
  id: LayerId;
  y: number;
  h: number;
  tw: number;
  th: number;
  dense?: boolean;
}
const BAND_SPEC: Omit<Band, "y">[] = [
  { id: "L3", h: 96, tw: 126, th: 60 },
  { id: "L2", h: 90, tw: 108, th: 56 },
  { id: "L1", h: 80, tw: 86, th: 50, dense: true },
  { id: "L0", h: 74, tw: 96, th: 48, dense: true },
  { id: "X", h: 180, tw: 140, th: 48 },
  { id: "F", h: 72, tw: 0, th: 30 },
];
const GAP = 8;
/** 렌즈 줄 높이와 차선 간격 */
const ROW_H = 18;
const ROW_TOP = 30;
const LANE = 5;
export const BAND_W = 840;

/** 층 띠 높이: 포커스면 렌즈 줄과 차선이 들어가게 늘린다(타일은 띠 아래쪽에 붙고 위에 차선이 생긴다). */
export function bandsFor(rel: Relation[]): Band[] {
  let y = 0;
  return BAND_SPEC.map((b) => {
    const n = rel.filter((r) => r.layer === b.id).length;
    let h = b.h;
    if (n > 0) {
      const rows = ROW_TOP + n * ROW_H + 6;
      const lanes =
        b.id === "X" ? 0 : b.id === "F" ? 20 + n * LANE + b.th + 10 : 18 + n * LANE + b.th + 10;
      h = Math.max(b.h, rows, lanes, b.id === "X" ? 98 + n * LANE + 74 : 0);
    }
    const r = { ...b, y, h };
    y += h + GAP;
    return r;
  });
}
export const worldH = (bands: Band[]) => {
  const last = bands[bands.length - 1];
  return last === undefined ? 0 : last.y + last.h;
};
const bandIn = (bands: Band[], l: LayerId): Band => {
  const b = bands.find((x) => x.id === l);
  if (b === undefined) throw new Error(`층 띠 없음: ${l}`);
  return b;
};
/** 띠 안 타일 위쪽: 평소엔 가운데, 늘어난 띠에선 아래쪽에 붙인다. */
const tileTop = (b: Band) => {
  const spec = BAND_SPEC.find((x) => x.id === b.id);
  const pad = spec === undefined ? 10 : (spec.h - spec.th) / 2 - 4;
  return b.y + b.h - b.th - pad;
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 자동 배치(결정 4): 층마다 왼쪽부터, 내장 → 내 것 → 더하기 자리 순. */
export function layout(bx: number, bands: Band[]) {
  const tiles: Record<string, Box> = {};
  const adds: Record<string, Box> = {};
  for (const b of bands) {
    if (b.id === "X" || b.id === "F") continue;
    const ps = [...pluginsOf(b.id)].sort(
      (a, c) => Number(a.origin !== "builtin") - Number(c.origin !== "builtin"),
    );
    let x = bx + 12;
    const y = tileTop(b);
    for (const p of ps) {
      tiles[p.id] = { x, y, w: b.tw, h: b.th };
      x += b.tw + GAP;
    }
    adds[b.id] = { x, y, w: 70, h: b.th };
  }
  // X: 위 줄 = 네 연산 묶음 + 외부 훅 + 더하기, 아래 = 턴 흐름 길
  const xb = bandIn(bands, "X");
  const hooks = pluginsOf("X");
  let x = bx + 12 + 300 + GAP;
  for (const p of hooks) {
    tiles[p.id] = { x, y: xb.y + 14, w: xb.tw, h: xb.th };
    x += xb.tw + GAP;
  }
  adds["X"] = { x, y: xb.y + 14, w: 70, h: xb.th };
  const stages: Record<string, { x: number; y: number }> = {};
  const span = BAND_W - 96;
  STAGES.forEach((s, i) => {
    stages[s.id] = { x: bx + 48 + (span * i) / (STAGES.length - 1), y: xb.y + xb.h - 74 };
  });
  // F: 규약 칩 다섯 + 선언 칩 셋
  const fb = bandIn(bands, "F");
  const fy = fb.y + fb.h - fb.th - 21;
  const contracts: Record<string, Box> = {};
  let fx = bx + 12;
  for (const c of CONTRACTS) {
    const w = c.label.length * 11 + 28;
    contracts[c.id] = { x: fx, y: fy, w, h: fb.th };
    fx += w + 6;
  }
  fx += 18;
  const declared: Record<string, Box> = {};
  for (const d of DECLARED) {
    const w = d.id.length * 6.6 + 30;
    declared[d.id] = { x: fx, y: fy, w, h: fb.th };
    fx += w + 6;
  }
  return { tiles, adds, stages, contracts, declared, bands };
}

export type WorldMode = "normal" | "focus" | "thread" | "preview" | "failure" | "add";

/** 대상 키 → 선이 닿을 점(위 가장자리 가운데)과 선이 다닐 차선 y */
function anchorOf(target: string, L: ReturnType<typeof layout>): { x: number; y: number } | null {
  if (target.startsWith("stage:")) {
    const s = L.stages[target.slice(6)];
    return s ? { x: s.x, y: s.y - 15 } : null;
  }
  if (target.startsWith("contract:")) {
    const c = L.contracts[target.slice(9)];
    return c ? { x: c.x + c.w / 2, y: c.y } : null;
  }
  const t = L.tiles[target];
  return t ? { x: t.x + t.w / 2, y: t.y } : null;
}

/** 렌즈 줄 좌표: 층마다 대상이 오른쪽인 것부터 위에 둔다. 그러면 줄 → 차선 → 대상 선이 서로 엇갈리지 않는다(SPEC §3.3). */
type LayoutT = ReturnType<typeof layout>;
function lensRows(rel: Relation[], L: LayoutT) {
  const out: { r: Relation; y: number; i: number; n: number }[] = [];
  for (const b of L.bands) {
    const rows = rel
      .filter((r) => r.layer === b.id)
      .map((r) => ({ r, x: anchorOf(r.target, L)?.x ?? 0 }))
      .sort((p, q) => q.x - p.x);
    rows.forEach(({ r }, i) =>
      out.push({ r, y: b.y + ROW_TOP + 8 + i * ROW_H, i, n: rows.length }),
    );
  }
  return out;
}

export function LayerWorld({
  mode,
  col,
  focusId,
}: {
  mode: WorldMode;
  /** 왼쪽 열 폭(0이면 없음) */
  col: number;
  focusId?: string | null;
}) {
  const m = useMock();
  const bx = col > 0 ? col + 12 : 0;
  const W = bx + BAND_W;
  const rel = mode === "focus" && focusId ? relationsOf(focusId) : [];
  const bands = bandsFor(rel);
  const H = worldH(bands);
  const L = layout(bx, bands);
  const related = new Set(rel.map((r) => r.target));
  const rows = lensRows(rel, L);

  const lookOf = (p: Plugin): TileLook => {
    if (mode === "focus") return p.id === focusId ? "focus" : related.has(p.id) ? "related" : "dim";
    if (mode === "thread" || mode === "preview") {
      if (THREAD_ON.has(p.id)) return "normal";
      return "off";
    }
    if (mode === "add") return p.layer === "L1" ? "normal" : "dim";
    return "normal";
  };
  const metaOf = (p: Plugin): ReactNode | undefined => {
    if (mode === "thread" || mode === "preview") {
      if (p.id === "helm")
        return (
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-ui-xs text-text-primary [&_svg]:size-2.5">
            <Play />
            진행 · 턴 2/4
          </span>
        );
      if (THREAD_PENDING.has(p.id))
        return (
          <span className="min-w-0 flex-1 truncate text-ui-xs text-text-secondary">
            이번 단계 끝나면 켜져요
          </span>
        );
      if (!THREAD_ON.has(p.id))
        return (
          <span className="min-w-0 flex-1 truncate text-ui-xs text-text-tertiary">
            이 대화에서 꺼짐
          </span>
        );
    }
    if (
      mode === "failure" &&
      (p.health === "auto_off" || p.health === "failing" || p.id === "hook:secret-scan")
    )
      return (
        <span
          className={`min-w-0 flex-1 truncate text-ui-xs ${p.health === "auto_off" ? "text-text-primary" : "text-text-secondary"}`}
        >
          {p.health === "auto_off"
            ? `자동 꺼짐 · 연속 ${p.failures}번`
            : p.id === "hook:secret-scan"
              ? "출력 위반 3 · 열린 채"
              : `실패 ${p.failures} · 예외 → 통과`}
        </span>
      );
    if (p.layer === "L0" && p.replaces)
      return (
        <span className="min-w-0 flex-1 truncate text-ui-xs text-text-tertiary">exec 대신</span>
      );
    return undefined;
  };

  const tileFor = (p: Plugin) => {
    const b = L.tiles[p.id];
    if (b === undefined) return null;
    const band = bandIn(bands, p.layer);
    const diff = mode === "preview" ? PRESET_DIFF[p.id] : undefined;
    const failing = mode === "failure" && p.id === "hook:secret-scan";
    return (
      <Tile
        key={p.id}
        p={failing ? { ...p, health: "failing" } : p}
        w={b.w}
        h={b.h}
        dense={band.dense === true}
        look={lookOf(p)}
        meta={metaOf(p)}
        onClick={() => m.set({ focus: m.focus === p.id ? null : p.id })}
        style={{
          left: b.x,
          top: b.y,
          ...(THREAD_PENDING.has(p.id) && (mode === "thread" || mode === "preview")
            ? {
                boxShadow: "none",
                outline: "1.25px dashed var(--edge-strong)",
                outlineOffset: -1,
                background: "transparent",
              }
            : {}),
          ...(diff
            ? {
                outline: `1.5px dashed ${diff.mark === "add" ? "var(--cs-color-diff-add-text)" : diff.mark === "remove" ? "var(--cs-color-diff-remove-text)" : "var(--cs-color-agent-text)"}`,
                outlineOffset: 3,
              }
            : {}),
        }}
        mark={diff ? <DiffBadge mark={diff.mark} /> : undefined}
      />
    );
  };

  return (
    <div className="absolute inset-0" style={{ width: W, height: H }}>
      {/* 층 바닥판 */}
      {bands.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-xl"
          style={{
            left: bx,
            top: b.y,
            width: BAND_W,
            height: b.h,
            background: plate(b.id),
            opacity:
              mode === "focus" && !(b.id === "L3" || rel.some((r) => r.layer === b.id)) ? 0.5 : 1,
            outline: mode === "add" && b.id === "L1" ? `1.5px solid ${ink("L1")}` : undefined,
          }}
        />
      ))}

      {/* 왼쪽 열 */}
      {col > 0 &&
        mode !== "focus" &&
        bands.map((b) => <LayerLabel key={b.id} band={b} col={col} />)}
      {col > 0 && mode === "focus" && <LensColumn bands={bands} col={col} rows={rows} />}

      {/* X 띠: 네 연산 묶음, 턴 흐름 길 */}
      <XBand bx={bx} L={L} mode={mode} rel={rel} />
      {/* F 띠: 규약 + 선언 */}
      <FBand L={L} mode={mode} rel={rel} />

      {/* 렌즈 선(타일 아래) */}
      {rows.length > 0 && (
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={W}
          height={H}
          aria-hidden
        >
          {rows.map(({ r, y, i }) => {
            const a = anchorOf(r.target, L);
            if (a === null) return null;
            const band = bandIn(bands, r.layer);
            // 차선: X는 훅 줄과 단계 핀 사이, 나머지는 띠 위 여백
            const lane = r.layer === "X" ? band.y + 72 + i * LANE : band.y + 10 + i * LANE;
            const sx = col - 2;
            const k = 10;
            const d = `M${sx},${y} C${sx + 12},${y} ${bx - 8},${lane} ${bx + 6},${lane} L${a.x - k},${lane} Q${a.x},${lane} ${a.x},${lane + k} L${a.x},${a.y}`;
            return (
              <g key={r.target + r.label}>
                <path
                  d={d}
                  fill="none"
                  stroke="var(--cs-color-bg-app)"
                  strokeWidth={3.5}
                  opacity={0.9}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={ink(r.layer)}
                  strokeWidth={1.4}
                  strokeDasharray={r.missing ? "3 3" : undefined}
                />
                <circle cx={a.x} cy={a.y} r={2.6} fill={ink(r.layer)} />
              </g>
            );
          })}
        </svg>
      )}

      {/* 타일 */}
      {(["L3", "L2", "L1", "L0"] as LayerId[]).flatMap((l) => pluginsOf(l)).map(tileFor)}
      {pluginsOf("X").map(tileFor)}

      {/* 더하기 자리 */}
      {(["L3", "L2", "L1", "L0", "X"] as LayerId[]).map((l) => {
        const a = L.adds[l]!;
        const layer = LAYERS.find((x) => x.id === l)!;
        const isAdd = mode === "add" && l === "L1";
        return (
          <AddSlot
            key={l}
            w={a.w}
            h={a.h}
            label={isAdd ? "여기에 놓여요" : layer.addNoun}
            name={`${layer.name}에 ${layer.addNoun} 더하기`}
            pulse={isAdd}
            onClick={() =>
              l === "L1"
                ? m.set({ overlay: "add-l1" })
                : m.notify(`${layer.name}에 ${layer.addNoun} 더하기`)
            }
            style={{
              left: a.x,
              top: a.y,
              opacity: mode === "focus" || (mode === "add" && !isAdd) ? 0.3 : 1,
              ...(isAdd
                ? { ["--ring" as string]: ink("L1"), borderColor: ink("L1"), color: ink("L1") }
                : {}),
            }}
          />
        );
      })}

      {/* 대화 맥락 테두리: 이 대화의 런타임 전체를 감싼다 */}
      {(mode === "thread" || mode === "preview") && (
        <div
          className="pointer-events-none absolute rounded-2xl"
          style={{
            left: bx - 6,
            top: -6,
            width: BAND_W + 12,
            height: H + 12,
            boxShadow: `0 0 0 1.5px var(--cs-color-accent-solid)`,
          }}
        />
      )}
    </div>
  );
}

function DiffBadge({ mark }: { mark: "add" | "remove" | "override" }) {
  const cls =
    mark === "add"
      ? "bg-diff-add-bg text-diff-add-text"
      : mark === "remove"
        ? "bg-diff-remove-bg text-diff-remove-text"
        : "bg-agent-soft text-agent-text";
  return (
    <span
      className={`absolute -left-2 -top-2 grid size-5 place-items-center rounded-full font-mono text-mono-strong shadow-1 ${cls}`}
    >
      {mark === "add" ? "+" : mark === "remove" ? "−" : "~"}
    </span>
  );
}

function LayerLabel({ band, col }: { band: Band; col: number }) {
  const l = LAYERS.find((x) => x.id === band.id)!;
  const ps = pluginsOf(band.id);
  const mine = ps.filter((p) => p.origin !== "builtin").length;
  const builtin =
    band.id === "X" ? OPS.length : band.id === "F" ? CONTRACTS.length : ps.length - mine;
  const narrow = col < 160;
  return (
    <div
      className="absolute grid content-start gap-0.5"
      style={{ left: 0, top: band.y + 8, width: col }}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <LayerCode l={band.id} />
        <span className="truncate text-ui-sm text-text-primary">{l.name}</span>
      </div>
      {!narrow && (
        <>
          <span className="truncate text-ui-xs text-text-secondary">{l.does}</span>
          <span className="truncate text-ui-xs tabular-nums text-text-tertiary">
            내장 {builtin}
            {band.id === "F" ? ` · 플러그인 선언 ${DECLARED.length}` : ` · 내 것 ${mine}`} · {l.how}
          </span>
        </>
      )}
    </div>
  );
}

/** 관계 렌즈 열: 층마다 "무엇을 어떻게" 한 줄씩. 사람 말 먼저, 기계 이름은 오른쪽 mono. 줄 끝 점에서 선이 캔버스 대상으로 간다. */
function LensColumn({
  bands,
  col,
  rows,
}: {
  bands: Band[];
  col: number;
  rows: { r: Relation; y: number; i: number }[];
}) {
  return (
    <>
      {bands.map((b) => {
        const mine = rows.filter((x) => x.r.layer === b.id);
        if (mine.length === 0) return null;
        const kinds = [...new Set(mine.map((x) => x.r.kind))].map((k) => KIND_LABEL[k]).join(" · ");
        return (
          <div
            key={b.id}
            className="absolute flex min-w-0 items-baseline gap-1.5"
            style={{ left: 0, top: b.y + 7, width: col }}
          >
            <LayerCode l={b.id} />
            <span className="truncate text-ui-xs font-medium text-text-primary">
              {layerById(b.id).name}
            </span>
            <span className="truncate text-ui-xs text-text-tertiary">{kinds}</span>
          </div>
        );
      })}
      {rows.map(({ r, y }) => (
        <div
          key={r.target + r.label}
          className="absolute flex h-4 min-w-0 items-center gap-1.5 pe-2"
          style={{ left: 0, top: y - 8, width: col }}
        >
          <span
            className="w-3 flex-none text-center font-mono text-mono-sm text-text-tertiary"
            title={KIND_LABEL[r.kind]}
          >
            {r.kind === "consumedBy"
              ? "←"
              : r.kind === "hooks"
                ? "⤳"
                : r.kind === "implements"
                  ? "◇"
                  : "→"}
          </span>
          <span className="min-w-0 truncate text-ui-xs text-text-primary">{r.label}</span>
          <span className="flex-1" />
          {r.id && (
            <span
              title={r.id}
              className="min-w-0 flex-none truncate font-mono text-mono-sm text-text-tertiary"
            >
              {r.layer === "X" && r.target.startsWith("stage:")
                ? r.id.replace(/^[a-z]+\./, "")
                : r.id}
            </span>
          )}
          <span className="size-1.5 flex-none rounded-full" style={{ background: ink(r.layer) }} />
        </div>
      ))}
    </>
  );
}

const KIND_LABEL: Record<Relation["kind"], string> = {
  uses: "가져다 씀",
  hooks: "끼어듦",
  implements: "지킴·선언",
  consumedBy: "나를 씀",
};

/** 포커스 머리 띠(캔버스 밖, 실제 크기): 고른 플러그인 · 관계 수 · 읽는 법 · 상세로. */
export function FocusBar({ focusId }: { focusId: string }) {
  const m = useMock();
  const p = pluginById(focusId);
  const rel = relationsOf(focusId);
  const layers = new Set(rel.map((r) => r.layer)).size;
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-raised px-2.5 py-1.5 shadow-1">
      <span className="flex min-w-0 items-center gap-2">
        <Face l={p.layer} icon={ICON[p.icon]} size={24} />
        <span className="text-ui-strong text-text-primary">{p.name}</span>
        <span className="font-mono text-mono-sm text-text-tertiary">{p.id}</span>
        {p.origin !== "builtin" && <Mine origin={p.origin === "project" ? "project" : "user"} />}
      </span>
      <span className="text-ui-xs text-text-secondary">
        관계 {rel.length} · 층 {layers}개에 걸쳐요
      </span>
      <span className="flex items-center gap-2.5 text-ui-xs text-text-tertiary">
        <span>→ 가져다 씀</span>
        <span>← 나를 씀</span>
        <span>⤳ 끼어듦</span>
        <span>◇ 지킴</span>
        <span className="flex items-center gap-1">
          <svg width="16" height="4" aria-hidden>
            <path d="M0 2 H16" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 3" />
          </svg>
          없으면 건너뜀
        </span>
      </span>
      <span className="flex-1" />
      <Button
        size="xs"
        variant="soft"
        onClick={() =>
          m.set({
            screen: "detail",
            detail: focusId === "cost-router" ? "cost-router" : "helm",
            focus: null,
          })
        }
      >
        구성과 흐름 보기
        <ArrowRight />
      </Button>
      <IconButton
        size="xs"
        variant="ghost"
        label="포커스 끄기"
        onClick={() => m.set({ focus: null })}
      >
        <XIcon />
      </IconButton>
    </div>
  );
}

function XBand({
  bx,
  L,
  mode,
  rel,
}: {
  bx: number;
  L: ReturnType<typeof layout>;
  mode: WorldMode;
  rel: Relation[];
}) {
  const m = useMock();
  const xb = bandIn(L.bands, "X");
  const relStages = new Set(
    rel.filter((r) => r.target.startsWith("stage:")).map((r) => r.target.slice(6)),
  );
  const dimAll = mode === "focus" || mode === "add";
  const first = STAGES[0]!.id;
  const last = STAGES[STAGES.length - 1]!.id;
  const y = L.stages[first]!.y;
  return (
    <>
      {/* 네 연산(확장 연결부의 내장 블록) */}
      <div
        className="absolute flex items-stretch gap-1 rounded-lg p-1"
        style={{
          left: bx + 12,
          top: xb.y + 14,
          width: 300,
          height: 48,
          background: "var(--cs-color-surface-raised)",
          boxShadow: "inset 0 0 0 1px var(--edge), var(--lift)",
          opacity: dimAll ? (mode === "focus" ? 0.55 : 0.32) : 1,
        }}
      >
        {OPS.map((o) => (
          <div
            key={o.id}
            className="grid min-w-0 flex-1 content-center rounded-md px-1.5"
            style={{ background: "var(--tint-X)" }}
          >
            <span className="truncate text-ui-xs font-medium text-text-primary">{o.label}</span>
            <span className="truncate font-mono text-mono-sm" style={{ color: "var(--ink-X)" }}>
              {o.id}
            </span>
          </div>
        ))}
      </div>
      {/* 턴 흐름 길 */}
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={bx + BAND_W}
        height={xb.y + xb.h}
        aria-hidden
      >
        <defs>
          <linearGradient id="trackg" x1="0" x2="1">
            <stop offset="0" stopColor="var(--h-L3)" stopOpacity="0.5" />
            <stop offset="0.5" stopColor="var(--h-X)" stopOpacity="0.8" />
            <stop offset="1" stopColor="var(--h-L2)" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <path
          d={`M${L.stages[first]!.x - 26},${y} L${L.stages[last]!.x + 26},${y}`}
          stroke="url(#trackg)"
          strokeWidth="2"
          fill="none"
          opacity={dimAll ? 0.5 : 1}
        />
      </svg>
      <span
        className="absolute text-ui-xs text-text-tertiary"
        style={{ left: L.stages[first]!.x - 20, top: y + 50, width: 400 }}
      >
        왼쪽에서 오른쪽으로 한 턴 · 끝나면 다음 턴으로 · 켜고 끈 것은 단계가 끝나면 적용
      </span>
      {STAGES.map((s) => {
        const p = L.stages[s.id]!;
        const hooks = HOOKS.filter((h) => stageOf(h.point) === s.id);
        const lit = relStages.has(s.id);
        const fail =
          mode === "failure" &&
          hooks.some((h) => h.plugin === "hook:secret-scan" || (h.fails ?? 0) > 0);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => m.set({ screen: "overview", stage: s.id as StageId })}
            className="absolute grid -translate-x-1/2 justify-items-center outline-none"
            style={{ left: p.x, top: p.y - 30, opacity: dimAll && !lit ? 0.45 : 1 }}
            aria-label={`${s.label} 단계 · 훅 ${hooks.length}`}
          >
            <span className="flex h-3 items-end gap-0.5">
              {hooks.map((h, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full"
                  style={{
                    height: 9,
                    background: ink(pluginById(h.plugin).layer),
                    opacity: mode === "focus" ? (h.plugin === "helm" ? 1 : 0.25) : 1,
                  }}
                />
              ))}
            </span>
            <span
              className="mt-1.5 grid size-6 place-items-center rounded-md"
              style={{
                background: "var(--cs-color-surface-raised)",
                boxShadow: lit
                  ? `0 0 0 1.5px ${ink("X")}, var(--lift)`
                  : fail
                    ? "0 0 0 1.5px var(--cs-color-danger-solid), var(--lift)"
                    : "inset 0 0 0 1px var(--edge), var(--lift)",
              }}
            >
              <FoldGlyph
                fold={hooks[0]?.fold ?? "tap"}
                color={hooks.length ? "var(--ink-X)" : "var(--edge-strong)"}
              />
            </span>
            <span className="mt-1 text-ui-xs text-text-primary">{s.label}</span>
            <span className="whitespace-nowrap font-mono text-mono-sm text-text-tertiary">
              {s.id}
            </span>
          </button>
        );
      })}
    </>
  );
}

function FBand({
  L,
  mode,
  rel,
}: {
  L: ReturnType<typeof layout>;
  mode: WorldMode;
  rel: Relation[];
}) {
  const relC = new Set(
    rel.filter((r) => r.target.startsWith("contract:")).map((r) => r.target.slice(9)),
  );
  const dim = mode === "focus" || mode === "add";
  const firstDecl = L.declared[DECLARED[0]!.id]!;
  return (
    <>
      {CONTRACTS.map((c) => {
        const b = L.contracts[c.id]!;
        const lit = relC.has(c.id);
        return (
          <div
            key={c.id}
            className="absolute flex items-center gap-1 rounded-md px-2"
            style={{
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              background: "var(--cs-color-surface-raised)",
              boxShadow: lit
                ? `0 0 0 1.5px var(--ink-F), var(--lift)`
                : "inset 0 0 0 1px var(--edge)",
              opacity: dim && !lit ? 0.4 : 1,
            }}
          >
            <span className="truncate text-ui-xs text-text-primary">{c.label}</span>
          </div>
        );
      })}
      <span
        className="absolute text-ui-xs text-text-tertiary"
        style={{ left: firstDecl.x, top: firstDecl.y - 17, opacity: dim ? 0.4 : 1 }}
      >
        플러그인이 선언한 것 · 접두로 나뉘어요
      </span>
      {(() => {
        const last = L.declared[DECLARED[DECLARED.length - 1]?.id ?? ""];
        if (last === undefined) return null;
        return (
          <span
            className="absolute flex items-center whitespace-nowrap rounded-md px-2 text-ui-xs text-text-tertiary"
            style={{
              left: last.x + last.w + 10,
              top: last.y,
              height: last.h,
              opacity: dim ? 0.4 : 1,
            }}
            title="공통 규약은 앱과 함께 바뀌어요. 플러그인은 자기 접두(x.<id>.*, ext.<id>.*)로 이름을 선언해 더해요."
          >
            직접 더하지 않아요
          </span>
        );
      })()}
      {DECLARED.map((d) => {
        const b = L.declared[d.id]!;
        const p = pluginById(d.by);
        return (
          <div
            key={d.id}
            title={`${d.kind} · ${p.name}이 선언`}
            className="absolute flex items-center gap-1 rounded-md px-1.5"
            style={{
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              border: "1.25px dashed var(--edge-strong)",
              opacity: dim ? 0.4 : 1,
            }}
          >
            <span
              className="size-1.5 flex-none rounded-full"
              style={{ background: ink(p.layer) }}
            />
            <span className="truncate font-mono text-mono-sm text-text-secondary">{d.id}</span>
          </div>
        );
      })}
    </>
  );
}

export { Mine };
