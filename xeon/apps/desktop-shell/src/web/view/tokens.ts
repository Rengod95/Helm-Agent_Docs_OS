// 플러그인 프레임의 권한 토큰(L4.remote.spec §6.3). 탭 연결 하나에 묶인 짧은 수명의 무작위 값이다.
// 프레임의 하위 자원 요청이 쿠키 없이도 되도록 경로로만 인증한다. 토큰 원문은 저장하지 않고 SHA-256만 키로 둔다(메모리뿐이다).
// 토큰은 그 탭의 app root 목록 하나를 가리킨다. 다른 탭의 목록은 보지 못하고, 탭이 닫히면 그 탭의 토큰이 모두 사라진다.
import { createHash } from "node:crypto";
import type { Clock } from "@fresnel/contracts";
import type { AppRoots } from "../../main/view-scheme.ts";

/** 권한 토큰의 수명(1시간). 쓸 때마다 지금부터 1시간으로 갱신된다(프레임이 열려 있는 동안 하위 자원을 계속 받는다) */
export const VIEW_TOKEN_TTL_MS: number = 60 * 60 * 1000;
/** 갱신해도 발급 시각에서 이 시간(12시간)을 넘기지 못한다. 그 뒤에는 프레임을 다시 그려 새 토큰을 받는다 */
export const VIEW_TOKEN_MAX_AGE_MS: number = 12 * 60 * 60 * 1000;
/** 탭 하나가 동시에 쥘 수 있는 토큰 수. 넘으면 오래된 것부터 지운다 */
export const MAX_VIEW_TOKENS_PER_TAB = 16;
/** 토큰의 글자 모양: 32바이트의 base64url(패딩 없음) */
const VIEW_TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

interface IssuedViewToken {
  readonly token: string;
  /** 만료 시각(ms) */
  readonly expiresAt: number;
}

export interface ViewTokens {
  /** 탭 `tabId`의 root 목록에 묶인 새 토큰을 낸다 */
  issue(tabId: string, roots: AppRoots): IssuedViewToken;
  /** 토큰이 가리키는 root 목록(부르면 만료가 갱신된다). 모르는 토큰, 모양이 틀린 토큰, 만료된 토큰은 `undefined`다 */
  lookup(token: string): AppRoots | undefined;
  /** 탭이 닫혔다. 그 탭의 토큰을 모두 지운다 */
  revokeTab(tabId: string): void;
}

interface Entry {
  readonly tabId: string;
  readonly roots: AppRoots;
  readonly issuedAt: number;
  expiresAt: number;
}

export interface ViewTokensOptions {
  readonly clock: Clock;
  /** 무작위 바이트. 시험이 정해진 값을 넣는다 */
  readonly random?: (length: number) => Uint8Array;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createViewTokens(options: ViewTokensOptions): ViewTokens {
  const { clock } = options;
  const random = options.random ?? randomBytes;
  // 삽입 순서가 곧 발급 순서다(오래된 것부터 지울 때 쓴다)
  const entries = new Map<string, Entry>();

  function sweep(): void {
    const now = clock.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  }

  return {
    issue(tabId, roots) {
      sweep();
      const token = Buffer.from(random(32)).toString("base64url");
      const owned = [...entries].filter(([, entry]) => entry.tabId === tabId);
      for (const [key] of owned.slice(0, Math.max(0, owned.length - MAX_VIEW_TOKENS_PER_TAB + 1))) {
        entries.delete(key);
      }
      const issuedAt = clock.now();
      const expiresAt = issuedAt + VIEW_TOKEN_TTL_MS;
      entries.set(digestOf(token), { tabId, roots, issuedAt, expiresAt });
      return { token, expiresAt };
    },
    lookup(token) {
      if (!VIEW_TOKEN_PATTERN.test(token)) return undefined;
      const key = digestOf(token);
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= clock.now()) {
        entries.delete(key);
        return undefined;
      }
      entry.expiresAt = Math.min(
        clock.now() + VIEW_TOKEN_TTL_MS,
        entry.issuedAt + VIEW_TOKEN_MAX_AGE_MS,
      );
      return entry.roots;
    },
    revokeTab(tabId) {
      for (const [key, entry] of entries) {
        if (entry.tabId === tabId) entries.delete(key);
      }
    },
  };
}
