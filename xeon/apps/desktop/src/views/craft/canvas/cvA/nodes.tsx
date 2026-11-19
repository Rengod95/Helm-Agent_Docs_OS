// cvA 프로필 캔버스의 React Flow 노드: 플러그인(종류마다 판 모양이 다르다), 접힌 묶음, 열린 묶음의 틀, 장면(레일·선·자리).
// 노드는 React Flow의 끌기를 쓰지 않는다(위치가 뜻이라 자유 배치가 아니다). 끌기는 순서 바꾸기·빼기로, 캔버스가 받는다.
import { t } from "@fresnel/client/i18n";
import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import {
  createContext,
  use,
  type Context,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { KIND_INK, KindGlyph } from "./glyphs.tsx";
import { NODE_H, NODE_W, type FrameGeo, type ProfileLayout, type SlotGeo } from "./layout.ts";
import type { Kind, PluginSpec } from "./model.ts";
import { Plate, Reticle } from "./plate.tsx";
import { Scene } from "./scene.tsx";
import { metaOf } from "./words.ts";

/** 노드가 캔버스에 알리는 일. 노드마다 함수를 새로 만들지 않으려고 문맥으로 준다 */
export interface CanvasActions {
  pointerDown(id: string, e: PointerEvent<HTMLElement>): void;
  select(id: string | null): void;
  open(id: string): void;
  toggleGroup(group: string): void;
  key(id: string, e: KeyboardEvent<HTMLElement>): void;
}

const NOOP: CanvasActions = {
  pointerDown: () => undefined,
  select: () => undefined,
  open: () => undefined,
  toggleGroup: () => undefined,
  key: () => undefined,
};

export const CanvasActionsContext: Context<CanvasActions> = createContext<CanvasActions>(NOOP);

interface PluginNodeData extends Record<string, unknown> {
  readonly spec: PluginSpec;
  readonly base: boolean;
  readonly start: boolean;
  readonly receives: boolean;
  readonly selected: boolean;
  readonly dim: boolean;
}

interface GroupNodeData extends Record<string, unknown> {
  readonly group: string;
  readonly name: string;
  readonly kinds: readonly Kind[];
  readonly count: number;
  readonly selected: boolean;
  readonly dim: boolean;
}

interface FrameNodeData extends Record<string, unknown> {
  readonly frame: FrameGeo;
  readonly name: string;
}

interface SceneNodeData extends Record<string, unknown> {
  readonly layout: ProfileLayout;
  readonly lit: ReadonlySet<string>;
  readonly slots: readonly SlotGeo[];
  readonly hot: SlotGeo | null;
  readonly carryKind: Kind | null;
}

type PluginFlowNode = Node<PluginNodeData, "plugin">;
type GroupFlowNode = Node<GroupNodeData, "group">;
type FrameFlowNode = Node<FrameNodeData, "frame">;
type SceneFlowNode = Node<SceneNodeData, "scene">;
export type CanvasNode = PluginFlowNode | GroupFlowNode | FrameFlowNode | SceneFlowNode;

/** 판 오른쪽 위의 상태 꼬리표(베이스·드래프트). 글은 11px, 3차 잉크 */
function Tag(props: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="cva-mono shrink-0 text-[11px] leading-none text-text-tertiary">
      {props.children}
    </span>
  );
}

function PluginNode(props: NodeProps<PluginFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { spec, base, start, receives, selected, dim } = props.data;
  const meta = metaOf(spec, start, receives);
  return (
    <div
      className="cva-node nodrag nopan relative select-none"
      data-selected={selected}
      data-draft={spec.draft === true}
      data-dim={dim}
      data-kind={spec.kind}
      style={{ width: NODE_W, height: NODE_H }}
      onPointerDown={(e) => {
        actions.pointerDown(spec.name, e);
      }}
      onDoubleClick={() => {
        actions.open(spec.name);
      }}
    >
      <Plate shape={spec.kind} w={NODE_W} h={NODE_H} base={base} />
      {selected ? <Reticle w={NODE_W} h={NODE_H} /> : null}
      <div
        className={`relative flex h-full flex-col justify-center gap-1 pe-3 ${base ? "ps-[15px]" : "ps-3"}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span style={{ color: KIND_INK[spec.kind] }} className="flex">
            <KindGlyph kind={spec.kind} size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-text-primary">
            {spec.name}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 ps-[23px]">
          <span className="cva-mono min-w-0 flex-1 truncate text-[11px] leading-none text-text-secondary">
            {meta}
          </span>
          {spec.draft === true ? (
            <Tag>{t("desktop.craft.canvas.cvA.mark.draft")}</Tag>
          ) : base ? (
            <Tag>{t("desktop.craft.canvas.cvA.mark.base")}</Tag>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GroupNode(props: NodeProps<GroupFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { group, name, kinds, count, selected, dim } = props.data;
  const id = `group:${group}`;
  return (
    <div
      className="cva-node nodrag nopan relative select-none"
      data-selected={selected}
      data-dim={dim}
      data-kind="group"
      style={{ width: NODE_W, height: NODE_H }}
      onPointerDown={(e) => {
        actions.pointerDown(id, e);
      }}
      onDoubleClick={() => {
        actions.toggleGroup(group);
      }}
    >
      <Plate shape="group" w={NODE_W} h={NODE_H} stacked />
      {selected ? <Reticle w={NODE_W} h={NODE_H} /> : null}
      <div className="relative flex h-full items-center gap-2.5 ps-3 pe-2">
        <span className="flex -space-x-1">
          {kinds.map((k) => (
            <span key={k} style={{ color: KIND_INK[k] }} className="flex">
              <KindGlyph kind={k} size={13} />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
          {name}
        </span>
        <span className="cva-mono text-[11px] text-text-tertiary">{String(count)}</span>
        <button
          type="button"
          className="cva-row flex size-6 items-center justify-center text-text-secondary"
          aria-label={t("desktop.craft.canvas.cvA.group.open", { name })}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={() => {
            actions.toggleGroup(group);
          }}
        >
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** 열린 묶음: 구성원을 둘러싼 네 귀퉁이 꺾쇠와 위 왼쪽 이름 탭(접기 단추) */
function FrameNode(props: NodeProps<FrameFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { frame, name } = props.data;
  const { w, h } = frame;
  const a = 16;
  return (
    <div className="pointer-events-none relative" style={{ width: w, height: h }}>
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={w} height={h}>
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="color-mix(in oklab, var(--cs-color-text-primary) 4%, transparent)"
        />
        <path
          d={`M0 ${a}V0H${a}M${w - a} 0H${w}V${a}M${w} ${h - a}V${h}H${w - a}M${a} ${h}H0V${h - a}`}
          fill="none"
          stroke="var(--cva-line-hot)"
          strokeWidth={1.25}
        />
        <path
          d={`M${a + 8} 0H${w - a - 8}M${a + 8} ${h}H${w - a - 8}M0 ${a + 8}V${h - a - 8}M${w} ${a + 8}V${h - a - 8}`}
          fill="none"
          stroke="var(--cva-line-soft)"
          strokeDasharray="1 5"
        />
      </svg>
      <button
        type="button"
        className="cva-row nodrag nopan pointer-events-auto absolute top-1.5 left-2.5 flex h-6 items-center gap-1.5 px-1.5 text-[12px] font-medium text-text-primary"
        aria-label={t("desktop.craft.canvas.cvA.group.close", { name })}
        onClick={() => {
          actions.toggleGroup(frame.group);
        }}
      >
        <span>{name}</span>
        <span className="cva-mono text-[11px] text-text-tertiary">
          {String(frame.members.length)}
        </span>
        <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="text-text-tertiary">
          <path d="M2 7.5 6 4l4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}

function SceneNode(props: NodeProps<SceneFlowNode>): ReactNode {
  return <Scene {...props.data} />;
}

export const NODE_TYPES: NodeTypes = {
  plugin: PluginNode,
  group: GroupNode,
  frame: FrameNode,
  scene: SceneNode,
};
