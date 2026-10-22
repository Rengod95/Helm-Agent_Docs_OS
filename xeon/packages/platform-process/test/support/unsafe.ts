import type { JsonRpcMessage } from "@xeon/contracts/wire";

// 시험의 타입 어김 주입기. 이 파일이 platform-process 시험에서 단언이 있는 유일한 곳이다(eng.typescript.guide TY-06 허용 목록 A6).

/** 규칙을 어긴 프레임을 일부러 보내는 시험 도구다. 서버가 envelope 검사로 거부해야 한다(eng.testing.guide TS-04) */
export function asFrame(frame: unknown): JsonRpcMessage {
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 계약 위반 주입: 잘못된 프레임 (eng.typescript.guide TY-06)
  return frame as JsonRpcMessage;
}
