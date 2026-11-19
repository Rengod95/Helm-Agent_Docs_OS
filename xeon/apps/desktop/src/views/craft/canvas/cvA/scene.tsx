// cvA 장면: 턴의 레일(블록 다섯·경계 셋), 돌아오는 길과 그 위의 기록, 붙음 선(곧은 직각, 등뼈와 순서 숫자), 핸드오프 호(겹줄 점선),
// 레일의 걸쇠 표식, 끄는 동안의 놓을 자리. 노드 아래 한 장의 SVG다(누를 수 없고 보조 기술에서 숨긴다).
import { t } from "@fresnel/client/i18n";
import { useId, type ReactNode } from "react";
import { TAG_H, TAG_W, type ProfileLayout, type SlotGeo } from "./layout.ts";
import type { Kind } from "./model.ts";
import { recordName, stationName } from "./words.ts";

export interface SceneProps {
  readonly layout: ProfileLayout;
  /** 밝힐 노드 id(고른 것과 그 이웃) */
  readonly lit: ReadonlySet<string>;
  readonly slots: readonly SlotGeo[];
  readonly hot: SlotGeo | null;
  readonly carryKind: Kind | null;
}

/** 블록 이름표: 레일이 지나가는 깎은 판 */
function tagPath(x: number): string {
  const w = TAG_W / 2;
  const h = TAG_H / 2;
  const c = 5;
  return `M${x - w + c} ${-h}H${x + w}V${h - c}L${x + w - c} ${h}H${x - w}V${-h + c}Z`;
}

export function Scene({ layout, lit, slots, hot, carryKind }: SceneProps): ReactNode {
  const uid = useId().replace(/:/g, "");
  const { bounds, rail } = layout;
  const anyLit = lit.size > 0;
  const arrow = `cva-arrow-${uid}`;
  const back = `cva-back-${uid}`;
  return (
    <svg
      aria-hidden
      className="cva-scene overflow-visible"
      width={bounds.w}
      height={bounds.h}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
    >
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M1 1.5 8 5 1 8.5" fill="none" stroke="var(--cva-drive)" strokeWidth="1.4" />
        </marker>
        <marker
          id={back}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M2 2 6 5 2 8" fill="none" stroke="var(--cva-line)" strokeWidth="1.2" />
        </marker>
      </defs>

      {/* 돌아오는 길: 턴 끝 → 다음 입력. 기록은 이 길 위에 선다(모든 블록의 사건을 받는다) */}
      <path d={layout.back.d} fill="none" stroke="var(--cva-line-soft)" strokeDasharray="2 5" />
      <path
        d={`M${layout.back.record.x + 70} ${layout.back.y}H${layout.back.record.x - 70}`}
        fill="none"
        stroke="var(--cva-line)"
        markerEnd={`url(#${back})`}
      />
      <g>
        <rect
          x={layout.back.record.x - 34}
          y={layout.back.y - 10}
          width={68}
          height={20}
          fill="var(--cva-panel)"
          stroke="var(--cva-line-soft)"
          strokeDasharray="2 2"
        />
        <text
          x={layout.back.record.x}
          y={layout.back.y + 4}
          textAnchor="middle"
          className="cva-tertiary"
        >
          {recordName()}
        </text>
      </g>
      <text x={(layout.stations[1]?.x ?? 0) + 10} y={layout.back.y - 8} className="cva-tertiary">
        {t("desktop.craft.canvas.cvA.rail.next")}
      </text>

      {/* 레일 */}
      <line x1={rail.x1} y1={0} x2={rail.x2} y2={0} stroke="var(--cva-line)" strokeWidth={1} />
      <path
        d={`M${rail.x2 - 7} -4.5 ${rail.x2} 0 ${rail.x2 - 7} 4.5`}
        fill="none"
        stroke="var(--cva-line)"
      />

      {/* 붙음 선 */}
      {layout.links
        .filter((l) => l.type !== "handoff")
        .map((l) => {
          const hotLink = lit.has(l.from);
          return (
            <path
              key={l.id}
              d={l.d}
              fill="none"
              stroke={
                hotLink
                  ? "var(--cva-line-hot)"
                  : anyLit
                    ? "var(--cva-line-soft)"
                    : "var(--cva-line)"
              }
              strokeWidth={hotLink ? 1.25 : 1}
              strokeDasharray={l.draft ? "4 3" : undefined}
              strokeLinejoin="miter"
            />
          );
        })}

      {/* 핸드오프: 겹줄 관(옅은 굵은 선 + 점선)과 끝 화살 */}
      {layout.links
        .filter((l) => l.type === "handoff")
        .map((l) => {
          const hotLink = lit.has(l.from) || (l.to !== null && lit.has(l.to));
          return (
            <g key={l.id} opacity={anyLit && !hotLink ? 0.45 : 1}>
              <path
                d={l.d}
                fill="none"
                stroke="color-mix(in oklab, var(--cva-drive) 30%, transparent)"
                strokeWidth={6}
                strokeLinecap="round"
              />
              <path
                d={l.d}
                fill="none"
                stroke="var(--cva-drive)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                markerEnd={`url(#${arrow})`}
              />
            </g>
          );
        })}

      {/* 순서 숫자 */}
      {layout.orders.map((o) => (
        <text
          key={`${o.x}:${o.y}`}
          x={o.x}
          y={o.y + 4}
          textAnchor="middle"
          className="cva-tertiary"
        >
          {String(o.value)}
        </text>
      ))}

      {/* 레일 자리 */}
      {layout.stations.map((s) =>
        s.boundary ? (
          <g key={s.id}>
            <line x1={s.x} y1={-15} x2={s.x} y2={15} stroke="var(--cva-line-hot)" />
            <path
              d={`M${s.x} -4 ${s.x + 4} 0 ${s.x} 4 ${s.x - 4} 0Z`}
              fill="var(--cs-color-bg-canvas)"
              stroke="var(--cva-line-hot)"
            />
            <text x={s.x + 7} y={-21} className="cva-tertiary">
              {stationName(s.id)}
            </text>
          </g>
        ) : (
          <g key={s.id}>
            <path d={tagPath(s.x)} fill="var(--cva-panel)" stroke="var(--cva-line)" />
            <text x={s.x} y={4.5} textAnchor="middle" className="cva-station-name">
              {stationName(s.id)}
            </text>
          </g>
        ),
      )}

      {/* 레일의 걸쇠: Hook은 레일을 감싸는 U, 들어감은 이름표 위 쐐기, 스타트는 채운 삼각 */}
      {layout.clamps.map((c) => {
        const key = `${c.kind}:${c.x}`;
        if (c.kind === "hook")
          return (
            <path
              key={key}
              d={`M${c.x - 5} -5V2a5 5 0 0 0 10 0V-5`}
              fill="none"
              stroke="var(--cva-hook)"
              strokeWidth={1.5}
            />
          );
        if (c.kind === "feed")
          return (
            <path
              key={key}
              d={`M${c.x - 5} ${c.y - 8}L${c.x} ${c.y - 3}L${c.x + 5} ${c.y - 8}`}
              fill="none"
              stroke="var(--cva-line-hot)"
              strokeWidth={1.5}
            />
          );
        return (
          <path key={key} d={`M${c.x - 5} -14H${c.x + 5}L${c.x} -7Z`} fill="var(--cva-drive)" />
        );
      })}

      {/* 끄는 동안: 놓을 자리 */}
      {carryKind === null
        ? null
        : slots.map((s) => {
            const isHot =
              hot !== null && hot.anchor.x === s.anchor.x && hot.anchor.y === s.anchor.y;
            const leader =
              s.rail === null ? null : (
                <g key={`lead:${s.anchor.x}:${s.anchor.y}`} data-kind={carryKind}>
                  <path
                    d={`M${s.rail.x} ${s.rail.y}V${s.rail.y + (s.y > 0 ? 34 : -34)}H${s.x + s.w / 2}V${s.y > 0 ? s.y : s.y + s.h}`}
                    fill="none"
                    stroke="var(--cva-ink)"
                    strokeDasharray="3 3"
                    opacity={isHot ? 1 : 0.6}
                  />
                  <circle
                    cx={s.rail.x}
                    cy={s.rail.y}
                    r={isHot ? 6 : 4}
                    fill="none"
                    stroke="var(--cva-ink)"
                    strokeWidth={1.5}
                  />
                </g>
              );
            const shape =
              s.shape === "ghost" ? (
                <rect
                  key={`${s.anchor.x}:${s.anchor.y}`}
                  data-kind={carryKind}
                  data-hot={isHot}
                  className="cva-slot"
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                />
              ) : (
                <rect
                  key={`${s.anchor.x}:${s.anchor.y}`}
                  data-kind={carryKind}
                  data-hot={isHot}
                  className="cva-slot-bar"
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                />
              );
            return [leader, shape];
          })}
    </svg>
  );
}
