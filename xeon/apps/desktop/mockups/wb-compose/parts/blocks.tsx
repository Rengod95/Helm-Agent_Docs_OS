// 블록(그룹 안 코드 한 덩어리)과 provider·출력 노드. 모두 caustic GraphNode·GraphPort(node-graph, 이 시안이 caustic에 더함) 위에 그린다.
// 지점 이름은 꾸밈 없는 글자, fold·실패 규칙은 연한 글자(DP-31). tone 색은 아이콘 면과 검사 줄 아이콘에만(DP-29).
import { GraphNode, GraphPort, type GraphPortState } from "@caustic/react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  FileText,
  History,
  Layers,
  Plug,
  RotateCw,
  Scan,
  Search,
  Shield,
  Sparkles,
  ToneIcon,
  TriangleAlert,
} from "../../_shell";
import type { Block, Provider, SlotKind } from "../fixtures";

export const SLOT_ICON: Record<SlotKind, ReactNode> = {
  scope: <Layers />,
  signal: <Scan />,
  lens: <Sparkles />,
  drive: <RotateCw />,
  guard: <Shield />,
  consume: <Search />,
  record: <FileText />,
  restore: <History />,
};

const FOLD_NOTE = { open: "", closed: " · 실패하면 거부", skip: " · 실패하면 패치 버림" };

export const capPort = (block: string, cap: string) => `b:${block}:${cap}`;
export const providerPort = (provider: string, cap: string) => `p:${provider}:${cap}`;

export function BlockNode({
  block,
  selected,
  onSelect,
  flat = false,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  /** 쌓기 열 안(흐름 배치): 위치를 부모 열이 정한다 */
  flat?: boolean;
}) {
  const bad = block.issue?.level === "error";
  return (
    <GraphNode
      x={0}
      y={0}
      width={330}
      className={flat ? "relative top-0 left-0" : undefined}
      title={block.title}
      meta={block.op}
      icon={SLOT_ICON[block.slot]}
      iconTone={bad ? "danger" : block.slot === "drive" ? "accent" : "neutral"}
      state={bad ? "invalid" : "idle"}
      selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      {block.points.map((p) => (
        <div key={p.point} className="flex min-w-0 items-baseline gap-1.5 text-ui-xs">
          <span className="truncate text-text-primary">{p.point}</span>
          <span className="flex-none text-text-tertiary">
            {p.fold}
            {FOLD_NOTE[p.failure]}
          </span>
        </div>
      ))}
      {block.lines.map((l) => (
        <p key={l} className="m-0 truncate text-ui-xs text-text-tertiary">
          {l}
        </p>
      ))}
      {(block.consumes.length > 0 || block.produces.length > 0) && (
        <div className="grid grid-cols-2 gap-x-3">
          <div className="grid content-start">
            {block.consumes.map((c) => {
              const state: GraphPortState =
                c.provider === null
                  ? "invalid"
                  : block.issue?.code === "on_capability_call"
                    ? "invalid"
                    : "connected";
              return (
                <GraphPort key={c.cap} portId={capPort(block.id, c.cap)} state={state}>
                  <span className="truncate">{c.cap}</span>
                  {c.mode === "requires" ? (
                    <span className="flex-none text-text-tertiary">requires</span>
                  ) : null}
                </GraphPort>
              );
            })}
          </div>
          <div className="grid content-start">
            {block.produces.map((o) => (
              <GraphPort key={o.id} portId={`${block.id}:${o.id}`} side="end" state="connected">
                <span className="truncate">{o.label}</span>
              </GraphPort>
            ))}
          </div>
        </div>
      )}
      {block.issue !== undefined && (
        <div className="flex min-w-0 items-start gap-1.5 pt-0.5 text-ui-xs">
          <ToneIcon tone={block.issue.level === "error" ? "danger" : "warning"}>
            {block.issue.level === "error" ? <CircleAlert /> : <TriangleAlert />}
          </ToneIcon>
          <span className="min-w-0 text-text-primary">
            {block.issue.text}
            <span className="ms-1.5 font-mono text-mono-sm text-text-tertiary">
              {block.issue.code}
            </span>
          </span>
        </div>
      )}
    </GraphNode>
  );
}

export function ProviderNode({ p, dim = false }: { p: Provider; dim?: boolean }) {
  const off = p.caps.every((c) => c.off === true);
  return (
    <GraphNode
      x={0}
      y={0}
      width={180}
      className="relative top-0 left-0"
      title={p.name}
      meta={<span className="font-mono text-mono-sm">{p.layer}</span>}
      icon={<Plug />}
      state={dim || off ? "dimmed" : "idle"}
      variant="solid"
    >
      <p className="m-0 truncate text-ui-xs text-text-tertiary">{p.meta}</p>
      {p.caps.map((c) => (
        <GraphPort
          key={c.cap}
          portId={providerPort(p.id, c.cap)}
          side="end"
          state={c.off === true ? "off" : "connected"}
        >
          <span className="truncate">{c.cap}</span>
        </GraphPort>
      ))}
    </GraphNode>
  );
}

export function OutputNode({
  o,
  dim = false,
}: {
  o: {
    id: string;
    title: string;
    meta: string;
    ports: { id: string; label: string }[];
    foot: string;
  };
  dim?: boolean;
}) {
  return (
    <GraphNode
      x={0}
      y={0}
      width={210}
      className="relative top-0 left-0"
      title={o.title}
      meta={o.meta}
      variant="solid"
      state={dim ? "dimmed" : "idle"}
    >
      {o.ports.map((p) => (
        <GraphPort key={p.id} portId={p.id} state="connected">
          <span
            className={`truncate ${/^[\x20-\x7e]+$/.test(p.label) ? "font-mono text-mono-sm" : ""}`}
          >
            {p.label}
          </span>
        </GraphPort>
      ))}
      <p className="m-0 text-ui-xs text-text-tertiary">{o.foot}</p>
    </GraphNode>
  );
}
