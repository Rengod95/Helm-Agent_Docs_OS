import { createBoundedList, DEFAULT_DIAGNOSTICS_CAP } from "@xeon/platform-os";
import type { ExtDiagnostic } from "@xeon/ext-host";

// L0.os.spec §3.14, M3-REQ-52. 확장 진단 배열은 상한이 있다(L4 쪽 적용). 넘으면 가장 오래된 진단부터 버리고 버린 수를 센다.

/** 확장 진단 모음. 상한을 넘으면 오래된 것부터 버린다 */
export interface ExtDiagnosticSink {
  push(diagnostic: ExtDiagnostic): void;
  /** 남은 진단, 오래된 것이 앞이다 */
  items(): readonly ExtDiagnostic[];
  /** 상한 때문에 버린 진단 수 */
  dropped(): number;
}

/** 확장 진단 모음을 만든다. 상한은 `DEFAULT_DIAGNOSTICS_CAP`(256)이 기본이다 */
export function createExtDiagnosticSink(cap: number = DEFAULT_DIAGNOSTICS_CAP): ExtDiagnosticSink {
  const list = createBoundedList<ExtDiagnostic>(cap);
  return {
    push: (diagnostic) => {
      list.push(diagnostic);
    },
    items: () => list.items(),
    dropped: () => list.dropped(),
  };
}
