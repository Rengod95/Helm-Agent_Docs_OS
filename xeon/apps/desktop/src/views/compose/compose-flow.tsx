// 구성기 흐름 보기의 본체(§6.28.2, §6.28.6 S4·S5). 설치 그룹은 읽기 전용으로 보이고, "초안으로 고치기"로 복사한 초안은 같은 그림에서 고친다.
// 넓으면 caustic `NodeGraph` 캔버스, 좁으면(본문 720 이하) `LayerTree` 개요다. 초안은 이 화면의 값이고 "이 초안으로 새 그룹 만들기"로만 나간다.
// 초안이 바뀔 때마다 `ext.validateComposition`으로 다시 검사하고, 이슈는 띠 개수와 줄, 노드 자리에 함께 보인다.
import { t } from "@fresnel/client/i18n";
import {
  compositionWithPhases,
  graphPlacementsOf,
  graphSizeOf,
  GRAPH_NODE_WIDTH,
  issuesByPhaseNodeOf,
  issueSummaryOf,
  runStatesOf,
  type FlowDraft,
  type GraphPlacement,
  type NodeRunState,
  type TabLink,
} from "@fresnel/client/workbench";
import type { CompositionDecl, PhaseNodeDecl } from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import {
  Button,
  NodeGraph,
  NodeGraphNode,
  NodeGraphPort,
  type GraphEdge,
  type GraphNodeState,
} from "@caustic/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { CanvasHost } from "./compose-canvas-host.tsx";
import { CheckBanner, IssueList, useDraftCheck, type CheckRead } from "./compose-check.tsx";
import { FlowEditor } from "./compose-flow-edit.tsx";
import { FlowOutline } from "./compose-outline.tsx";
import { NODE_TEXT } from "./compose-text.ts";
import { useReplayTrial } from "./compose-trial-replay.tsx";
import { TrialBar, trialPhaseOf, useTrialRun } from "./compose-trial.tsx";
import { isCompactWidth, useContainerWidth } from "./compose-width.ts";

const MUTED = "m-0 text-ui text-text-tertiary";
/** 흐름 노드의 겉모양(시안 blockClass와 같은 값): 간격, 안쪽 여백, 제목 글자 역할 */
const NODE_CLASS = "gap-1.5 px-3 py-2.5 [&_[data-slot=node-graph-node-title]]:text-title-3";

export interface FlowWorkspaceProps {
  /** 설치된 구성 선언. 초안을 낼 때 이 값의 나머지(블록)를 그대로 쓴다 */
  readonly composition: CompositionDecl;
  /** 설치된 단계 선언(null이 아니다). 고치기를 시작하면 이 값이 초안이 된다 */
  readonly phases: FlowDraft;
  readonly link: TabLink;
  /** 흐름을 낸 그룹의 이름. 시험 실행은 이 그룹을 시험 대화에서 켠다 */
  readonly name: string;
  /** 설치된 그룹인가. 아니면 시험 실행이 잠긴다 */
  readonly installed: boolean;
  /** 고치는 초안. null이면 설치된 선언을 읽기 전용으로 본다 */
  readonly draft: FlowDraft | null;
  readonly onDraft: (draft: FlowDraft) => void;
  readonly onMake: (composition: CompositionDecl) => void;
}

/** 흐름 보기 한 장. 선택한 노드는 캔버스·개요·속성이 같이 쓴다 */
export function FlowWorkspace(props: FlowWorkspaceProps): ReactNode {
  const { composition, phases, link, name, installed, draft, onDraft, onMake } = props;
  const ref = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(ref);
  const compact = width !== undefined && isCompactWidth(width);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = draft ?? phases;
  const trial = useTrialRun(name, link);
  const replay = useReplayTrial(name, link);
  // 시험 실행 중에만 지금 단계를 강조한다. 단계를 모르면 강조하지 않는다
  const runStates =
    trial.run === null ? undefined : runStatesOf(shown, trialPhaseOf(trial.run.phase));
  // 후보는 초안이 바뀔 때만 새 객체여야 검사가 한 번씩 돈다
  const candidate = useMemo(
    () => (draft === null ? null : compositionWithPhases(composition, draft)),
    [composition, draft],
  );
  const check = useDraftCheck(candidate, link);
  const issues = check.kind === "done" ? check.issues : [];
  const { errors } = issueSummaryOf(issues);
  const byNode = issuesByPhaseNodeOf(shown, issues);
  const canMake = check.kind === "done" && errors === 0 && link === "live";

  return (
    <div ref={ref} className="grid min-w-0 gap-3">
      {/* 흐름 설명은 정보 아이콘 뒤에 둔다(DP-58). 초안이면 머리에 "초안"이라고 흐리게 적는다 */}
      <div className="flex flex-wrap items-center gap-2">
        {draft === null ? null : (
          <span className="text-ui text-text-tertiary">
            {t("desktop.compose.flow.draft.badge")}
          </span>
        )}
        <InfoTip text={t("desktop.compose.flow.boundary")} />
      </div>
      <TrialBar
        link={link}
        installed={installed}
        draft={draft !== null}
        trial={trial}
        replay={replay}
      />
      {draft === null ? (
        <ReadOnlyLine
          onStart={() => {
            onDraft(phases);
          }}
        />
      ) : (
        <DraftLines link={link} check={check} issues={issues} />
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className={compact ? "min-w-0 basis-full" : "min-w-0 flex-1 basis-96"}>
          {compact ? (
            <FlowOutline draft={shown} selected={selected} onSelect={setSelected} />
          ) : (
            <FlowCanvas
              draft={shown}
              selected={selected}
              issues={byNode}
              runStates={runStates}
              onSelect={setSelected}
            />
          )}
        </div>
        {draft === null ? null : (
          <FlowEditor
            draft={draft}
            selected={selected}
            issues={byNode}
            onSelect={setSelected}
            onDraft={onDraft}
          />
        )}
      </div>
      {candidate === null ? null : (
        <DraftActions
          link={link}
          check={check}
          canMake={canMake}
          onMake={() => {
            onMake(candidate);
          }}
          onReset={() => {
            onDraft(phases);
          }}
        />
      )}
    </div>
  );
}

/** 설치 그룹의 머리 줄: 읽기 전용 문장(설명 아이콘 뒤)과 고치기 단추 */
function ReadOnlyLine(props: { readonly onStart: () => void }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="m-0 flex items-center gap-1 text-ui text-text-secondary">
        {t("desktop.compose.flow.readOnly")}
        <InfoTip text={t("desktop.compose.flow.readOnly.info")} />
      </p>
      <Button size="xs" variant="solid" onClick={props.onStart}>
        {t("desktop.compose.flow.draft.start")}
      </Button>
    </div>
  );
}

/** 초안의 검사 띠와 이슈 줄. 연결이 없으면 검사하지 않는다고 말한다 */
function DraftLines(props: {
  readonly link: TabLink;
  readonly check: CheckRead;
  readonly issues: readonly WireManifestIssue[];
}): ReactNode {
  if (props.link !== "live") {
    return <p className={MUTED}>{t("desktop.compose.flow.draft.offline")}</p>;
  }
  return (
    <div className="grid gap-2">
      <CheckBanner check={props.check} />
      <IssueList issues={props.issues} />
    </div>
  );
}

/** 만들기와 되돌리기. 만들기는 검사에서 오류가 없을 때만 열린다 */
function DraftActions(props: {
  readonly link: TabLink;
  readonly check: CheckRead;
  readonly canMake: boolean;
  readonly onMake: () => void;
  readonly onReset: () => void;
}): ReactNode {
  const note =
    props.canMake || props.link !== "live"
      ? null
      : props.check.kind === "loading"
        ? t("desktop.compose.loading")
        : t("desktop.compose.flow.draft.hint");
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
      <Button size="sm" variant="solid" disabled={!props.canMake} onClick={props.onMake}>
        {t("desktop.compose.flow.draft.make")}
      </Button>
      <Button size="sm" variant="outline" onClick={props.onReset}>
        {t("desktop.compose.flow.draft.reset")}
      </Button>
      {note === null ? null : <p className={MUTED}>{note}</p>}
    </div>
  );
}

/**
 * 노드의 그림 상태. 검사 오류가 먼저다. 시험 실행 중이면 지금 단계는 active, 지난 단계는 done(글이 흐려짐),
 * 아직 안 온 단계는 dimmed(반투명)다. 강조할 단계가 없으면(run이 없거나 아무도 active가 아니면) 모두 idle이다.
 */
function nodeStateOf(
  run: ReadonlyMap<string, NodeRunState> | undefined,
  id: string,
  invalid: boolean,
): GraphNodeState {
  if (invalid) return "invalid";
  if (run === undefined) return "idle";
  const mark = run.get(id) ?? "idle";
  if (mark === "active") return "active";
  if (![...run.values()].includes("active")) return "idle";
  return mark === "done" ? "done" : "dimmed";
}

/** 노드 하나의 캔버스 자리: 제목, 종류, 시작 표지, 사람 확인 질문, 검사 상태. 포트는 입력(시작 쪽)과 출력(끝 쪽) 둘이다 */
function FlowNode(props: {
  readonly node: PhaseNodeDecl;
  readonly x: number;
  readonly y: number;
  readonly initial: boolean;
  readonly selected: boolean;
  readonly issues: readonly WireManifestIssue[];
  readonly runStates: ReadonlyMap<string, NodeRunState> | undefined;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { node } = props;
  const invalid = props.issues.some((issue) => issue.severity === "error");
  const warned = !invalid && props.issues.length > 0;
  return (
    <NodeGraphNode
      x={props.x}
      y={props.y}
      width={GRAPH_NODE_WIDTH}
      // 시안의 블록 노드 겉모양: 간격과 제목 글자(text-title-3)만 준다
      className={NODE_CLASS}
      title={node.title ?? node.id}
      meta={t(NODE_TEXT[node.kind])}
      state={nodeStateOf(props.runStates, node.id, invalid)}
      selected={props.selected}
      aria-current={props.selected ? "true" : undefined}
      onClick={() => {
        props.onSelect(node.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect(node.id);
        }
      }}
    >
      <NodeGraphPort portId={`${node.id}:in`} side="top" state="connected" />
      <div className="grid gap-1">
        {props.initial ? (
          <span className="text-ui text-text-tertiary">{t("desktop.compose.flow.initial")}</span>
        ) : null}
        {node.kind === "human" && node.askTitle !== undefined ? (
          <span className="text-ui text-text-secondary">{node.askTitle}</span>
        ) : null}
        {invalid ? (
          <span className="text-ui text-danger-text">{t("desktop.compose.flow.node.invalid")}</span>
        ) : null}
        {warned ? (
          <span className="text-ui text-warning-text">
            {t("desktop.compose.flow.node.warning")}
          </span>
        ) : null}
      </div>
      <NodeGraphPort portId={`${node.id}:out`} side="bottom" state="connected" />
    </NodeGraphNode>
  );
}

/**
 * 캔버스의 선: 같은 두 노드 사이의 전이는 선 하나로 모은다. 이름표는 달지 않는다(시안 wb-compose: 선 = 전이, 이름표 없음). 같은 두 노드 사이의
 * 전이 여럿은 선이 겹치고, 이벤트 이름은 개요와 속성 칸이 보인다. 이름표가 겹쳐 읽히지 않게 하려고 캔버스에서 뺀다
 */
export function canvasEdgesOf(draft: FlowDraft): GraphEdge[] {
  // 같은 두 노드를 잇는 전이가 여럿이어도 선은 하나다(캔버스가 선을 `from>to` 키로 그려 겹치면 키가 겹치고 선이 굵어진다)
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of draft.transitions) {
    const key = `${edge.from}>${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: `${edge.from}:out`, to: `${edge.to}:in` });
  }
  return edges;
}

/** 흐름 캔버스. 자리는 `graphPlacementsOf`(시작에서 전이를 따른 깊이가 열), 선은 `canvasEdgesOf`다. `runStates`가 있으면 시험 실행의 단계 강조를 그린다 */
export function FlowCanvas(props: {
  readonly draft: FlowDraft;
  readonly selected: string | null;
  readonly issues: ReadonlyMap<string, readonly WireManifestIssue[]>;
  readonly runStates?: ReadonlyMap<string, NodeRunState> | undefined;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { draft } = props;
  const places = graphPlacementsOf(draft);
  const size = graphSizeOf(places);
  const placeOf = new Map(places.map((place): [string, GraphPlacement] => [place.id, place]));
  const edges = canvasEdgesOf(draft);
  return (
    <CanvasHost width={size.width} height={size.height}>
      <NodeGraph
        aria-label={t("desktop.compose.flow.canvas.label")}
        width={size.width}
        height={size.height}
        edges={edges}
      >
        {draft.nodes.flatMap((node) => {
          const place = placeOf.get(node.id);
          if (place === undefined) return [];
          return [
            <FlowNode
              key={node.id}
              node={node}
              x={place.x}
              y={place.y}
              initial={node.id === draft.initial}
              selected={props.selected === node.id}
              issues={props.issues.get(node.id) ?? []}
              runStates={props.runStates}
              onSelect={props.onSelect}
            />,
          ];
        })}
      </NodeGraph>
    </CanvasHost>
  );
}
