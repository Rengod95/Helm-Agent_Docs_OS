// P-13 확장 목록을 줄인 것(이 묶음의 진입점만): 머리 "가져오기", 행의 업데이트 단추, 행 메뉴 "지우기".
// 표는 투명한 가운데 위, 머리 tertiary, 행 사이 선 없이 간격(DP-26), 고른 행은 raised 면 하나(DP-43).
// caustic Table 대신 격자로 그린다: 행 안에 단추·메뉴를 두고 상태 점을 그리기 위해서(빈틈: Table 칸 안 동작 부품).
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from "@caustic/react";
import { Ellipsis, FolderOpen, josa, RotateCw, T, Trash2 } from "../../_shell";
import type { Ext } from "../data";
import { ExtLabel, trustName } from "./bits";

const dot = {
  on: "bg-success-graphic",
  off: "bg-neutral-graphic",
  trust_undecided: "bg-warning-graphic",
  removing: "bg-neutral-graphic",
  auto_off: "bg-danger-graphic",
} as const;
const stateText = {
  on: "켜짐",
  off: "꺼짐",
  trust_undecided: "신뢰 확인 기다림",
  removing: `지우는 중 · 이번 ${T.step} 뒤`,
  auto_off: T.autoDisabled,
} as const;

const COLS =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_10rem_4rem_8.5rem_2rem] items-center gap-x-3";

export function ExtList({
  exts,
  focus,
  onUpdate,
  onEnable,
  onRemove,
}: {
  exts: Ext[];
  focus: string | null;
  onUpdate: (name: string) => void;
  onEnable: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div role="table" aria-label={T.extension} className="grid gap-0.5">
      <div role="row" className={`${COLS} h-7 px-2 text-ui-xs text-text-tertiary`}>
        <span role="columnheader">이름</span>
        <span role="columnheader">{T.layer}</span>
        <span role="columnheader">{T.trust}</span>
        <span role="columnheader">상태</span>
        <span role="columnheader" className="text-end">
          {T.version}
        </span>
        <span role="columnheader" />
        <span role="columnheader" />
      </div>
      {exts.map((e) => (
        <div
          role="row"
          key={e.name}
          className={`${COLS} h-9 rounded-md px-2 text-ui-dense ${focus === e.name ? "bg-surface-raised shadow-1" : ""}`}
        >
          <span role="cell" className="min-w-0">
            <ExtLabel display={e.display} name={e.name} strong />
          </span>
          <span role="cell" className="font-mono text-mono-sm text-text-tertiary">
            {e.layer}
          </span>
          <span role="cell" className="truncate text-text-secondary">
            {trustName[e.trust]}
          </span>
          <span
            role="cell"
            className="inline-flex min-w-0 items-center gap-1.5 text-text-secondary"
          >
            <span aria-hidden className={`size-1.5 flex-none rounded-full ${dot[e.state]}`} />
            <span className="truncate">{stateText[e.state]}</span>
          </span>
          <span role="cell" className="text-end tabular-nums text-text-secondary">
            {e.version}
          </span>
          <span role="cell" className="flex justify-end">
            {e.update !== undefined && e.state === "on" && (
              // 단추 글은 짧게, 대상 버전은 툴팁과 접근 이름으로(동작 단추에 말줄임을 두지 않는다).
              <Tooltip content={`${e.version} → ${e.update}`}>
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  aria-label={`${josa(e.update, "으로", "로")} 업데이트`}
                  onClick={() => onUpdate(e.name)}
                >
                  업데이트
                </Button>
              </Tooltip>
            )}
            {e.state === "trust_undecided" && (
              <Button size="xs" tone="neutral" variant="outline" onClick={() => onEnable(e.name)}>
                켜기
              </Button>
            )}
          </span>
          <span role="cell">
            <Menu
              align="end"
              aria-label={`${e.display} 메뉴`}
              trigger={
                <IconButton size="xs" variant="ghost" label={`${e.display} 메뉴`}>
                  <Ellipsis />
                </IconButton>
              }
            >
              <MenuItem icon={<FolderOpen />}>{T.installFolder} 열기</MenuItem>
              <MenuItem icon={<RotateCw />}>다시 읽기</MenuItem>
              <MenuSeparator />
              {e.trust === "builtin" ? (
                <Tooltip
                  content={`${T.trustBuiltin} ${josa(T.extension, "은", "는")} 끌 수만 있어요`}
                >
                  <span>
                    <MenuItem icon={<Trash2 />} disabled>
                      {T.uninstall}
                    </MenuItem>
                  </span>
                </Tooltip>
              ) : (
                <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => onRemove(e.name)}>
                  {T.uninstall}…
                </MenuItem>
              )}
            </Menu>
          </span>
        </div>
      ))}
    </div>
  );
}
