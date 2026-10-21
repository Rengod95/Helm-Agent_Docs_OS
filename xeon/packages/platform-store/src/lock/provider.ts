import type { Result } from "@xeon/contracts";

export interface LockHandle {
  readonly key: string;
  /** 여러 번 불러도 된다. 두 번째부터는 아무 일도 하지 않는다 */
  release(): void;
}

export type LockAcquireError =
  | { readonly kind: "held" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "io"; readonly code: string };

/** OS provider. 프로세스가 죽으면 OS가 잠금을 푼다. 블로킹하지 않는다(LOCK_NB) */
export interface LockProvider {
  readonly kind: "flock" | "win32" | "none";
  tryAcquire(key: string): Result<LockHandle, LockAcquireError>;
}
