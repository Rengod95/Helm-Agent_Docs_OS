// 포트 정의는 모두 F가 정본이다(F.extensions.spec §3.2.1, F.records.spec §3.9, review.decisions-2 U-14·D-04).
// ext-host는 다시 export만 하고, 자기 정의는 ExtHostPortKey 하나뿐이다.

export type {
  PortKey,
  PortLookup,
  // 루프 (xeon.loop)
  LoopPort,
  // 입력 큐 (xeon.tasks)
  InputQueuePort,
  // 기록 (xeon.session의 ext 속성)
  RecordCommitPort,
  // 확장 투영기 등록 (xeon.session의 projectors 속성)
  ProjectorRegistryPort,
  // 접두 테이블 (xeon.store)
  ScopedStorePort,
  // 프로세스 실행 (xeon.process)
  ProcessPort,
  // 임대 정책 (xeon.groups, 선택)
  LeaseArbiterPort,
} from "@xeon/contracts/extensions";
export {
  LoopPortKey,
  InputQueuePortKey,
  RecordCommitPortKey,
  ProjectorRegistryPortKey,
  ScopedStorePortKey,
  ProcessPortKey,
  LeaseArbiterPortKey,
} from "@xeon/contracts/extensions";

export { ExtHostPortKey } from "./host.ts";
