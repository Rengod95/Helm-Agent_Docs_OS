import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type { ExtensionLoader, ProjectLoadReport, ProjectTrustResult } from "@fresnel/ext-host";
import { createProjectExtensions } from "../../src/assembly/project-extensions.ts";
import type { ProjectTrust } from "../../src/assembly/trust.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { partial } from "../fixtures/unsafe.ts";

// 서비스 모드의 프로젝트 확장 적재(assembly/project-extensions.ts). 같은 작업 폴더의 동시 호출은 적재 하나를 함께 기다린다.
// 신뢰 판정과 로더는 시험용 가짜다. 여기서 보는 것은 적재가 도는 신호와 호출자별 거절이다.

const WORKSPACE = "/work/project";
const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};
const LOADED = partial<ProjectLoadReport>({ alreadyLoaded: false, diagnostics: [] });

function trustedEverywhere(): ProjectTrust {
  return partial<ProjectTrust>({
    resolve: (projectRoot) =>
      Promise.resolve(partial<ProjectTrustResult>({ trusted: true, projectRoot })),
  });
}

/** 로더 호출마다 받은 신호를 기록하고, 시험이 정한 결과로 끝낸다. `call`은 1부터 센 호출 번호다 */
function recordingLoader(
  outcome: (signal: AbortSignal, call: number) => Promise<ProjectLoadReport>,
): { readonly loader: ExtensionLoader; readonly signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const loader = partial<ExtensionLoader>({
    loadProject(options) {
      signals.push(options.signal);
      return outcome(options.signal, signals.length);
    },
  });
  return { loader, signals };
}

test("a caller that leaves does not cancel the load: the other caller gets the result and the loader runs once", async () => {
  const host = new AbortController();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { loader, signals } = recordingLoader(async () => {
    started.resolve();
    await release.promise;
    return LOADED;
  });
  const extensions = createProjectExtensions({
    mode: "service",
    loader: () => loader,
    trust: trustedEverywhere(),
    logger: SILENT,
    signal: host.signal,
  });
  const first = new AbortController();
  const second = new AbortController();
  const firstCall = extensions.ensure(WORKSPACE, first.signal);
  const secondCall = extensions.ensure(WORKSPACE, second.signal);
  await started.promise;

  first.abort();
  expect(await rejectionOf(firstCall)).toBe(first.signal.reason);

  release.resolve();
  expect(await secondCall).toEqual(undefined);
  expect(signals.length).toEqual(1);
  expect(signals[0]).toBe(host.signal);
  expect(signals[0]?.aborted).toEqual(false);
});

test("closing the engine aborts the shared load, and the caller waiting on it gets the load's failure", async () => {
  const host = new AbortController();
  const started = Promise.withResolvers<void>();
  // 실제 로더처럼 신호가 닫히면 적재를 그 사유로 거절한다
  const aborted = new Error("engine closed during the project load");
  const { loader, signals } = recordingLoader((signal) => {
    started.resolve();
    return new Promise<ProjectLoadReport>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(aborted), { once: true });
    });
  });
  const extensions = createProjectExtensions({
    mode: "service",
    loader: () => loader,
    trust: trustedEverywhere(),
    logger: SILENT,
    signal: host.signal,
  });
  const caller = new AbortController();
  const call = extensions.ensure(WORKSPACE, caller.signal);
  await started.promise;

  host.abort();
  expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  expect(await rejectionOf(call)).toBe(aborted);
  expect(caller.signal.aborted).toEqual(false);
});

test("a failed shared load is forgotten, so the next call loads the project again", async () => {
  const host = new AbortController();
  const failure = new Error("trust store unreadable");
  const { loader, signals } = recordingLoader((_signal, call) =>
    call === 1 ? Promise.reject(failure) : Promise.resolve(LOADED),
  );
  const extensions = createProjectExtensions({
    mode: "service",
    loader: () => loader,
    trust: trustedEverywhere(),
    logger: SILENT,
    signal: host.signal,
  });
  const caller = new AbortController();

  expect(await rejectionOf(extensions.ensure(WORKSPACE, caller.signal))).toBe(failure);
  expect(await extensions.ensure(WORKSPACE, caller.signal)).toEqual(undefined);
  expect(signals.length).toEqual(2);
});
