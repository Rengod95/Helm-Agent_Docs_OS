import type { LoaderFs, TrustStoreBackend } from "@xeon/contracts/extensions";
import { ProjectTrustStore } from "../../../src/loading-trust/index.ts";
import { recordOf } from "../../support/guards.ts";

export interface MemoryTrustBackend extends TrustStoreBackend {
  /** 저장된 본문 */
  text(): string | null;
  /** read 호출 수와 update 호출 수 */
  readonly calls: { reads: number; updates: number };
  /** 다음 update 하나를 거부하게 한다 */
  failNextUpdate(cause: unknown): void;
  /** read가 실패하게 한다 */
  failReads(reason: string | null): void;
}

/** 잠금과 원자 교체를 흉내 내는 메모리 백엔드 */
export function memoryTrustBackend(initial: string | null = null): MemoryTrustBackend {
  let stored = initial;
  let nextFailure: { readonly cause: unknown } | undefined;
  let readFailure: string | null = null;
  const calls = { reads: 0, updates: 0 };
  return {
    text: () => stored,
    calls,
    failNextUpdate(cause) {
      nextFailure = { cause };
    },
    failReads(reason) {
      readFailure = reason;
    },
    read() {
      calls.reads += 1;
      return Promise.resolve(
        readFailure === null
          ? { ok: true as const, text: stored }
          : { ok: false as const, reason: readFailure },
      );
    },
    async update(fn) {
      calls.updates += 1;
      if (nextFailure !== undefined) {
        const failure = nextFailure;
        nextFailure = undefined;
        throw new Error("backend update failed", { cause: failure.cause });
      }
      stored = fn(stored);
      await Promise.resolve();
    },
  };
}

/** 있는 경로 집합과 realpath 별칭으로 만든 LoaderFs */
export function memoryFs(
  existing: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): LoaderFs & { readonly checked: string[] } {
  const present = new Set(existing);
  const checked: string[] = [];
  return {
    checked,
    readText: () => Promise.resolve(null),
    listDir: () => Promise.resolve(null),
    exists(path) {
      checked.push(path);
      return Promise.resolve(present.has(path));
    },
    realpath: (path) => Promise.resolve(aliases[path] ?? path),
  };
}

export const FIXED_NOW: number = Date.UTC(2026, 9, 23, 12, 0, 0);

export function storeOf(
  backend: MemoryTrustBackend,
  fs: LoaderFs = memoryFs([]),
): ProjectTrustStore {
  return new ProjectTrustStore(backend, (path) => fs.realpath(path), { now: () => FIXED_NOW });
}

export function entriesOf(text: string | null): unknown {
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** 저장 파일의 항목 경로(저장된 순서) */
export function entryPaths(text: string | null): string[] {
  const parsed: unknown = JSON.parse(text ?? "{}");
  return Object.keys(recordOf(recordOf(parsed)["entries"]));
}
