// P-13 부품. caustic List 행은 48px 고정 높이 상자라, 두 줄(이름·출처·상태 / 패키지·훅·drive) + 스위치 + 펼친 그룹 설정을 담는
// 런타임 행을 토큰으로 만든다(빈틈: List에 행 아래 펼침 내용과 두 줄 메타 슬롯이 없음).
import { Badge, Button, Switch } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { ChevronRight, Clock } from "../_shell";
import type { Ext, Source } from "./fixtures";

const SOURCE: Record<Source, string> = {
  builtin: "내장",
  managed: "관리",
  user: "사용자",
  project: "프로젝트",
};

function StateMark({ e, safe }: { e: Ext; safe: boolean }) {
  if (safe && e.source !== "managed" && (e.source !== "builtin" || e.layer === "L3"))
    return <span className="text-ui-sm text-text-tertiary">안전 모드라 꺼짐</span>;
  const s = e.state;
  switch (s.kind) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-ui-sm text-text-tertiary">
          <Clock aria-hidden className="size-icon-xs" />
          {s.text}
        </span>
      );
    case "autoDisabled":
      return (
        <Badge size="sm" tone="danger">
          {s.text}
        </Badge>
      );
    case "untrusted":
      return (
        <Badge size="sm" tone="warning">
          신뢰 필요
        </Badge>
      );
    case "waiting":
      return <span className="text-ui-sm text-warning-text">{s.text}</span>;
    default:
      return null;
  }
}

function DriveMark({ d }: { d: Ext["drive"] }) {
  if (d === "holding")
    return (
      <Badge size="sm" tone="info" dot>
        drive 보유 중
      </Badge>
    );
  return null;
}

export interface ExtRowProps {
  e: Ext;
  safe?: boolean;
  disabled?: boolean;
  /** 이름 줄 끝, 스위치 앞 동작(자세히, 다시 켜기, 신뢰). */
  actions?: ReactNode;
  /** 그룹 설정(펼침). */
  settings?: ReactNode;
  defaultOpen?: boolean;
  error?: ReactNode;
}

/** 그룹 행. 경로와 훅 목록은 화면에 두지 않는다. */
export function GroupRow({
  e,
  safe = false,
  disabled,
  actions,
  settings,
  defaultOpen = false,
  error,
}: ExtRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const on = !safe && (e.state.kind === "on" || e.state.kind === "pending");
  const locked = safe || e.state.kind === "untrusted" || disabled === true;
  return (
    <div role="group" aria-label={e.label ?? e.name} className="grid gap-1 py-2">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ui font-medium text-text-primary">{e.label ?? e.name}</span>
            <span className="text-ui-sm text-text-tertiary">{SOURCE[e.source]}</span>
            <DriveMark d={safe ? "none" : e.drive} />
            <StateMark e={e} safe={safe} />
          </div>
          {e.desc !== undefined && <p className="m-0 text-ui-sm text-text-secondary">{e.desc}</p>}
        </div>
        <div className="flex flex-none items-center gap-1">
          {actions}
          <Switch
            size="sm"
            aria-label={`${e.label ?? e.name} 켜기`}
            defaultChecked={on}
            disabled={locked}
          />
        </div>
      </div>
      {error !== undefined && (
        <p role="alert" className="m-0 text-ui-sm text-danger-text">
          {error}
        </p>
      )}
      {settings !== undefined && (
        <div className="grid gap-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex w-fit items-center gap-1 rounded-sm text-ui-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
          >
            <ChevronRight
              aria-hidden
              className={`size-icon-xs transition-transform duration-quick ${open ? "rotate-90" : ""}`}
            />
            그룹 설정
          </button>
          {open && <div className="grid">{settings}</div>}
        </div>
      )}
    </div>
  );
}

/** 층별 플러그인 행(한 줄). L0 플랫폼 패키지는 매니페스트가 없고 늘 켜져 있다. */
export function PluginRow({ e, safe = false }: { e: Ext; safe?: boolean }) {
  const safeOff = safe && (e.source === "user" || e.source === "project");
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-3">
      <span className="min-w-0 flex-1 truncate font-mono text-mono text-text-primary">
        {e.name}
      </span>
      <span className="flex-none text-ui-sm text-text-tertiary">{SOURCE[e.source]}</span>
      {safeOff ? (
        <span className="text-ui-sm text-text-tertiary">안전 모드라 꺼짐</span>
      ) : (
        <StateMark e={e} safe={false} />
      )}
      {e.state.kind === "always" ? (
        <span className="w-[38px] flex-none text-end text-ui-sm text-text-tertiary">늘 켬</span>
      ) : (
        <Switch
          size="sm"
          aria-label={`${e.name} 켜기`}
          defaultChecked={!safeOff && (e.state.kind === "on" || e.state.kind === "waiting")}
          disabled={safeOff || e.source === "managed"}
        />
      )}
    </div>
  );
}

export function InlineButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <Button size="xs" tone="neutral" variant="ghost" onClick={onClick}>
      {children}
    </Button>
  );
}
