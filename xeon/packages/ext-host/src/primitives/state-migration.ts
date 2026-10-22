import type { JsonValue } from "@xeon/contracts/conversation";

/** 저장된 상태 문서를 현재 `StateDecl.version`의 모양으로 옮긴다. 순수 함수여야 한다(X.primitives.spec §4.6.1) */
export type StateMigration = (doc: JsonValue, fromVersion: number) => JsonValue;
