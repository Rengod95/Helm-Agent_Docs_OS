// 블록(그룹 안 코드 한 덩어리)과 provider·출력 노드. 모두 caustic GraphNode·GraphPort(node-graph) 위에 그린다.
// 겉모양은 caustic GraphNode 기본 면(옛 언어)에 blockClass 간격을 더한 것이다. 고른 블록은 selected, 검사 실패는 state="invalid"가 그린다.
// 노드에는 이름과 포트, 검사 문장만 둔다.
// 훅·fold·코드 위치는 well "속성"에서 본다. 아이콘·층 코드·연산 표지는 쓰지 않는다.
import { GraphNode, GraphPort, type GraphPortState } from "@caustic/react";
import type { Block, Provider } from "../fixtures";
import { blockClass } from "./canvas";

export const capPort = (block: string, cap: string) => `b:${block}:${cap}`;
export const providerPort = (provider: string, cap: string) => `p:${provider}:${cap}`;

export function BlockNode({
  block,
  selected,
  onSelect,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
}) {
  const bad = block.issue?.level === "error";
  return (
    <GraphNode
      x={0}
      y={0}
      width={330}
      className={blockClass()}
      title={block.title}
      state={bad ? "invalid" : "idle"}
      selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      {(block.consumes.length > 0 || block.produces.length > 0) && (
        <div className="grid grid-cols-2 gap-x-3">
          <div className="grid content-start">
            {block.consumes.map((c) => {
              const state: GraphPortState =
                c.provider === null || block.issue?.code === "on_capability_call"
                  ? "invalid"
                  : "connected";
              return (
                <GraphPort key={c.cap} portId={capPort(block.id, c.cap)} state={state}>
                  <span className="truncate">{c.cap}</span>
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
        <p
          className={`m-0 text-footnote ${block.issue.level === "error" ? "text-danger-text" : "text-warning-text"}`}
        >
          {block.issue.text}
        </p>
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
      className={blockClass()}
      title={p.name}
      meta={off ? "꺼짐" : undefined}
      state={dim || off ? "dimmed" : "idle"}
    >
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
  o: { id: string; title: string; ports: { id: string; label: string }[] };
  dim?: boolean;
}) {
  return (
    <GraphNode
      x={0}
      y={0}
      width={210}
      className={blockClass()}
      title={o.title}
      state={dim ? "dimmed" : "idle"}
    >
      {o.ports.map((p) => (
        <GraphPort key={p.id} portId={p.id} state="connected">
          <span className="truncate">{p.label}</span>
        </GraphPort>
      ))}
    </GraphNode>
  );
}
