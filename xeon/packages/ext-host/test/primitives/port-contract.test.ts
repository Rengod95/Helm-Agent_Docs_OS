import {
  memoryInputQueue,
  memoryLoopPort,
  memoryRecordStore,
  runPortContract,
} from "../../src/testing/index.ts";

// 인메모리 대역이 L1 구현과 같은 계약 시나리오를 통과해야 한다
runPortContract("in-memory ports", {
  loop: () => memoryLoopPort(),
  queue: () => memoryInputQueue(),
  records: () => memoryRecordStore(),
});
