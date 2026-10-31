// 구성기 "부품": Helm을 부품으로 펼친다(매니페스트 composition / defineGroup({ slots }) 선언, 사용자 결정 7). 지도 상세와 같은 세 열:
// 왼쪽 루프 소켓 · 가운데 부품 판을 group-kit 등뼈에 쌓은 탑 · 오른쪽 능력을 내주는 서비스와 부품이 내는 것(기록·post·상태).
import {
  FileText,
  History,
  Lightbulb,
  Lock,
  RotateCw,
  Shield,
  Sparkles,
  Target,
} from "../../_shell";
import { HELM_PARTS, SOCKETS, type Op } from "../data";
import { EXT_ICON } from "../parts/block";
import { FoldGlyph, HueTile, Mark, orthH } from "../parts/kit";

export const CW = { w: 1040, h: 620 };
const PX = 392;
const PW = 316;
const PY = (i: number) => 120 + i * 68;
const PH = 56;
const SY = (i: number) => 120 + i * 66;

const ICON: Record<string, React.ReactNode> = {
  signal: <Target />,
  lens: <Sparkles />,
  guard: <Shield />,
  restore: <History />,
  drive: <RotateCw />,
  consume: <Lightbulb />,
  record: <FileText />,
};
const OP: Record<Op, string> = { on: "on", drive: "drive", post: "post", record: "기록" };

const SVCS = [
  {
    id: "agents",
    label: "에이전트",
    cap: "loop.spawn",
    hue: "base" as const,
    y: 388,
    need: "requires" as const,
    from: "drive",
  },
  {
    id: "web-exa",
    label: "Exa 검색",
    cap: "web.search",
    hue: "l2" as const,
    y: 444,
    need: "optional" as const,
    from: "consume",
  },
  {
    id: "knowledge",
    label: "지식",
    cap: "knowledge × 3",
    hue: "l2" as const,
    y: 500,
    need: "optional" as const,
    from: "consume",
  },
  {
    id: "work",
    label: "작업",
    cap: "work.tasks",
    hue: "l2" as const,
    y: 556,
    need: "optional" as const,
    from: "record",
  },
];

export function ComposeParts() {
  const partIdx = (id: string) => HELM_PARTS.findIndex((p) => p.id === id);
  const sockIdx = (p: string) => SOCKETS.findIndex((s) => s.point === p);
  const used = new Set(HELM_PARTS.flatMap((p) => p.points ?? []));
  const wires: { d: string; color: string; dashed?: boolean }[] = [];
  let lane = 0;
  HELM_PARTS.forEach((p, pi) => {
    (p.points ?? []).forEach((pt, k) => {
      const si = sockIdx(pt);
      const y2 = PY(pi) + 18 + k * 14;
      wires.push({
        d: orthH([196, SY(si)], [PX, y2], 290 + (lane++ % 6) * 12),
        color: "var(--ink-l3)",
      });
    });
  });
  SVCS.forEach((s, i) => {
    const pi = partIdx(s.from);
    const off = s.from === "consume" ? (s.id === "web-exa" ? -8 : 8) : 0;
    wires.push({
      d: orthH([PX + PW, PY(pi) + PH / 2 + off], [820, s.y + 20], 744 + i * 10),
      color: s.hue === "base" ? "var(--ink-base)" : "var(--ink-l2)",
      dashed: s.need === "optional",
    });
  });
  // 내는 것
  wires.push({
    d: orthH([PX + PW, PY(0) + 20], [820, 148], 760),
    color: "var(--cs-color-text-tertiary)",
  });
  wires.push({
    d: orthH([PX + PW, PY(0) + 36], [820, 262], 776),
    color: "var(--cs-color-text-tertiary)",
  });
  wires.push({
    d: orthH([PX + PW, PY(6) + 20], [820, 180], 792),
    color: "var(--cs-color-text-tertiary)",
    dashed: true,
  });

  return (
    <div className="wbv2 relative" style={{ width: CW.w, height: CW.h }}>
      {/* 루프 소켓 */}
      <div
        className="absolute rounded-full"
        style={{ left: 34, top: 96, width: 12, height: 470, background: "var(--track)" }}
      />
      <span className="absolute text-ui-sm text-text-secondary" style={{ left: 16, top: 66 }}>
        <span className="me-1.5 font-mono text-mono-micro" style={{ color: "var(--ink-x)" }}>
          X
        </span>
        루프의 소켓
      </span>
      {SOCKETS.map((s, i) => {
        const on = used.has(s.point);
        return (
          <div
            key={s.point}
            className={`absolute flex items-center gap-2.5 ${on ? "" : "opacity-40"}`}
            style={{ left: 27, top: SY(i) - 13 }}
          >
            <span
              className="grid size-[26px] place-items-center rounded-full bg-surface-raised"
              style={{
                boxShadow: `0 0 0 2px ${on ? "var(--ink-x)" : "var(--track-edge)"}, var(--cs-elevation-2)`,
              }}
            >
              <FoldGlyph
                fold={s.fold}
                color={on ? "var(--ink-x)" : "var(--cs-color-text-tertiary)"}
              />
            </span>
            <span className="grid leading-tight">
              <span className="text-ui-xs text-text-tertiary">{s.kind}</span>
              <span className="flex items-center gap-1 text-ui-sm text-text-primary [&_svg]:size-2.5">
                {s.short}
                {s.failure === "closed" && <Lock />}
              </span>
            </span>
          </div>
        );
      })}

      <svg aria-hidden className="pointer-events-none absolute inset-0" width={CW.w} height={CW.h}>
        {wires.map((w, i) => (
          <path
            key={i}
            d={w.d}
            fill="none"
            stroke={w.color}
            strokeWidth={1.6}
            strokeDasharray={w.dashed ? "5 4" : undefined}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* group-kit 등뼈 */}
      <div
        className="absolute rounded-full"
        style={{
          left: PX - 14,
          top: 96,
          width: 4,
          height: PY(6) + PH - 96,
          background: "var(--tint-l3)",
        }}
      />
      <span
        className="absolute font-mono text-mono-micro text-text-tertiary [writing-mode:vertical-rl]"
        style={{ left: PX - 30, top: 300 }}
      >
        group-kit
      </span>

      {/* 머리 판 */}
      <div
        className="absolute flex flex-col gap-2 rounded-2xl bg-surface-raised p-3 shadow-3"
        style={{ left: PX - 8, top: 14, width: PW + 16, height: 92 }}
      >
        <div className="flex items-center gap-2.5">
          <HueTile hue="l3" size={32}>
            {EXT_ICON.helm}
          </HueTile>
          <span className="grid flex-1 leading-tight">
            <span className="text-ui-lg text-text-primary" style={{ fontWeight: 600 }}>
              Helm{" "}
              <span className="font-mono text-mono-sm font-normal text-text-tertiary">helm</span>
            </span>
            <span className="text-ui-xs text-text-tertiary">
              L3 의도 그룹 · user 0.1.0 · 상태 HelmState v1
            </span>
          </span>
          <span className="text-ui-xs text-text-tertiary">읽기 전용</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 flex-1 gap-[3px] overflow-hidden rounded-full">
            {HELM_PARTS.map((p) => (
              <span
                key={p.id}
                className="flex-1"
                style={{
                  background:
                    p.op === "on"
                      ? "var(--tint-l3)"
                      : p.op === "drive"
                        ? "var(--ink-l3)"
                        : "var(--cs-color-neutral-track)",
                }}
              />
            ))}
          </span>
          <span className="text-ui-xs text-text-tertiary tabular-nums">
            부품 7 · on 4 · drive 2 · 기록 1
          </span>
        </div>
      </div>

      {/* 부품 판 */}
      {HELM_PARTS.map((p, i) => (
        <div
          key={p.id}
          className="absolute flex items-center gap-2.5 rounded-xl bg-surface-raised px-2.5 shadow-2"
          style={{ left: PX, top: PY(i), width: PW, height: PH }}
        >
          <span
            className="absolute top-1/2 -left-[10px] h-[3px] w-2.5 -translate-y-1/2 rounded-full"
            style={{ background: "var(--tint-l3)" }}
          />
          <HueTile hue="l3">{ICON[p.id]}</HueTile>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="flex items-baseline gap-1.5">
              <span className="text-ui-strong text-text-primary">{p.title}</span>
              <span className="text-ui-xs text-text-tertiary">{p.slot}</span>
            </span>
            <span className="truncate text-ui-xs text-text-tertiary">{p.line}</span>
          </span>
          <Mark tone={p.op === "drive" ? "accent" : "neutral"}>{OP[p.op]}</Mark>
          {(p.points ?? []).map((_, k) => (
            <span
              key={k}
              className="absolute -left-[3px] h-2 w-[5px] rounded-e-sm"
              style={{ top: 18 + k * 14 - 4, background: "var(--ink-l3)" }}
            />
          ))}
        </div>
      ))}

      {/* 내는 것 */}
      <span className="absolute text-ui-sm text-text-secondary" style={{ left: 820, top: 96 }}>
        <span className="me-1.5 font-mono text-mono-micro text-text-tertiary">F</span>
        내는 것
      </span>
      <div
        className="absolute grid gap-1 rounded-xl bg-surface-raised p-2.5 shadow-2"
        style={{ left: 820, top: 126, width: 204 }}
      >
        <span className="text-ui-xs text-text-tertiary">공개 기록 3</span>
        {["signal.detected", "discovery.recorded", "inquiry.finished"].map((r) => (
          <span key={r} className="truncate font-mono text-mono-micro text-text-secondary">
            grp.helm.{r}
          </span>
        ))}
      </div>
      <span
        className="absolute grid h-7 place-items-center rounded-lg bg-surface-raised px-3 text-ui-xs text-text-secondary shadow-2"
        style={{ left: 820, top: 248 }}
      >
        post 큐 · 제안 · 끝 알림
      </span>
      <span
        className="absolute flex h-7 items-center gap-1.5 rounded-lg bg-neutral-well px-3 text-ui-xs text-text-tertiary"
        style={{ left: 820, top: 290 }}
      >
        상태 문서 <span className="font-mono">x_helm_state</span> · 비공개
      </span>

      {/* 서비스 */}
      <span className="absolute text-ui-sm text-text-secondary" style={{ left: 820, top: 358 }}>
        <span className="me-1.5 font-mono text-mono-micro" style={{ color: "var(--ink-l2)" }}>
          L1·L2
        </span>
        쓰는 능력
      </span>
      {SVCS.map((s) => (
        <div
          key={s.id}
          className="absolute flex h-10 items-center gap-2 rounded-xl bg-surface-raised px-2 shadow-2"
          style={{ left: 820, top: s.y, width: 204 }}
        >
          <HueTile hue={s.hue} size={24}>
            {EXT_ICON[s.id] ?? <RotateCw />}
          </HueTile>
          <span className="text-ui-sm text-text-primary">{s.label}</span>
          <span className="ms-auto truncate font-mono text-mono-micro text-text-tertiary">
            {s.cap}
          </span>
        </div>
      ))}
    </div>
  );
}
