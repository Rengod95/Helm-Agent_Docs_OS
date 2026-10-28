import { createHash, timingSafeEqual } from "node:crypto";

// L0.process.spec §3.2 service/auth.ts, §4.4.5. 토큰은 32바이트 무작위(주입), base64url 패딩 없음.
// Unix 소켓은 파일 권한(0600)이 막으므로 토큰을 검사하지 않는다. TCP로 열 때만 `host.hello`의 `auth.token`을 검사한다(M3-REQ-43).
// 토큰은 로그와 오류에 싣지 않는다.

/** 상수 시간 비교. 길이가 달라도 같은 시간이 걸리도록 두 값을 SHA-256으로 접은 뒤 비교한다 */
export function verifyToken(expected: string, presented: unknown): boolean {
  if (typeof presented !== "string") return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

export function newServiceToken(random: (bytes: number) => Uint8Array): string {
  return Buffer.from(random(32)).toString("base64url");
}

/** 토큰 회전을 지원하는 검사 창구. 회전하면 이전 토큰은 즉시 무효가 되고 이미 열린 연결은 영향이 없다 */
export interface TokenGate {
  /** 지금 유효한 토큰. 등록 파일에 쓰는 쪽이 부른다 */
  current(): string;
  verify(presented: unknown): boolean;
  /**
   * 새 토큰을 만든다. `persist`가 있으면 토큰을 바꾸기 전에 불러 등록 파일에 쓰고, 거짓이면 바꾸지 않고 undefined를 돌려준다
   */
  rotate(persist?: (next: string) => boolean): string | undefined;
}

export function createTokenGate(random: (bytes: number) => Uint8Array): TokenGate {
  let token = newServiceToken(random);
  return {
    current: () => token,
    verify: (presented) => verifyToken(token, presented),
    rotate(persist) {
      const next = newServiceToken(random);
      if (persist !== undefined && !persist(next)) return undefined;
      token = next;
      return next;
    },
  };
}
