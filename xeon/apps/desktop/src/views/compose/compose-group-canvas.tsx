// 그룹 보기의 블록 캔버스(시안 wb-compose `screens/group.tsx`의 GroupCanvas, `parts/blocks.tsx`). 왼쪽 열에 블록, 오른쪽 열에 블록이 내는 것
// (공개 기록, 입력 큐, 상태 문서)을 caustic NodeGraph 위에 둔다. 선은 고른 블록의 것만 그린다. 시안의 왼쪽 "이 맥락의 기능" 열은
// 선언에 제공자 정보가 없어 두지 않고, 블록이 읽는 기능은 블록 안의 입력 포트 글로 보인다.
// 노드에는 이름과 포트, 검사 문장만 둔다. 훅·연산·단계 이름은 시안에 없어 그리지 않는다.
import { t } from "@fresnel/client/i18n";
import type { BlockRow, ProductText } from "@fresnel/client/workbench";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import {
  NodeGraph,
  NodeGraphNode,
  NodeGraphPort,
  SectionHeader,
  type GraphEdge,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { CanvasHost } from "./compose-canvas-host.tsx";
import { PRODUCT_TEXT } from "./compose-text.ts";
import { issueTextOf } from "./compose-wire-text.ts";

const BLOCK_X = 0;
const BLOCK_WIDTH = 330;
const OUT_X = 460;
const OUT_WIDTH = 210;
const HEAD_HEIGHT = 36;
const GAP = 12;
const NODE_CLASS =
  "relative top-0 left-0 gap-1.5 px-3 py-2.5 [&_[data-slot=node-graph-node-title]]:text-title-3";

/** 블록이 내는 것의 포트 키. 같은 종류·기록 종류는 오른쪽 열의 한 포트로 모인다 */
function productKeyOf(product: BlockRow["produces"][number]): string {
  return `${product.kind}:${product.recordKind ?? ""}`;
}

function productLabelOf(product: BlockRow["produces"][number]): string {
  return `${t(PRODUCT_TEXT[product.kind])}${product.recordKind === null ? "" : ` ${product.recordKind}`}`;
}

/** 오른쪽 열의 노드: 종류(기록·입력 큐·상태 문서)마다 하나, 포트는 기록 종류마다 하나. 종류 순서는 기록, 입력 큐, 상태 문서다 */
export interface OutputGroup {
  readonly kind: ProductText;
  readonly ports: readonly { readonly key: string; readonly label: string }[];
}

const KIND_ORDER: readonly ProductText[] = ["record", "post", "state"];

export function outputGroupsOf(rows: readonly BlockRow[]): readonly OutputGroup[] {
  const seen = new Map<string, { kind: ProductText; label: string }>();
  for (const row of rows) {
    for (const product of row.produces) {
      const key = productKeyOf(product);
      if (!seen.has(key)) seen.set(key, { kind: product.kind, label: productLabelOf(product) });
    }
  }
  return KIND_ORDER.flatMap((kind) => {
    const ports = [...seen.entries()]
      .filter(([, value]) => value.kind === kind)
      .map(([key, value]) => ({ key, label: value.label }));
    return ports.length === 0 ? [] : [{ kind, ports }];
  });
}

/** 선은 고른 블록의 것만: 블록이 내는 것마다 오른쪽 포트로 한 줄이다 */
export function groupEdgesOf(rows: readonly BlockRow[], selected: string | null): GraphEdge[] {
  const row = rows.find((candidate) => candidate.id === selected);
  if (row === undefined) return [];
  return row.produces.map((product) => ({
    from: `${row.id}:out:${productKeyOf(product)}`,
    to: `out:${productKeyOf(product)}`,
  }));
}

function blockHeight(row: BlockRow, issues: number): number {
  const ports = Math.max(row.consumes.length, row.produces.length);
  return 44 + ports * 24 + issues * 20;
}

function BlockNode(props: {
  readonly row: BlockRow;
  readonly issues: readonly WireManifestIssue[];
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  const { row, issues } = props;
  const invalid = issues.some((issue) => issue.severity === "error");
  return (
    <NodeGraphNode
      x={0}
      y={0}
      width={BLOCK_WIDTH}
      className={NODE_CLASS}
      title={row.title}
      state={invalid ? "invalid" : "idle"}
      selected={props.selected}
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
    >
      {row.consumes.length === 0 && row.produces.length === 0 ? null : (
        <div className="grid grid-cols-2 gap-x-3">
          <div className="grid content-start">
            {row.consumes.map((id) => (
              <NodeGraphPort key={id} portId={`${row.id}:in:${id}`} state="connected">
                <span className="truncate">{id}</span>
              </NodeGraphPort>
            ))}
          </div>
          <div className="grid content-start">
            {row.produces.map((product) => (
              <NodeGraphPort
                key={productKeyOf(product)}
                portId={`${row.id}:out:${productKeyOf(product)}`}
                side="end"
                state="connected"
              >
                <span className="truncate">{productLabelOf(product)}</span>
              </NodeGraphPort>
            ))}
          </div>
        </div>
      )}
      {issues.map((issue) => (
        <p
          key={`${issue.code}:${issue.path}`}
          role="alert"
          className={`m-0 text-footnote ${issue.severity === "error" ? "text-danger-text" : "text-warning-text"}`}
        >
          <span className="font-mono">{issue.code}</span> {issueTextOf(issue)}
        </p>
      ))}
    </NodeGraphNode>
  );
}

function OutputNode(props: { readonly group: OutputGroup }): ReactNode {
  return (
    <NodeGraphNode
      x={0}
      y={0}
      width={OUT_WIDTH}
      className={NODE_CLASS}
      title={t(PRODUCT_TEXT[props.group.kind])}
    >
      {props.group.ports.map((port) => (
        <NodeGraphPort key={port.key} portId={`out:${port.key}`} state="connected">
          <span className="truncate">{port.label}</span>
        </NodeGraphPort>
      ))}
    </NodeGraphNode>
  );
}

/** 블록 캔버스. 블록 칸을 누르면 그 블록의 선이 나타난다 */
export function GroupCanvas(props: {
  readonly rows: readonly BlockRow[];
  readonly issuesByBlock: ReadonlyMap<string, readonly WireManifestIssue[]>;
}): ReactNode {
  const { rows } = props;
  // 시안은 첫 블록을 고른 채로 열어 그 블록의 연결선이 처음부터 보인다
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? rows[0]?.id ?? null;
  const groups = outputGroupsOf(rows);
  const blocksHeight =
    HEAD_HEIGHT +
    rows.reduce(
      (sum, row) => sum + blockHeight(row, (props.issuesByBlock.get(row.id) ?? []).length) + GAP,
      0,
    );
  const outHeight =
    HEAD_HEIGHT + groups.reduce((sum, g) => sum + 44 + g.ports.length * 24 + GAP, 0);
  const height = Math.max(blocksHeight, outHeight, 240);
  const width = OUT_X + OUT_WIDTH;
  return (
    <CanvasHost width={width} height={height}>
      <NodeGraph
        aria-label={t("desktop.compose.blocks")}
        width={width}
        height={height}
        edges={groupEdgesOf(rows, selected)}
      >
        <div className="absolute grid gap-4" style={{ left: BLOCK_X, top: 0, width: BLOCK_WIDTH }}>
          <SectionHeader size="sm" headingLevel={3} title={t("desktop.compose.blocks")} />
          <div className="grid gap-3">
            {rows.map((row) => (
              <BlockNode
                key={row.id}
                row={row}
                issues={props.issuesByBlock.get(row.id) ?? []}
                selected={selected === row.id}
                onSelect={() => {
                  setPicked(row.id);
                }}
              />
            ))}
          </div>
        </div>
        <div className="absolute grid gap-4" style={{ left: OUT_X, top: 0, width: OUT_WIDTH }}>
          <SectionHeader size="sm" headingLevel={3} title={t("desktop.compose.group.outputs")} />
          <div className="grid gap-3">
            {groups.map((group) => (
              <OutputNode key={group.kind} group={group} />
            ))}
          </div>
        </div>
      </NodeGraph>
    </CanvasHost>
  );
}
