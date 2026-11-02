// P-13 확장 표(묶음 E 공용). 표 머리·행·읽는 중 행을 한 격자로 그린다. caustic Table은 열 폭을 글자 길이로 늘려 영어 라벨에서 가로 스크롤이
// 생겨(N-49), 열마다 최소·최대 폭을 정한 CSS 격자로 짰다(DP-26 투명, 행 사이 선 없음, 숫자 오른쪽, DP-35 minmax).
// 긴 라벨 규칙: 글 칸은 한 줄 말줄임 + title, 상태 칸은 점이 먼저라 글이 잘려도 상태가 읽힌다. compact 폭은 등급·버전 열을 뺀다.
// 옛 언어: 글은 text-ui-dense·text-ui-xs, 정상(켜짐) 점은 옛 팔레트 success. e04-workbench-states/parts/ext-table.tsx에서 옮겼다(e01·e04·e05가 같이 쓴다).
import { Skeleton, Switch, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import { extName, L2, T, type Extension, type Layer, type Layout } from "../_shell";

type Dot = "success" | "warning" | "danger" | "neutral";
/** 층 코드 대신 사람 말(표의 층 열). */
const LAYER_WORD: Record<Layer, string> = {
  L0: T.layerL0,
  L1: T.layerL1,
  L2: T.layerL2,
  L3: T.layerL3,
  plugin: T.plugin,
  X: T.layerX,
};
const DOT: Record<Dot, string> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

/** 확장 상태 → 점 tone과 글. 실패가 있으면 켜짐이어도 warning, 자동 꺼짐은 danger, 꺼짐은 점 없는 neutral. */
export function statusOf(e: Extension): { tone: Dot; text: string } {
  if (e.status === "auto_disabled") return { tone: "danger", text: T.autoDisabled };
  if (e.status === "disabled") return { tone: "neutral", text: L2("꺼짐", "Off") };
  if (e.exempt === true) return { tone: "success", text: L2("켜짐 · 면제", "On · exempt") };
  if (e.failures > 0)
    return {
      tone: "warning",
      text: L2(`켜짐 · 실패 ${e.failures}`, `On · ${e.failures} failures`),
    };
  return { tone: "success", text: L2("켜짐", "On") };
}

export const trustLabel = (e: Extension): string =>
  e.trust === "builtin" ? T.trustBuiltin : e.trust === "project" ? T.trustProject : T.trustUser;

function cols(layout: Layout, menu: boolean): string {
  if (menu)
    return layout === "compact"
      ? "grid-cols-[minmax(0,1fr)_3rem_minmax(4.5rem,7rem)_2.5rem_1.5rem]"
      : "grid-cols-[minmax(9rem,1fr)_3.5rem_minmax(5rem,8.5rem)_minmax(6rem,10rem)_3.5rem_2.75rem_1.5rem]";
  return layout === "compact"
    ? "grid-cols-[minmax(0,1fr)_3rem_minmax(4.5rem,7rem)_2.5rem]"
    : "grid-cols-[minmax(9rem,1fr)_3.5rem_minmax(5rem,8.5rem)_minmax(6rem,10rem)_3.5rem_2.75rem]";
}

function Cell({ children, end, title }: { children: ReactNode; end?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={`min-w-0 truncate ${end === true ? "text-end tabular-nums" : ""}`}
    >
      {children}
    </span>
  );
}

export function ExtTable({
  rows,
  layout,
  loading = false,
  offline = false,
  readOnly = false,
  lockReason,
  onToggle,
  rowMenu,
}: {
  /** 행 끝 메뉴(⋯) 열. 원격 대상이면 "경로 복사"(N-60). */
  rowMenu?: ((e: Extension) => ReactNode) | undefined;
  rows: Extension[];
  layout: Layout;
  loading?: boolean;
  offline?: boolean;
  /** 좁은 폭(720 미만) 웹·앱: 켜기·끄기 없이 읽기 전용(계획에 없음 8). */
  readOnly?: boolean;
  /** 켜기 잠금 이유(원격 대상 권한 등, N-60). 주면 Switch가 잠기고 Tooltip으로 이유. */
  lockReason?: string | undefined;
  onToggle?: (name: string, on: boolean) => void;
}) {
  const compact = layout === "compact";
  const grid = `grid ${cols(layout, rowMenu !== undefined)} items-center gap-x-3`;
  return (
    <div role="table" aria-label={T.extension} aria-busy={loading} className="grid text-ui-dense">
      <div role="row" className={`${grid} h-7 text-ui-xs text-text-tertiary`}>
        <span role="columnheader">{L2("이름", "Name")}</span>
        <span role="columnheader">{T.layer}</span>
        {!compact && <span role="columnheader">{T.trust}</span>}
        <span role="columnheader">{L2("상태", "Status")}</span>
        {!compact && (
          <span role="columnheader" className="text-end">
            {T.version}
          </span>
        )}
        <span role="columnheader" className="text-end">
          {readOnly ? "" : L2("켜짐", "On")}
        </span>
        {rowMenu !== undefined && <span aria-hidden />}
      </div>
      {loading
        ? [62, 48, 70, 54, 40].map((w) => (
            <div key={w} role="row" className={`${grid} h-8`}>
              <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              <Skeleton className="h-3.5 w-6" />
              {!compact && <Skeleton className="h-3.5 w-14" />}
              <Skeleton className="h-3.5 w-16" />
              {!compact && <Skeleton className="ms-auto h-3.5 w-8" />}
              <Skeleton className="ms-auto h-4 w-7 rounded-full" />
            </div>
          ))
        : rows.map((e) => {
            const st = statusOf(e);
            const name = extName(e.name);
            const on = e.status === "enabled";
            return (
              <div
                key={e.name}
                role="row"
                className={`${grid} -mx-2 h-8 rounded-md px-2 hover:bg-fill-hover`}
              >
                <span role="cell" className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-medium text-text-primary" title={name}>
                    {name}
                  </span>
                </span>
                <span role="cell" className="truncate font-mono text-mono-sm text-text-tertiary">
                  {LAYER_WORD[e.layer]}
                </span>
                {!compact && (
                  <span role="cell" className="min-w-0 text-text-secondary">
                    <Cell title={trustLabel(e)}>{trustLabel(e)}</Cell>
                  </span>
                )}
                <span role="cell" className="flex min-w-0 items-center gap-1.5 text-text-secondary">
                  <span aria-hidden className={`size-1.5 flex-none rounded-full ${DOT[st.tone]}`} />
                  <Cell title={st.text}>{st.text}</Cell>
                </span>
                {!compact && (
                  <span role="cell" className="text-end font-mono text-mono-sm text-text-tertiary">
                    {e.version}
                  </span>
                )}
                <span role="cell" className="flex justify-end">
                  {readOnly ? null : lockReason !== undefined || e.exempt === true ? (
                    <Tooltip
                      content={
                        e.exempt === true
                          ? L2(
                              "보안·기본 동작이라 끌 수 없어요",
                              "Security or core behavior: can't be turned off",
                            )
                          : lockReason
                      }
                      side="left"
                    >
                      <span
                        tabIndex={0}
                        aria-label={`${name}, ${on ? L2("켜짐", "on") : L2("꺼짐", "off")}, ${L2("바꿀 수 없음", "locked")}`}
                        className="inline-flex rounded-full outline-none focus-visible:focus-ring"
                      >
                        <Switch size="sm" checked={on} disabled aria-hidden tabIndex={-1} />
                      </span>
                    </Tooltip>
                  ) : (
                    <Switch
                      size="sm"
                      checked={on}
                      disabled={offline}
                      aria-label={`${name} ${on ? L2("끄기", "turn off") : L2("켜기", "turn on")}`}
                      onCheckedChange={(v) => onToggle?.(e.name, v)}
                    />
                  )}
                </span>
                {rowMenu !== undefined && <span role="cell">{rowMenu(e)}</span>}
              </div>
            );
          })}
    </div>
  );
}
