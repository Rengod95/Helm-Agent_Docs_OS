import { err, ok } from "@xeon/contracts";
import type { SecretValueSource } from "@xeon/contracts/services";

export interface TrackedSource extends SecretValueSource {
  /** 지금까지 넘겨 준 버퍼. 서비스가 쓴 뒤 0으로 덮었는지 확인한다 */
  readonly issued: Uint8Array[];
  reads(): number;
}

/** 읽을 때마다 새 버퍼를 넘기는 값 통로. 테스트가 만든 가짜 값만 넣는다 */
export function trackedSource(text: string): TrackedSource {
  const issued: Uint8Array[] = [];
  return {
    issued,
    reads: () => issued.length,
    read() {
      const bytes = new TextEncoder().encode(text);
      issued.push(bytes);
      return Promise.resolve(ok(bytes));
    },
  };
}

export function cancelledSource(kind: "input_cancelled" | "input_empty"): SecretValueSource {
  return { read: () => Promise.resolve(err({ kind })) };
}

export function allZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}
