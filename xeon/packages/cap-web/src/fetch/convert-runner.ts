import { Worker } from "node:worker_threads";
import { err, ok, type Result } from "@fresnel/contracts";
import { convert, type ConvertInput, type ConvertResult } from "./convert/convert.ts";

// 변환 실행기. 운영은 Worker 하나(네트워크 전역을 지운 뒤 변환 모듈을 import, `convert-worker.ts`)에서 돌리고,
// 시험은 같은 함수를 직접 부른다(L2.web.spec §4.9.3).

export type ConvertFailure =
  | { readonly kind: "worker_failed"; readonly message: string; readonly cause?: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" };

export interface ConvertRunner {
  convert(input: ConvertInput, signal: AbortSignal): Promise<Result<ConvertResult, ConvertFailure>>;
  close(): Promise<void>;
}

/** 같은 프로세스에서 직접 부른다(시험, 워커를 못 쓰는 환경) */
export function directConvertRunner(): ConvertRunner {
  return {
    convert(input, signal) {
      if (signal.aborted) return Promise.resolve(err({ kind: "aborted" }));
      return Promise.resolve(ok(convert(input)));
    },
    close: () => Promise.resolve(),
  };
}

function readConverted(data: unknown): ConvertResult | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const kind: unknown = Reflect.get(data, "kind");
  if (kind === "unsupported") {
    const mediaType: unknown = Reflect.get(data, "mediaType");
    return typeof mediaType === "string" ? { kind, mediaType } : undefined;
  }
  if (kind !== "converted") return undefined;
  const method: unknown = Reflect.get(data, "method");
  const markdown: unknown = Reflect.get(data, "markdown");
  const title: unknown = Reflect.get(data, "title");
  const publishedAt: unknown = Reflect.get(data, "publishedAt");
  const links: unknown = Reflect.get(data, "links");
  const spaSuspected: unknown = Reflect.get(data, "spaSuspected");
  if (
    (method !== "readability" &&
      method !== "defuddle" &&
      method !== "plain" &&
      method !== "negotiated-md") ||
    typeof markdown !== "string" ||
    (title !== undefined && typeof title !== "string") ||
    (publishedAt !== undefined && typeof publishedAt !== "string") ||
    typeof spaSuspected !== "boolean" ||
    !Array.isArray(links)
  ) {
    return undefined;
  }
  const readLinks: { href: string; text: string }[] = [];
  for (const item of links) {
    const link: unknown = item;
    if (typeof link !== "object" || link === null) return undefined;
    const href: unknown = Reflect.get(link, "href");
    const text: unknown = Reflect.get(link, "text");
    if (typeof href !== "string" || typeof text !== "string") return undefined;
    readLinks.push({ href, text });
  }
  return { kind, method, markdown, title, publishedAt, links: readLinks, spaSuspected };
}

interface Pending {
  readonly resolve: (outcome: Result<ConvertResult, ConvertFailure>) => void;
}

/**
 * 컴파일 사이드카에서 워커 모듈의 묶음 안 경로. `build-sidecar`가 `apps/desktop`을 작업 폴더로 두고 워커를 추가 진입점으로 묶으면
 * 그 폴더 기준 상대 경로에서 `.ts`를 `.js`로 바꾼 이름으로 `/$bunfs/root/` 아래에 들어간다(Bun 1.4.3). `new URL`로 풀면 `..`이
 * 뿌리 위로 잘려 못 찾으므로 문자열 그대로 쓴다. 이 값이 어긋나면 컴파일 시험(scripts/sidecar-worker.test.ts)이 잡는다
 */
const COMPILED_WORKER_PATH = "/$bunfs/root/../../packages/cap-web/src/fetch/convert-worker.js";

function workerEntry(): string | URL {
  // 묶음 안 모듈의 import.meta.url은 원본 소스 경로를 가리키므로 실행 진입점(Bun.main)으로 묶음 안인지 본다
  return Bun.main.startsWith("/$bunfs/")
    ? COMPILED_WORKER_PATH
    : new URL("./convert-worker.ts", import.meta.url);
}

export interface WorkerRunnerOptions {
  readonly timeoutMs?: number;
}

/** Worker 하나를 게으르게 띄워 쓰는 변환 실행기. 시간 초과나 실패하면 Worker를 버리고 다음 요청에 새로 띄운다 */
export function createWorkerConvertRunner(options: WorkerRunnerOptions = {}): ConvertRunner {
  const timeoutMs = options.timeoutMs ?? 20_000;
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function failAll(failure: ConvertFailure): void {
    for (const entry of pending.values()) entry.resolve(err(failure));
    pending.clear();
  }

  function discard(): void {
    const old = worker;
    worker = undefined;
    if (old !== undefined) {
      // terminate는 Promise를 돌려준다. 종료 실패는 이미 버리는 Worker라 요청 결과에 영향이 없고 기록할 곳이 없다
      old.terminate().then(
        () => undefined,
        (cause: unknown) => {
          failAll({ kind: "worker_failed", message: "terminate failed", cause });
        },
      );
    }
  }

  function ensure(): Worker {
    if (worker !== undefined) return worker;
    const created = new Worker(workerEntry());
    created.on("message", (data: unknown) => {
      if (typeof data !== "object" || data === null) return;
      const id: unknown = Reflect.get(data, "id");
      if (typeof id !== "number") return;
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      const error: unknown = Reflect.get(data, "error");
      if (typeof error === "string") {
        entry.resolve(err({ kind: "worker_failed", message: error }));
        return;
      }
      const result = readConverted(Reflect.get(data, "result"));
      entry.resolve(
        result === undefined
          ? err({ kind: "worker_failed", message: "the worker returned a malformed result" })
          : ok(result),
      );
    });
    created.on("error", (cause: unknown) => {
      failAll({
        kind: "worker_failed",
        message: cause instanceof Error ? cause.message : "worker error",
        cause,
      });
      discard();
    });
    worker = created;
    return created;
  }

  return {
    convert(input, signal) {
      if (signal.aborted) return Promise.resolve(err({ kind: "aborted" }));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(err({ kind: "timeout" }));
          discard();
        }, timeoutMs);
        const finish = (outcome: Result<ConvertResult, ConvertFailure>): void => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        };
        const onAbort = (): void => {
          pending.delete(id);
          finish(err({ kind: "aborted" }));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.set(id, { resolve: finish });
        ensure().postMessage({ id, input }, []);
      });
    },
    close() {
      discard();
      return Promise.resolve();
    },
  };
}
