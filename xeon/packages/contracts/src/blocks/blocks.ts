import {
  HOOK_POSITIONS,
  type BlockId,
  type BoundaryId,
  type HookPosition,
} from "../extensions/hook-positions.ts";
import { HOOK_NAMES, type HookName } from "../extensions/hooks.ts";
import { BLOCK_SPECS, BOUNDARY_SPECS } from "./data.ts";
import type { BlockDescription, BlockModel, BoundaryDescription } from "./types.ts";

// 블록 모델 값(M5e 스펙 §4.8). 훅 목록(before, after, events)과 경계의 훅은 HOOK_POSITIONS에서 파생한다.
// 파생 규칙: 블록 앞·뒤는 같은 블록의 `block` 위치, 이벤트는 닻(`anchor`)의 블록이 같은 것이다.
// 닻이 없는 이벤트는 기록 블록의 구독이다. 그래서 기록 블록의 before·after는 빈 배열이고 events만 있다.

/** 조건에 맞는 훅 이름을 HOOK_NAMES 순서로 모은다 */
function namesWhere(predicate: (position: HookPosition) => boolean): HookName[] {
  return HOOK_NAMES.filter((name) => HOOK_POSITIONS[name].positions.some(predicate));
}

function hooksOfBlock(block: BlockId): BlockDescription["hooks"] {
  return {
    before: namesWhere((p) => p.kind === "block" && p.block === block && p.side === "before"),
    after: namesWhere((p) => p.kind === "block" && p.block === block && p.side === "after"),
    events: namesWhere((p) => {
      if (p.kind !== "event") return false;
      return p.anchor === undefined ? block === "record" : p.anchor.block === block;
    }),
  };
}

function hooksOfBoundary(boundary: BoundaryId): HookName[] {
  return namesWhere((p) => p.kind === "boundary" && p.boundary === boundary);
}

function describeBlocks(): BlockDescription[] {
  const blocks: BlockDescription[] = [];
  for (const spec of BLOCK_SPECS) blocks.push({ ...spec, hooks: hooksOfBlock(spec.id) });
  return blocks;
}

function describeBoundaries(): BoundaryDescription[] {
  const boundaries: BoundaryDescription[] = [];
  for (const spec of BOUNDARY_SPECS) boundaries.push({ ...spec, hooks: hooksOfBoundary(spec.id) });
  return boundaries;
}

/** 블록 모델. 순수 상수다(실행 시 HOOK_POSITIONS에서 한 번 계산한다) */
export const BLOCK_MODEL: BlockModel = {
  version: 1,
  blocks: describeBlocks(),
  boundaries: describeBoundaries(),
  positions: HOOK_NAMES.map((name) => HOOK_POSITIONS[name]),
};
