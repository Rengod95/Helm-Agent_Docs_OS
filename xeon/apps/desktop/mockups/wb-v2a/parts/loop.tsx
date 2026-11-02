// 에이전트 루프(층 보기): 경기장 모양 궤도 하나. 위쪽 곧은 길에 소켓(훅)과 역(post 큐, 주도 자리)이 놓이고,
// 아래쪽 길은 "다음 턴"으로 돌아가는 화살표다. 소켓 안 모양 = fold, 소켓 아래 점 = 꽂힌 블록(층 색), 안쪽 아래 = 훅 종류와 수.
import { Lock, Play } from "../../_shell";
import { KINDS, LOOP, SOCKETS, STATIONS, type Hue } from "../data";
import { FoldGlyph, hueVar } from "./kit";

export interface LoopProps {
  /** 훅 → 꽂힌 블록들의 층 색 */
  plugged: Record<string, Hue[]>;
  /** 강조할 훅(고른 블록이 꽂힌 곳). 비면 모두 보통. */
  lit?: Set<string>;
  /** 훅 → 경고 tone */
  alarm?: Record<string, "danger" | "warning">;
  drive?: { holder: string | null; line: string; live?: boolean };
  postCount?: number;
  dimAll?: boolean;
}

export function LoopTrack({ plugged, lit, alarm = {}, drive, postCount, dimAll }: LoopProps) {
  const { x, y, w, h, r } = LOOP;
  const bottomY = y + h;
  const anyLit = lit !== undefined && lit.size > 0;
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: 0, top: 0 }}
        width={x + w + 4}
        height={bottomY + 12}
      >
        <rect
          x={x + 6}
          y={y}
          width={w - 12}
          height={h}
          rx={r - 6}
          fill="none"
          stroke="var(--track)"
          strokeWidth={12}
        />
        <rect
          x={x}
          y={y - 6}
          width={w}
          height={h + 12}
          rx={r}
          fill="none"
          stroke="var(--track-edge)"
          strokeWidth={1}
          opacity={0.6}
        />
        {/* 방향: 위 길은 오른쪽으로, 아래 길은 왼쪽으로(다음 턴) */}
        {[160, 330, 500].map((cx) => (
          <path
            key={cx}
            d={`M${cx + 4} ${bottomY - 4} l-6 4 l6 4`}
            fill="none"
            stroke="var(--cs-color-text-tertiary)"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <path
          d={`M${x + 12} ${y + h / 2 + 10} l4 -6 l4 6`}
          fill="none"
          stroke="var(--cs-color-text-tertiary)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 접힌 종류(핸들러 없음)의 작은 홈 */}
        {KINDS.filter((k) => !SOCKETS.some((s) => s.kind === k.kind)).map((k) => {
          const cx = (k.x0 + k.x1) / 2;
          return [-8, 0, 8].map((d) => (
            <circle
              key={k.kind + d}
              cx={cx + d}
              cy={y}
              r={2.5}
              fill="var(--cs-color-bg-app)"
              stroke="var(--track-edge)"
              strokeWidth={1.2}
            />
          ));
        })}
      </svg>
      {/* 소켓 */}
      {SOCKETS.map((s) => {
        const on = plugged[s.point] ?? [];
        const dim = dimAll === true || (anyLit && !lit!.has(s.point));
        const al = alarm[s.point];
        const ring =
          al === "danger"
            ? "var(--cs-color-danger-solid)"
            : al === "warning"
              ? "var(--cs-color-warning-solid)"
              : "var(--ink-x)";
        return (
          <div
            key={s.point}
            className={`absolute transition-opacity ${dim ? "opacity-35" : ""}`}
            style={{ left: s.x - 13, top: y - 13 }}
          >
            <span
              className="grid size-[26px] place-items-center rounded-full bg-surface-raised shadow-2"
              style={{ boxShadow: `0 0 0 2px ${ring}, var(--cs-elevation-2)` }}
              title={s.point}
            >
              <FoldGlyph fold={s.fold} size={10} color={ring} />
            </span>
            <span className="absolute top-[32px] left-1/2 flex -translate-x-1/2 gap-[3px]">
              {on.map((hue, i) => (
                <span
                  key={i}
                  className="size-[6px] rounded-full"
                  style={{ background: hueVar(hue, "ink") }}
                />
              ))}
            </span>
            <span className="absolute top-[42px] left-1/2 grid -translate-x-1/2 justify-items-center text-center leading-tight whitespace-nowrap">
              <span className="text-ui-xs text-text-primary">{s.short}</span>
              {s.failure === "closed" && (
                <span className="inline-flex items-center gap-0.5 text-micro text-text-tertiary [&_svg]:size-2.5">
                  <Lock /> 실패하면 거부
                </span>
              )}
            </span>
          </div>
        );
      })}
      {/* 종류 칸 이름 */}
      {KINDS.map((k) => (
        <span
          key={k.kind}
          className={`absolute text-center text-micro whitespace-nowrap text-text-tertiary tabular-nums ${dimAll ? "opacity-40" : ""}`}
          style={{ left: k.x0, width: k.x1 - k.x0, top: bottomY - 38 }}
        >
          <span className="block leading-tight">{k.kind}</span>
          <span className="block leading-tight">{k.count}</span>
        </span>
      ))}
      <span
        className="absolute text-micro text-text-tertiary"
        style={{ left: x + 30, top: y + h / 2 - 7 }}
      >
        턴
      </span>
      {/* 역: post 큐 */}
      <div
        className="absolute grid place-items-center rounded-lg bg-surface-raised text-ui-xs text-text-secondary shadow-2"
        style={{
          left: STATIONS.post.x - STATIONS.post.w / 2,
          top: y - 12,
          width: STATIONS.post.w,
          height: 24,
        }}
      >
        post 큐{postCount !== undefined ? ` ${postCount}` : ""}
      </div>
      <span
        className="absolute text-center text-micro text-text-tertiary"
        style={{ left: STATIONS.post.x - 40, width: 80, top: y + 18 }}
      >
        다음 턴 입력
      </span>
      {/* 역: 주도 자리 */}
      <div
        className={`absolute flex items-center gap-1.5 rounded-lg px-2 text-ui-xs shadow-2 [&_svg]:size-3 ${
          drive?.holder
            ? "bg-accent-soft text-accent-text"
            : "bg-surface-raised text-text-secondary"
        } ${drive?.live ? "wbv2-breathe" : ""}`}
        style={{
          left: STATIONS.drive.x - STATIONS.drive.w / 2,
          top: y - 12,
          width: STATIONS.drive.w,
          height: 24,
        }}
      >
        <Play />
        <span className="truncate">{drive?.holder ? `drive · ${drive.holder}` : "drive 자리"}</span>
      </div>
      <span
        className="absolute text-center text-micro whitespace-nowrap text-text-tertiary"
        style={{ left: STATIONS.drive.x - 90, width: 180, top: y + 18 }}
      >
        {drive?.line ?? "대화마다 한 그룹"}
      </span>
    </>
  );
}
