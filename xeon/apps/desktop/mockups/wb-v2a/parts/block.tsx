// 블록 해부(SPEC §2): 층 색 아이콘 면 → 이름(라벨 + mono id) → 한 줄 메타 → 오른쪽 위 상태 면. 면은 올린 surface와
// 그림자로만 깊이를 주고 테두리를 긋지 않는다. 플러그인 그룹은 뒤에 얇은 판 둘(부품을 쌓은 묶음)을, 훅 블록은 아래 가장자리에
// 핀(on = 층 색 막대, post = 마름모, drive = 네모)을, 서비스 블록은 위 가장자리에 콘센트(기능 하나에 반원 하나)를 둔다.
import type { ReactNode } from "react";
import {
  CircleX,
  Compass,
  Eye,
  FileText,
  Globe,
  KeyRound,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Play,
  Search,
  Sparkles,
  TriangleAlert,
} from "../../_shell";
import { HUE_OF, socketOf, type Ext } from "../data";
import { HueTile, Mark, hueVar } from "./kit";

export const EXT_ICON: Record<string, ReactNode> = {
  helm: <Compass />,
  "plan-first": <ListChecks />,
  learning: <Sparkles />,
  review: <Eye />,
  "acme-notes": <FileText />,
  "provider-oauth": <KeyRound />,
  web: <Globe />,
  "web-exa": <Search />,
  knowledge: <Lightbulb />,
  work: <ListChecks />,
  dialog: <MessageCircleQuestion />,
};

export interface Pin {
  kind: "on" | "post" | "drive";
  point?: string;
  x: number;
  y: number;
}
/** 훅 블록의 아래 핀 좌표(세계). on은 소켓 순서, 그다음 post, drive. */
export function pinsOf(e: Ext): Pin[] {
  const ons = [...(e.points ?? [])].sort((a, b) => (socketOf(a)?.x ?? 0) - (socketOf(b)?.x ?? 0));
  const list: Omit<Pin, "x" | "y">[] = [
    ...ons.map((p) => ({ kind: "on" as const, point: p })),
    ...(e.usesPost === true ? [{ kind: "post" as const }] : []),
    ...(e.usesDrive === true ? [{ kind: "drive" as const }] : []),
  ];
  const span = e.w - 36;
  return list.map((p, i) => ({
    ...p,
    x: e.x + 18 + (list.length === 1 ? span / 2 : (span * i) / (list.length - 1)),
    y: e.y + e.h + 5,
  }));
}
/** 서비스 블록 위 콘센트 좌표. */
export function outletsOf(e: Ext) {
  const caps = e.provides ?? [];
  return caps.map((cap, i) => ({ cap, x: e.x + 24 + i * 22, y: e.y - 4 }));
}

export interface BlockProps {
  e: Ext;
  selected?: boolean;
  /** 맥락 밖(꺼짐): 윤곽만, 흐리게 */
  off?: boolean;
  /** 고른 것과 관계없어 물러남 */
  faded?: boolean;
  meta?: ReactNode;
  status?: ReactNode;
  diff?: "+" | "−" | "~";
  onSelect?: (id: string) => void;
  /** 위치를 직접(세계 좌표 밖 흐름 배치) */
  flow?: boolean;
  className?: string;
}

export function defaultMeta(e: Ext): string {
  if (e.health === "auto_disabled") return `자동 꺼짐 · 실패 ${e.failures ?? 0}`;
  if (e.health === "disabled") return "꺼짐 · 모델 기능 없음";
  if (e.health === "failing") return `실패 ${e.failures ?? 0} · ${e.trust} ${e.version}`;
  if (e.layer === "L3")
    return e.parts !== undefined
      ? `부품 ${e.parts} · 소켓 ${e.points?.length ?? 0}`
      : "구성 정보 없음";
  if (e.layer === "L2") return `${e.trust === "builtin" ? "내장" : e.trust} · ${e.version}`;
  return `${e.trust} · ${e.version}`;
}

export function defaultStatus(e: Ext): ReactNode {
  if (e.health === "auto_disabled") return <Mark tone="danger" icon={<CircleX />} />;
  if (e.health === "failing")
    return <Mark tone="warning" icon={<TriangleAlert />} className="px-1" />;
  return null;
}

export const holderMark = <Mark tone="accent" icon={<Play />} className="px-1" />;

const DIFF_FACE: Record<string, string> = {
  "+": "bg-diff-add-bg text-diff-add-text",
  "−": "bg-diff-remove-bg text-diff-remove-text",
  "~": "bg-agent-soft text-agent-text",
};

export function Block({
  e,
  selected,
  off,
  faded,
  meta,
  status,
  diff,
  onSelect,
  flow,
  className = "",
}: BlockProps) {
  const hue = HUE_OF[e.layer];
  const isGroup = e.layer === "L3";
  const isService = e.layer === "L2";
  const pins = isService ? [] : pinsOf(e);
  const outlets = isService ? outletsOf(e) : [];
  const st = status === undefined ? defaultStatus(e) : status;
  const pos = flow ? {} : { left: e.x, top: e.y, width: e.w, height: e.h };
  return (
    <div
      className={`${flow ? "relative" : "absolute"} transition-opacity duration-200 ${faded ? "opacity-35" : ""} ${className}`}
      style={pos}
    >
      {isGroup && !off && (
        <>
          <span
            aria-hidden
            className="absolute inset-x-3 -top-2 h-4 rounded-lg bg-surface-raised opacity-50 shadow-1"
          />
          <span
            aria-hidden
            className="absolute inset-x-1.5 -top-1 h-4 rounded-lg bg-surface-raised opacity-80 shadow-1"
          />
        </>
      )}
      {outlets.map((o) => (
        <span
          key={o.cap}
          aria-hidden
          className="absolute h-2 w-3 rounded-t-full"
          style={{
            left: o.x - e.x - 6,
            top: -6,
            background: off ? "var(--cs-color-neutral-track)" : hueVar(hue, "ink"),
          }}
        />
      ))}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${e.label} ${e.id} · ${e.layer} · ${defaultMeta(e)}`}
        onClick={() => onSelect?.(e.id)}
        className={`relative flex h-full w-full flex-col rounded-xl px-2.5 pt-2.5 pb-2 text-left outline-none transition-shadow focus-visible:focus-ring ${
          off
            ? "border border-dashed border-border-default bg-transparent"
            : "bg-surface-raised shadow-2 hover:shadow-3"
        } ${selected ? "ring-2 ring-accent-solid ring-offset-2 ring-offset-bg-app" : ""}`}
        style={flow ? { minHeight: e.h } : undefined}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className={off ? "opacity-50" : ""}>
            <HueTile hue={hue}>{EXT_ICON[e.id] ?? <Sparkles />}</HueTile>
          </span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span
              className={`truncate text-ui-strong ${off ? "text-text-tertiary" : "text-text-primary"} ${diff === "−" ? "line-through decoration-diff-remove-text" : ""}`}
            >
              {e.label}
            </span>
            <span className="truncate font-mono text-mono-micro text-text-tertiary">{e.id}</span>
          </span>
          {st !== null && <span className="-me-0.5 -mt-0.5 flex-none">{st}</span>}
        </span>
        <span className="mt-auto truncate pt-1 text-ui-xs text-text-tertiary">
          {meta ?? defaultMeta(e)}
        </span>
      </button>
      {pins.map((p, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute"
          style={{
            left: p.x - e.x - (p.kind === "on" ? 2.5 : 4),
            top: e.h - 1,
            width: p.kind === "on" ? 5 : 8,
            height: p.kind === "on" ? 7 : 8,
            borderRadius: p.kind === "on" ? "0 0 3px 3px" : 2,
            transform: p.kind === "post" ? "rotate(45deg) translate(1px,1px)" : undefined,
            background: off
              ? "var(--cs-color-neutral-track)"
              : p.kind === "drive"
                ? "var(--cs-color-text-primary)"
                : p.kind === "post"
                  ? "var(--cs-color-text-tertiary)"
                  : hueVar(hue, "ink"),
          }}
        />
      ))}
      {diff !== undefined && (
        <span
          className={`absolute -top-2.5 -left-2.5 z-10 grid size-5 place-items-center rounded-full text-ui-strong leading-none shadow-1 ${DIFF_FACE[diff]}`}
          aria-label={
            diff === "+" ? "켜짐으로 바뀜" : diff === "−" ? "꺼짐으로 바뀜" : "설정 덮어씀"
          }
        >
          {diff}
        </span>
      )}
    </div>
  );
}
