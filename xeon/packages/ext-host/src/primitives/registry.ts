import type {
  ExtensionManifest,
  ExtensionName,
  PointName,
  ScopeId,
} from "@xeon/contracts/extensions";

/** 정책이 보는 핸들러 항목의 읽기 전용 모습(X.primitives.spec §3.4) */
export interface HandlerEntryInfo {
  readonly point: PointName;
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  readonly layer: ExtensionManifest["layer"];
  readonly builtin: boolean;
  readonly loadIndex: number;
  /** 레지스트리 등록 순번. ExtHost 전체에서 단조 증가 */
  readonly seq: number;
}

/** 레지스트리의 한 행 */
export interface HandlerEntry extends HandlerEntryInfo {
  /** 핸들러 함수. 인자는 지점 fold가 정한다 */
  readonly fn: (...args: readonly unknown[]) => unknown;
  /** 이 항목이 속한 scope 세대가 열려 있는가. 닫힌 세대의 항목은 스냅샷에서 빠진다 */
  readonly isOpen: () => boolean;
  /** 세대가 닫히면 중단되는 신호. 핸들러 ctx.signal의 부모다 */
  readonly signal: AbortSignal;
}

export interface HandlerRegistry {
  /** 항목을 더하고 멱등 해제기를 돌려준다 */
  add(entry: HandlerEntry): () => void;
  /** 등록 순번을 하나 발급한다 */
  nextSeq(): number;
  /**
   * 디스패치 시작 때 부른다. 세대가 열린 항목만 복사해 고정한다.
   * 디스패치 도중의 add·remove·세대 변화는 이 배열에 반영되지 않는다.
   */
  snapshot(point: PointName): readonly HandlerEntry[];
  /** 항목 수. 테스트와 진단용 */
  size(point?: PointName): number;
}

export function createHandlerRegistry(): HandlerRegistry {
  const byPoint = new Map<PointName, HandlerEntry[]>();
  let seq = 0;
  return {
    nextSeq() {
      seq += 1;
      return seq;
    },
    add(entry) {
      const list = byPoint.get(entry.point) ?? [];
      list.push(entry);
      byPoint.set(entry.point, list);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const current = byPoint.get(entry.point);
        if (current === undefined) return;
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) byPoint.delete(entry.point);
      };
    },
    snapshot(point) {
      return (byPoint.get(point) ?? []).filter((entry) => entry.isOpen());
    },
    size(point) {
      if (point !== undefined) return byPoint.get(point)?.length ?? 0;
      let total = 0;
      for (const list of byPoint.values()) total += list.length;
      return total;
    },
  };
}
