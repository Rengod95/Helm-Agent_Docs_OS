import { Bug, err, ok, type Result } from "@xeon/contracts";
import { parseSecretRef, type RedactionHit, type SecretHandle } from "@xeon/contracts/capabilities";
import type {
  Redactor,
  SecretError,
  SecretLease,
  SecretService,
  SecretValueView,
  UseCtx,
} from "@xeon/contracts/services";

// 메모리 SecretService 가짜(plan §2 testing/fake-secrets.ts). 가짜 키 문자열은 호출자가 정한다.
// lease 횟수와 마지막 사용 맥락을 센다. 정책 판정은 하지 않는다(그 시험은 platform-secrets의 몫이다).
// 마스킹은 알려진 값(lease로 연 값)을 "[secret:<name>]"으로 바꾸는 단순 구현이다.

export interface MemorySecrets {
  readonly service: SecretService;
  /** lease 호출 횟수 */
  leaseCalls(): number;
  /** use 콜백이 값을 읽은 횟수 */
  valueReads(): number;
  /** 마지막 lease의 사용 맥락 */
  lastCtx(): UseCtx | null;
  /** 모르는 이름 목록 대신 지정한 이름을 못 찾은 것으로 만든다 */
  setMissing(name: string, missing: boolean): void;
}

function unsupported(): never {
  throw new Bug("memorySecrets does not implement this SecretService method");
}

function unsupportedAsync(): Promise<never> {
  return Promise.reject(new Bug("memorySecrets does not implement this SecretService method"));
}

export function memorySecrets(values: Readonly<Record<string, string>>): MemorySecrets {
  const known = new Map<string, string>();
  const missing = new Set<string>();
  let leaseCount = 0;
  let readCount = 0;
  let last: UseCtx | null = null;

  const redactor: Redactor = {
    registerKnown(name, bytes) {
      if (bytes.length < 8) return err({ kind: "value_too_short", minBytes: 8 });
      known.set(name, new TextDecoder().decode(bytes));
      return ok(undefined);
    },
    forget(name) {
      known.delete(name);
    },
    mask(text) {
      let masked = text;
      const hits: RedactionHit[] = [];
      for (const [name, value] of known) {
        if (value.length > 0 && masked.includes(value)) {
          masked = masked.split(value).join(`[secret:${name}]`);
          hits.push({ kind: `known:${name}`, count: 1 });
        }
      }
      return { text: masked, hits };
    },
    // 가짜는 깊은 마스킹을 하지 않는다(이 패키지는 mask만 쓴다)
    maskDeep: (value) => ({ value, hits: [] }),
    containsKnown: (text) =>
      [...known.values()].some((value) => value.length > 0 && text.includes(value)),
  };

  const service: SecretService = {
    redactor,
    resolve: () => unsupportedAsync(),
    list: () => unsupportedAsync(),
    check: () => unsupportedAsync(),
    lease(handle: SecretHandle, ctx: UseCtx): Promise<Result<SecretLease, SecretError>> {
      leaseCount += 1;
      last = ctx;
      const parsed = parseSecretRef(handle);
      if (!parsed.ok) return Promise.resolve(err(parsed.error));
      const name = parsed.value.name;
      const value = values[name];
      if (value === undefined || missing.has(name)) {
        return Promise.resolve(err({ kind: "secret_missing", handle, where: "provider" }));
      }
      known.set(name, value);
      let closed = false;
      const lease: SecretLease = {
        leaseId: `sls_${String(leaseCount).padStart(26, "0")}`,
        handle,
        mode: ctx.mode,
        expiresAt: Number.MAX_SAFE_INTEGER,
        usesLeft: 1,
        use<T>(fn: (view: SecretValueView) => Promise<T> | T): Promise<Result<T, SecretError>> {
          if (closed) {
            return Promise.resolve(err({ kind: "denied", handle, reason: "lease_expired" }));
          }
          readCount += 1;
          const bytes = new TextEncoder().encode(value);
          return Promise.resolve(fn({ bytes, text: () => value })).then((result) => ok(result));
        },
        dispose() {
          closed = true;
        },
        toJSON: () => "[SecretLease]",
      };
      return Promise.resolve(ok(lease));
    },
    withHttp: () => unsupportedAsync(),
    withEnv: () => unsupportedAsync(),
    withBrowserInput: () => unsupportedAsync(),
    protectedPaths: () => [],
    registerProvider: () => unsupported(),
    onAudit: () => ({ [Symbol.dispose]: () => {} }),
    diagnose: () => unsupportedAsync(),
  };

  return {
    service,
    leaseCalls: () => leaseCount,
    valueReads: () => readCount,
    lastCtx: () => last,
    setMissing(name, isMissing) {
      if (isMissing) missing.add(name);
      else missing.delete(name);
    },
  };
}
