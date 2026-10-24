import { err, ok, type Clock, type Result, type Scheduler } from "@xeon/contracts";
import type { SecretDenyReason, SecretHandle, SecretUseMode } from "@xeon/contracts/capabilities";
import type { LocalId } from "@xeon/contracts/conversation";
import type { SecretError, SecretLease, SecretValueView } from "@xeon/contracts/services";
import { deniedError } from "./errors.ts";

// L0.secrets.spec §3.3, §4.1. 값은 클로저에만 있고 객체 속성으로 두지 않는다.
// lease에는 값을 돌려주는 메서드(reveal, value, get)가 없다. 값은 use 콜백 인자로만 보인다.

const INSPECT = Symbol.for("nodejs.util.inspect.custom");
const DECODER = new TextDecoder("utf-8");

export interface LeaseOptions {
  readonly id: LocalId<"sls">;
  readonly handle: SecretHandle;
  readonly mode: SecretUseMode;
  /** 소유권이 넘어온다. dispose에서 0으로 덮인다 */
  readonly value: Uint8Array;
  readonly ttlSeconds: number;
  readonly maxUses: number;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** 닫힐 때 한 번 불린다(활성 lease 등록 해제용). 값을 받지 않는다 */
  readonly onClose?: () => void;
}

function marker(id: string): string {
  return `[SecretLease ${id}]`;
}

/** 값 바이트는 호출마다 복사본을 주고 콜백이 끝나면 복사본을 0으로 덮는다 */
function viewOf(copy: Uint8Array): SecretValueView {
  return {
    bytes: copy,
    text(): string {
      return DECODER.decode(copy);
    },
  };
}

export function createLease(options: LeaseOptions): SecretLease {
  const { id, handle, mode, clock, scheduler } = options;
  const value = options.value;
  const expiresAt = clock.now() + options.ttlSeconds * 1000;
  let usesLeft = options.maxUses;
  let closed = false;
  let timer: number | null = null;

  function dispose(): void {
    if (closed) return;
    closed = true;
    value.fill(0);
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
    options.onClose?.();
  }

  // TTL이 지나면 사용 여부와 관계없이 값을 덮는다
  timer = scheduler.setTimeout(() => {
    timer = null;
    dispose();
  }, options.ttlSeconds * 1000);

  function gate(): SecretDenyReason | null {
    if (closed) return "lease_expired";
    if (clock.now() >= expiresAt) {
      dispose();
      return "lease_expired";
    }
    if (usesLeft <= 0) return "lease_exhausted";
    return null;
  }

  const lease = {
    leaseId: id,
    handle,
    mode,
    expiresAt,
    get usesLeft(): number {
      return closed ? 0 : usesLeft;
    },
    async use<T>(fn: (view: SecretValueView) => Promise<T> | T): Promise<Result<T, SecretError>> {
      const denied = gate();
      if (denied !== null) return err(deniedError(handle, denied));
      usesLeft -= 1;
      const copy = value.slice();
      try {
        return ok(await fn(viewOf(copy)));
      } finally {
        copy.fill(0);
      }
    },
    dispose,
    toJSON(): string {
      return marker(id);
    },
    toString(): string {
      return marker(id);
    },
    [INSPECT](): string {
      return marker(id);
    },
  };
  return lease;
}

export interface WrapOptions {
  readonly handle: SecretHandle;
  /** use마다 한 번 더 보는 바깥 조건(메타 expiresAt 등). 사유가 있으면 사용을 거부하고 lease를 닫는다 */
  readonly gate: () => SecretDenyReason | null;
  readonly onClose: () => void;
}

/**
 * 제공자가 만든 lease를 서비스의 lease로 감싼다. 제공자 lease는 핸들을 모르므로(F SecretProvider.lease에 핸들이 없다)
 * 바깥에서 핸들을 채우고, 메타의 expiresAt을 use마다 다시 본다(spec §4.1 3번).
 */
export function wrapLease(inner: SecretLease, options: WrapOptions): SecretLease {
  let closed = false;
  function dispose(): void {
    inner.dispose();
    if (!closed) {
      closed = true;
      options.onClose();
    }
  }
  const lease = {
    leaseId: inner.leaseId,
    handle: options.handle,
    mode: inner.mode,
    expiresAt: inner.expiresAt,
    get usesLeft(): number {
      return closed ? 0 : inner.usesLeft;
    },
    async use<T>(fn: (view: SecretValueView) => Promise<T> | T): Promise<Result<T, SecretError>> {
      const reason = options.gate();
      if (reason !== null) {
        dispose();
        return err(deniedError(options.handle, reason));
      }
      const result = await inner.use(fn);
      if (!result.ok && result.error.kind === "denied") {
        // 시간 초과로 닫힌 경우 바깥 쪽 등록도 풀어 활성 개수가 맞게 한다. 핸들은 바깥 핸들로 채운다
        if (result.error.reason === "lease_expired") dispose();
        return err(deniedError(options.handle, result.error.reason));
      }
      return result;
    },
    dispose,
    toJSON(): string {
      return marker(inner.leaseId);
    },
    toString(): string {
      return marker(inner.leaseId);
    },
    [INSPECT](): string {
      return marker(inner.leaseId);
    },
  };
  return lease;
}
