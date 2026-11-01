import type { GroupId } from "@xeon/contracts/extensions";
import type { GroupMetricsHandle } from "./types.ts";

/** 그룹 계측 핸들의 등록부. wrap이 그룹마다 등록하고 createGroupService가 `GroupStatus.metrics`에 읽는다 */
export interface MetricsRegistry {
  /** 같은 그룹 이름으로 다시 등록하면 새 핸들이 옛 핸들을 대신한다 */
  register(groupId: GroupId, handle: GroupMetricsHandle): void;
  /** 등록된 그룹의 핸들. 아직 설정되지 않은 그룹이면 undefined */
  get(groupId: GroupId): GroupMetricsHandle | undefined;
  /** 모두 지운다. 시험이 그룹 사이의 값을 섞지 않게 할 때 쓴다 */
  reset(): void;
}

export function createMetricsRegistry(): MetricsRegistry {
  const handles = new Map<GroupId, GroupMetricsHandle>();
  return {
    register(groupId, handle) {
      handles.set(groupId, handle);
    },
    get(groupId) {
      return handles.get(groupId);
    },
    reset() {
      handles.clear();
    },
  };
}

/** 프로세스 안의 기본 등록부. 호스트 쪽 배선 없이 wrap과 createGroupService가 이 값을 쓴다 [결정: 오케스트레이터 기본값] */
export const defaultMetricsRegistry: MetricsRegistry = createMetricsRegistry();
