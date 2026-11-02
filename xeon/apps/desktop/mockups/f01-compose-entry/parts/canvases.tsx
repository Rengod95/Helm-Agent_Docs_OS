// 그룹 보기 캔버스 셋: 작성 중 초안(블록 쌓기), 구성 정보 없음(블록 하나, C-7), 단계 선언 없음(drive 블록 하나, §6.28.2).
// 블록·포트·호스트는 wb-compose를 그대로 쓴다. 블록을 추정해 나누지 않는다(훅 이름으로 추정 금지).
import { EmptyState, GraphNode, NodeGraph, type GraphEdge } from "@caustic/react";
import { useMemo } from "react";
import { T } from "../../_shell";
import { helmBlocks, outputsFor, providers, type Block } from "../../wb-compose/fixtures";
import {
  BlockNode,
  OutputNode,
  ProviderNode,
  capPort,
  providerPort,
} from "../../wb-compose/parts/blocks";
import { CanvasHost, ColumnHead, blockClass } from "../../wb-compose/parts/canvas";

const W = 900;
const H = 820;
const COL = { left: 0, mid: 260, right: 690 };

/** 시작점이 정한 첫 블록들. 플러그인 시작점은 빈 쌓기로 연다. */
const FROM_START: Record<string, string[]> = {
  helm: helmBlocks.map((b) => b.id),
  "group.drive": ["drive", "restore"],
  "group.policy": ["guard"],
  "group.observe": ["signal", "record"],
};

export function DraftCanvas({
  name,
  start,
  selected,
  onSelect,
}: {
  name: string;
  start: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const blocks: Block[] = useMemo(() => {
    const ids = FROM_START[start ?? "helm"] ?? [];
    return helmBlocks.filter((b) => ids.includes(b.id));
  }, [start]);
  const edges = useMemo(() => {
    const out: GraphEdge[] = [];
    const b = blocks.find((x) => x.id === selected);
    if (b === undefined) return out;
    for (const c of b.consumes) {
      const prov = providers.find((p) => p.caps.some((k) => k.cap === c.cap));
      if (prov !== undefined)
        out.push({ from: providerPort(prov.id, c.cap), to: capPort(b.id, c.cap) });
    }
    for (const o of b.produces) out.push({ from: `${b.id}:${o.id}`, to: o.to });
    return out;
  }, [blocks, selected]);
  return (
    <CanvasHost width={W} height={H}>
      <NodeGraph aria-label={`${name} ${T.group} ${T.block}`} width={W} height={H} edges={edges}>
        <div className="absolute grid gap-4" style={{ left: COL.left, top: 0, width: 180 }}>
          <ColumnHead title={`이 ${T.context}의 ${T.capability}`} />
          <div className="grid gap-3">
            {providers.map((p) => (
              <ProviderNode key={p.id} p={p} />
            ))}
          </div>
        </div>
        <div className="absolute grid gap-4" style={{ left: COL.mid, top: 0, width: 330 }}>
          <ColumnHead title={T.block} />
          <div className="grid gap-3">
            {blocks.length === 0 ? (
              <EmptyState
                size="sm"
                surface="dashed"
                mark={null}
                radius="xl"
                title={`${T.block}을 여기에 쌓아요`}
              />
            ) : (
              blocks.map((b) => (
                <BlockNode
                  key={b.id}
                  block={b}
                  selected={selected === b.id}
                  onSelect={() => onSelect(b.id)}
                />
              ))
            )}
          </div>
        </div>
        <div className="absolute grid gap-4" style={{ left: COL.right, top: 0, width: 210 }}>
          <ColumnHead title="기록과 상태" />
          <div className="grid gap-3">
            {outputsFor(name).map((o) => (
              <OutputNode key={o.id} o={o} />
            ))}
          </div>
        </div>
      </NodeGraph>
    </CanvasHost>
  );
}

/** 선언이 없는 설치 그룹: 블록 하나. 그 밖의 것을 지어내지 않는다. */
export function NoComposition({ name }: { name: string }) {
  return (
    <CanvasHost width={420} height={150}>
      <NodeGraph aria-label={`${name} ${T.group} ${T.block}`} width={420} height={150} edges={[]}>
        <GraphNode
          x={0}
          y={32}
          width={420}
          className={blockClass({ flat: false })}
          title={`${T.compose} 정보 없음`}
          state="idle"
        >
          <span className="text-body text-text-tertiary">
            {`${T.manifest}에 ${T.block} 선언이 없어요`}
          </span>
        </GraphNode>
      </NodeGraph>
    </CanvasHost>
  );
}

/** 구성은 있지만 단계 선언이 없는 그룹: 문장 하나와 drive 블록 하나. */
export function NoPhases({ name }: { name: string }) {
  return (
    <CanvasHost width={420} height={190}>
      <NodeGraph aria-label={`${name} ${T.phaseMachine}`} width={420} height={190} edges={[]}>
        <div className="absolute inset-x-0 top-0 grid gap-1">
          <h2 className="m-0 text-title-2 text-text-primary">{`${T.step} 선언이 없어요`}</h2>
          <p className="m-0 text-body text-text-tertiary">
            {`${T.manifest}에 ${T.step}가 없어 흐름을 그리지 않아요`}
          </p>
        </div>
        <GraphNode
          x={0}
          y={88}
          width={420}
          className={blockClass({ flat: false })}
          title={T.phaseMachine}
          meta={T.drive}
          state="idle"
        />
      </NodeGraph>
    </CanvasHost>
  );
}
