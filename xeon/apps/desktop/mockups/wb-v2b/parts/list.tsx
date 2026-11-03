// 지도 옆 목록(결정 1: 나눔 보기). 캔버스와 고름·올림이 양쪽으로 맞물린다. 투명한 가운데 위의 열(DP-01, DP-26).
// 운영 동작만(결정 2): 켜기·끄기 Switch. 구조 편집은 구성기에서. 층마다 묶고, 행 순서는 캔버스 lane 순서와 같다.
import { Switch } from "@caustic/react";
import { EXTS, THREAD_MEMBERS, THREAD_PENDING, type Ext } from "../data";
import { ExtIcon, Face, PortGlyph } from "./kit";

const GROUPS: { lane: Ext["layer"]; tag: string; title: string }[] = [
  { lane: "L3", tag: "L3", title: "플러그인 그룹" },
  { lane: "plugin", tag: "plugin", title: "외부 확장" },
  { lane: "L2", tag: "L2", title: "기능" },
  { lane: "L1·L0", tag: "L1·L0", title: "코어" },
];

export function ExtList({
  selected,
  hover,
  thread,
  compact = false,
  onSelect,
  onHover,
  onToggle,
}: {
  selected: string | null;
  hover: string | null;
  thread: boolean;
  compact?: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="확장"
      className={`flex min-h-0 flex-col gap-3 overflow-y-auto ${compact ? "" : "w-[224px] flex-none pe-1"}`}
    >
      {GROUPS.map((g) => {
        const rows = EXTS.filter((e) => e.layer === g.lane);
        return (
          <div key={g.lane} className="flex flex-col">
            <div className="flex h-7 items-center gap-1.5 px-2">
              <span className="font-mono text-[10.5px] font-medium text-text-tertiary">
                {g.tag}
              </span>
              <span className="text-ui-xs text-text-tertiary">{g.title}</span>
              <span className="ms-auto font-mono text-[10.5px] text-text-tertiary tabular-nums">
                {rows.length}
              </span>
            </div>
            {rows.map((e) => {
              const on = thread
                ? THREAD_MEMBERS.has(e.id)
                : e.health !== "off" && e.health !== "danger";
              const sel = selected === e.id;
              const hov = hover === e.id && !sel;
              return (
                <div
                  key={e.id}
                  role="option"
                  aria-selected={sel}
                  tabIndex={0}
                  onClick={() => onSelect(sel ? null : e.id)}
                  onKeyDown={(k) =>
                    (k.key === "Enter" || k.key === " ") &&
                    (k.preventDefault(), onSelect(sel ? null : e.id))
                  }
                  onMouseEnter={() => onHover(e.id)}
                  onMouseLeave={() => onHover(null)}
                  className={[
                    "group flex h-9 cursor-default items-center gap-2 rounded-lg px-2 outline-none focus-visible:shadow-focus",
                    sel ? "bg-surface-raised shadow-1" : hov ? "bg-fill-hover" : "",
                  ].join(" ")}
                >
                  <Face health={e.health} size={20}>
                    <ExtIcon name={e.icon} />
                  </Face>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`truncate text-ui-sm ${e.health === "off" ? "text-text-tertiary" : "text-text-primary"}`}
                    >
                      {e.dockTo !== undefined && <span className="text-text-tertiary">└ </span>}
                      {e.label}
                    </span>
                    <span className="truncate font-mono text-[10px] leading-3 text-text-tertiary">
                      {e.id}
                      {e.health === "danger"
                        ? " · 자동 꺼짐"
                        : e.health === "warn"
                          ? ` · 실패 ${e.failures}`
                          : thread && THREAD_PENDING.has(e.id)
                            ? " · 다음 경계"
                            : ""}
                    </span>
                  </span>
                  {compact && (
                    <span className="flex flex-none items-center gap-2 font-mono text-[10px] text-text-tertiary">
                      {e.consumes && (
                        <span className="flex items-center gap-1">
                          <PortGlyph type="cap" hollow size={7} />
                          {e.consumes.length}
                        </span>
                      )}
                      {e.provides && (
                        <span className="flex items-center gap-1">
                          <PortGlyph type="cap" size={7} />
                          {e.provides.length}
                        </span>
                      )}
                      {(e.points?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <PortGlyph type="on" size={7} />
                          {e.points!.length}
                        </span>
                      )}
                      {e.usesPost && <PortGlyph type="post" size={7} />}
                      {e.usesDrive && <PortGlyph type="drive" size={7} />}
                    </span>
                  )}
                  {e.kind !== "core" && !(sel || hover === e.id) && (
                    <span className="flex-none text-[10.5px] text-text-tertiary">
                      {thread && THREAD_PENDING.has(e.id)
                        ? "다음 경계"
                        : on
                          ? ""
                          : e.health === "danger"
                            ? ""
                            : "꺼짐"}
                    </span>
                  )}
                  {e.kind !== "core" && (sel || hover === e.id) && (
                    <Switch
                      size="sm"
                      checked={on || (thread && THREAD_PENDING.has(e.id))}
                      aria-label={`${e.label} 켜기`}
                      onClick={(ev: React.MouseEvent) => ev.stopPropagation()}
                      onCheckedChange={() => onToggle(e.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
