import { canonicalJson } from "@xeon/contracts";

/** 모델 요청 컨텍스트의 해시. 같은 커밋된 이벤트에서 조립했으면 같은 값이다(eng.testing.guide TS-04 contextHash) */
export function contextHash(messages: unknown): string {
  return new Bun.CryptoHasher("sha256").update(canonicalJson(messages)).digest("hex");
}
