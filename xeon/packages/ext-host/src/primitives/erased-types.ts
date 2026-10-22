import type { LoopHandle } from "@xeon/contracts/extensions";

// 타입 지움 자리의 이름. core.ts와 erase.ts가 함께 쓰므로 어느 쪽도 import하지 않는 잎 파일에 둔다(순환 방지).

/** 상태 타입 S를 지운 자리. 호스트 안에서만 쓴다. 문서는 StateDecl.schema 검사를 거친다 */
export type AnyState = Readonly<Record<string, unknown>>;

/** 등록된 drive 함수. 상태 타입을 지운 모양 */
export type DriveCall = (loop: LoopHandle, state: unknown) => Promise<void>;
