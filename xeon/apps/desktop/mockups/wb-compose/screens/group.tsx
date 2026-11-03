// 그룹 쌓기(구성기 1): 가운데 열에 슬롯 블록을 쌓아 L3 플러그인 그룹 하나를 만든다. 왼쪽 열은 이 맥락에서 기능을 주는
// L1·L2 확장, 오른쪽 열은 블록이 내는 것(공개 기록, 입력 큐, 상태 문서). 선은 고른 블록의 것과 검사에 걸린 것만 그린다.
// 상태: Helm 참고 구성(읽기 전용), 빈 구성기, 검사 실패(lens-review 작성 중).
import { Alert, Button, EmptyState, Field, Input, NodeGraph, type GraphEdge } from "@caustic/react";
import { useMemo } from "react";
import { T } from "../../_shell";
import {
  draftProviders,
  helmBlocks,
  invalidBlocks,
  outputsFor,
  providers,
  type Block,
} from "../fixtures";
import { BlockNode, OutputNode, ProviderNode, capPort, providerPort } from "../parts/blocks";
import { RailRule } from "../parts/rail";
import { CanvasHost, ColumnHead } from "../parts/canvas";
import { useMock } from "../store";

const W = 900;
const H = 820;
const COL = { left: 0, mid: 260, right: 690 };
const CAP_HEAD = `이 ${T.context}의 ${T.capability}`;
const OUT_HEAD = "기록과 상태";

/** 관련 있는 선만: 고른 블록에 닿는 선 + 검사에 걸린 선. 나머지 포트는 점만 남는다. */
function edgesFor(blocks: Block[], provs: typeof providers, selected: string | null): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const b of blocks) {
    const mine = b.id === selected;
    for (const c of b.consumes) {
      const prov = provs.find((p) => p.caps.some((k) => k.cap === c.cap));
      if (prov === undefined) continue;
      const off = prov.caps.find((k) => k.cap === c.cap)?.off === true;
      const bad = off || b.issue?.code === "on_capability_call";
      if (!mine && !bad) continue;
      out.push({
        from: providerPort(prov.id, c.cap),
        to: capPort(b.id, c.cap),
        state: bad ? "invalid" : "idle",
      });
    }
    if (mine) for (const o of b.produces) out.push({ from: `${b.id}:${o.id}`, to: o.to });
  }
  return out;
}

function Columns({
  name,
  blocks,
  provs,
}: {
  name: string;
  blocks: Block[];
  provs: typeof providers;
}) {
  const m = useMock();
  const edges = useMemo(() => edgesFor(blocks, provs, m.selected), [blocks, provs, m.selected]);
  return (
    <NodeGraph aria-label={`${name} ${T.group} ${T.block}`} width={W} height={H} edges={edges}>
      <div className="absolute grid gap-4" style={{ left: COL.left, top: 0, width: 180 }}>
        <ColumnHead title={CAP_HEAD} />
        <div className="grid gap-3">
          {provs.map((p) => (
            <ProviderNode key={p.id} p={p} />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-4" style={{ left: COL.mid, top: 0, width: 330 }}>
        <ColumnHead title={T.block} />
        <div className="grid gap-3">
          {blocks.map((b) => (
            <BlockNode
              key={b.id}
              block={b}
              selected={m.selected === b.id}
              onSelect={() => m.set({ selected: b.id })}
            />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-4" style={{ left: COL.right, top: 0, width: 210 }}>
        <ColumnHead title={OUT_HEAD} />
        <div className="grid gap-3">
          {outputsFor(name).map((o) => (
            <OutputNode key={o.id} o={o} />
          ))}
        </div>
      </div>
    </NodeGraph>
  );
}

function EmptyComposer() {
  const m = useMock();
  const start = (text: string) => () => m.notify(text);
  return (
    <NodeGraph aria-label={`새 ${T.group}`} width={600} height={480} edges={[]}>
      <div className="absolute grid gap-4" style={{ left: COL.left, top: 0, width: 180 }}>
        <ColumnHead title={CAP_HEAD} />
        <div className="grid gap-3">
          {providers.map((p) => (
            <ProviderNode key={p.id} p={p} dim />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-4" style={{ left: COL.mid, top: 0, width: 330 }}>
        <ColumnHead title={`새 ${T.group}`} />
        <Field label={`${T.group} 이름`} size="md">
          <Input size="sm" variant="soft" placeholder="lens-review" />
        </Field>
        <EmptyState
          size="sm"
          surface="dashed"
          mark={null}
          radius="xl"
          title={`${T.block}을 여기에 쌓아요`}
          actions={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => m.set({ group: "lens-review", selected: "drive" })}
              >
                Helm 복제
              </Button>
              <Button size="sm" variant="outline" onClick={start("단계 머신 템플릿을 쌓았어요")}>
                {T.drive} 템플릿
              </Button>
              <Button size="sm" variant="outline" onClick={start("가드 템플릿을 쌓았어요")}>
                정책 템플릿
              </Button>
              <Button size="sm" variant="outline" onClick={start("신호·기록 템플릿을 쌓았어요")}>
                관찰 템플릿
              </Button>
            </div>
          }
        />
      </div>
    </NodeGraph>
  );
}

export function GroupCanvas() {
  const m = useMock();
  if (m.group === "new")
    return (
      <CanvasHost width={600} height={480}>
        <EmptyComposer />
      </CanvasHost>
    );
  const invalid = m.group === "lens-review";
  return (
    <>
      {invalid && (
        <>
          <div className="flex-none px-4 py-3">
            <Alert tone="danger" variant="soft" size="sm">
              검사 3개가 실패했고 1개는 경고예요.
            </Alert>
          </div>
          <RailRule />
        </>
      )}
      <CanvasHost width={W} height={H}>
        {invalid ? (
          <Columns name="lens-review" blocks={invalidBlocks} provs={draftProviders} />
        ) : (
          <Columns name="helm" blocks={helmBlocks} provs={providers} />
        )}
      </CanvasHost>
    </>
  );
}
