// 그룹 쌓기(구성기 1): 가운데 열에 슬롯 블록을 쌓아 L3 플러그인 그룹 하나를 만든다. 왼쪽 열은 이 맥락에서 기능을 주는
// L1·L2 확장, 오른쪽 열은 블록이 내는 것(F 공개 기록, 입력 큐, 비공개 상태 문서). 층이 열로 나뉘고 선은 포트끼리만 잇는다.
// 상태: Helm 참고 구성(읽기 전용, 설치본 매니페스트·소스에서 읽음), 빈 구성기, 검사 실패(lens-review 작성 중).
import {
  Alert,
  Button,
  GraphNode,
  GraphPort,
  Input,
  NodeGraph,
  type GraphEdge,
} from "@caustic/react";
import { useMemo } from "react";
import { Copy, Layers } from "../../_shell";
import {
  draftProviders,
  draftScope,
  helmBlocks,
  helmScope,
  invalidBlocks,
  outputsFor,
  providers,
  type Block,
} from "../fixtures";
import { BlockNode, OutputNode, ProviderNode, capPort, providerPort } from "../parts/blocks";
import { BandLabel, CanvasHost } from "../parts/canvas";
import { useMock } from "../store";

const W = 880;
const H = 760;
const COL = { left: 0, mid: 250, right: 670 };

function edgesFor(blocks: Block[], provs: typeof providers): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const b of blocks) {
    for (const c of b.consumes) {
      const prov = provs.find((p) => p.caps.some((k) => k.cap === c.cap));
      if (prov === undefined) continue;
      const off = prov.caps.find((k) => k.cap === c.cap)?.off === true;
      const bad = off || b.issue?.code === "on_capability_call";
      out.push({
        from: providerPort(prov.id, c.cap),
        to: capPort(b.id, c.cap),
        state: bad ? "invalid" : "idle",
        dashed: c.mode === "optional",
        ...(bad && c.mode === "requires" ? { label: "provider 꺼짐" } : {}),
      });
    }
    for (const o of b.produces) out.push({ from: `${b.id}:${o.id}`, to: o.to });
  }
  return out;
}

function ScopeNode({ scope, readOnly }: { scope: typeof helmScope; readOnly: boolean }) {
  return (
    <GraphNode
      x={0}
      y={0}
      width={330}
      className="relative top-0 left-0"
      title={<span className="font-mono text-mono-strong">{scope.name}</span>}
      label={scope.name}
      meta={readOnly ? "읽기 전용" : "작성 중"}
      icon={<Layers />}
      variant="soft"
    >
      <p className="m-0 truncate text-ui-xs text-text-secondary">
        {scope.meta} · {scope.state}
      </p>
      <div className="flex min-w-0 items-baseline gap-1.5 text-ui-xs">
        <span className="text-text-tertiary">주도 상한</span>
        <span className="tabular-nums text-text-primary">
          턴 {scope.limits.maxTurns} · spawn {scope.limits.maxSpawns} · 토큰{" "}
          {Math.round(scope.limits.maxTokens / 1000)}k
        </span>
      </div>
      <p className="m-0 truncate text-ui-xs text-text-tertiary">{scope.settings}</p>
    </GraphNode>
  );
}

function Columns({
  blocks,
  provs,
  scope,
  readOnly,
}: {
  blocks: Block[];
  provs: typeof providers;
  scope: typeof helmScope;
  readOnly: boolean;
}) {
  const m = useMock();
  const edges = useMemo(() => edgesFor(blocks, provs), [blocks, provs]);
  return (
    <NodeGraph aria-label={`${scope.name} 그룹 블록`} width={W} height={H} edges={edges}>
      <div className="absolute grid gap-2" style={{ left: COL.left, top: 0, width: 180 }}>
        <BandLabel layer="L1·L2">이 맥락의 기능</BandLabel>
        <div className="grid gap-3 pt-14">
          {provs.map((p) => (
            <ProviderNode key={p.id} p={p} />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-2" style={{ left: COL.mid, top: 0, width: 330 }}>
        <BandLabel layer="L3">플러그인 그룹 · 블록 {blocks.length}</BandLabel>
        <ScopeNode scope={scope} readOnly={readOnly} />
        <div className="grid gap-1.5 pt-1.5">
          {blocks.map((b) => (
            <BlockNode
              key={b.id}
              block={b}
              flat
              selected={m.selected === b.id}
              onSelect={() => m.set({ selected: b.id })}
            />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-2" style={{ left: COL.right, top: 0, width: 210 }}>
        <BandLabel layer="F">기록·입력·상태</BandLabel>
        <div className="grid gap-3 pt-24">
          {outputsFor(scope.name).map((o) => (
            <OutputNode key={o.id} o={o} />
          ))}
        </div>
      </div>
    </NodeGraph>
  );
}

function EmptyComposer() {
  const m = useMock();
  return (
    <NodeGraph aria-label="새 그룹" width={590} height={460} edges={[]}>
      <div className="absolute grid gap-2" style={{ left: COL.left, top: 0, width: 180 }}>
        <BandLabel layer="L1·L2">이 맥락의 기능</BandLabel>
        <div className="grid gap-3 pt-14">
          {providers.map((p) => (
            <ProviderNode key={p.id} p={p} dim />
          ))}
        </div>
      </div>
      <div className="absolute grid gap-2" style={{ left: COL.mid, top: 0, width: 330 }}>
        <BandLabel layer="L3">플러그인 그룹 · 블록 0</BandLabel>
        <GraphNode
          x={0}
          y={0}
          width={330}
          className="relative top-0 left-0"
          title="새 그룹"
          icon={<Layers />}
          variant="soft"
        >
          <Input size="xs" variant="soft" aria-label="그룹 이름" placeholder="lens-review" />
          <p className="m-0 text-ui-xs text-text-tertiary">
            소문자로 시작, 소문자·숫자·하이픈 2~32자
          </p>
        </GraphNode>
        <GraphNode
          x={0}
          y={0}
          width={330}
          className="relative top-0 left-0 mt-1.5 min-h-24 place-content-center justify-items-center text-center"
          title="블록을 여기에 쌓아요"
          variant="ghost"
        >
          <GraphPort portId="drop" side="top" state="off">
            <span className="sr-only">놓을 곳</span>
          </GraphPort>
        </GraphNode>
        <div className="grid gap-1 pt-3">
          <span className="text-ui-xs text-text-tertiary">또는 시작점에서</span>
          <div className="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant="soft"
              iconStart={<Copy />}
              onClick={() => m.set({ group: "lens-review", selected: "drive" })}
            >
              Helm 복제
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => m.notify("drive 템플릿 블록 3개를 쌓았어요")}
            >
              drive 템플릿
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => m.notify("정책 템플릿: 가드 블록 하나")}
            >
              정책
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => m.notify("관찰 템플릿: 신호·기록 블록")}
            >
              관찰
            </Button>
          </div>
        </div>
      </div>
    </NodeGraph>
  );
}

export function GroupCanvas() {
  const m = useMock();
  if (m.group === "new")
    return (
      <CanvasHost width={590} height={460}>
        <EmptyComposer />
      </CanvasHost>
    );
  const invalid = m.group === "lens-review";
  return (
    <>
      {invalid && (
        <div className="px-3 pb-2">
          <Alert tone="danger" variant="soft" size="sm" emphasis="lead">
            <b>검사 3개 실패, 경고 1개.</b> drive 블록 둘 · on 핸들러의 기능 호출 · provider 없는
            requires. 고치기 전에는 코드 만들기와 테스트 실행을 할 수 없어요.
          </Alert>
        </div>
      )}
      <CanvasHost width={W} height={H}>
        {invalid ? (
          <Columns
            blocks={invalidBlocks}
            provs={draftProviders}
            scope={draftScope}
            readOnly={false}
          />
        ) : (
          <Columns blocks={helmBlocks} provs={providers} scope={helmScope} readOnly />
        )}
      </CanvasHost>
    </>
  );
}
