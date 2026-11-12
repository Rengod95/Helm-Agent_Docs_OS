import { err, ok } from "@fresnel/contracts";
import type { SecretError } from "@fresnel/contracts/services";
import type { KeyMoveTarget, KeyStatus, SecretKeys } from "@fresnel/platform-secrets";

// 열쇠 보관 가짜(`SecretKeys`). 위치만 두고 identity는 없다. 옮기기는 운영의 판정 순서를 줄여 보인다: 옮길 열쇠가 없거나
// 이미 `to`에 있으면 commit을 부르지 않고 `moved: false`, 아니면 commit을 부르고 위치를 옮긴다. commit이 실패하면 그 오류다.

export interface FakeKeysOptions {
  readonly status?: Partial<KeyStatus>;
  /** 옛 쪽 삭제 결과. 기본은 성공이다 */
  readonly oldRemoved?: boolean;
}

export interface FakeKeys extends SecretKeys {
  /** 옮기기 호출이 받은 목표 쪽 */
  readonly moves: KeyMoveTarget[];
  /** 지금 상태(옮기기로 바뀐다) */
  current(): KeyStatus;
  /** 시험이 상태를 직접 정한다(예: 열쇠가 파일에 있다, 파일이 없다) */
  set(next: Partial<KeyStatus>): void;
}

const DEFAULT_STATUS: KeyStatus = {
  source: "auto",
  in: "none",
  filePath: "/tmp/fresnel-test/secrets/age/keys.txt",
  keychainUsable: true,
  fallbackUnconfirmed: false,
  fileMissing: false,
};

export function createFakeKeys(options: FakeKeysOptions = {}): FakeKeys {
  let status: KeyStatus = { ...DEFAULT_STATUS, ...options.status };
  const moves: KeyMoveTarget[] = [];
  return {
    moves,
    current: () => status,
    set(next) {
      status = { ...status, ...next };
    },
    status: () => Promise.resolve(status),
    async move(to, commit) {
      moves.push(to);
      if (status.in === "none" || status.in === to) {
        return ok({ moved: false, created: false, oldRemoved: false });
      }
      const switched: Awaited<ReturnType<typeof commit>> = await commit();
      if (!switched.ok) return err<SecretError>(switched.error);
      status = { ...status, source: to, in: to, fallbackUnconfirmed: false };
      return ok({ moved: true, created: true, oldRemoved: options.oldRemoved ?? true });
    },
  };
}
