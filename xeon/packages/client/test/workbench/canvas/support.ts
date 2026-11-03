import { buildFixture } from "../../../src/workbench/canvas/fixture.ts";
import type { CanvasPlugin, CanvasSnapshot } from "../../../src/workbench/canvas/types.ts";

// 시안의 18개 확장만 담은 스냅샷(buildFixture의 앞부분)
export const MOCK: CanvasSnapshot = buildFixture(18);

/** id의 플러그인. 스냅샷에 없으면 시험이 실패한다 */
export function plugin(snap: CanvasSnapshot, id: string): CanvasPlugin {
  const found = snap.plugins.find((p) => p.id === id);
  if (found === undefined) throw new Error(`snapshot has no plugin ${id}`);
  return found;
}
