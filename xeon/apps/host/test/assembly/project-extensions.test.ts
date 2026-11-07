import { expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import type {
  ExtensionLoader,
  LoadProjectOptions,
  ProjectLoadReport,
  ProjectTrustResult,
  TrustVerdict,
} from "@fresnel/ext-host";
import { createProjectExtensions } from "../../src/assembly/project-extensions.ts";
import type { ProjectTrust } from "../../src/assembly/trust.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { partial } from "../fixtures/unsafe.ts";

// 작업 폴더의 프로젝트 확장 적재(assembly/project-extensions.ts). 모드 입력이 없어 in-process·stdio·서비스가 같은 경로를 탄다.
// 같은 작업 폴더의 동시 호출은 적재 하나를 함께 기다린다. 신뢰 판정과 로더는 시험용 가짜다.
// 여기서 보는 것은 적재가 도는 신호, 호출자별 거절, 불신 폴더가 아무것도 싣지 않고 묻지도 않는 것이다.

const WORKSPACE = "/work/project";
const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};
const LOADED = partial<ProjectLoadReport>({ alreadyLoaded: false, diagnostics: [] });
const ALREADY = partial<ProjectLoadReport>({ alreadyLoaded: true, diagnostics: [] });

/**
 * 폴더의 판정 상태를 시험이 정한다. `undecided`는 결정이 없는 폴더다(headless라 묻지 않고 불신이다).
 * `resolve`만 채운 대역이라, 묻기(`inspect`·`decide`)를 부르면 멤버가 없어 시험이 실패한다
 */
function trustWith(verdictOf: () => TrustVerdict): ProjectTrust {
  return partial<ProjectTrust>({
    resolve: (projectRoot) => {
      const verdict = verdictOf();
      return Promise.resolve(
        partial<ProjectTrustResult>({
          projectRoot,
          trusted: verdict === "allow",
          verdict,
          via: verdict === "undecided" ? "headless" : "store",
        }),
      );
    },
  });
}

/** 로더 호출마다 받은 옵션을 기록하고, 시험이 정한 결과로 끝낸다. `call`은 1부터 센 호출 번호다 */
function recordingLoader(
  outcome: (options: LoadProjectOptions, call: number) => Promise<ProjectLoadReport>,
): { readonly loader: ExtensionLoader; readonly calls: LoadProjectOptions[] } {
  const calls: LoadProjectOptions[] = [];
  const loader = partial<ExtensionLoader>({
    loadProject(options) {
      calls.push(options);
      return outcome(options, calls.length);
    },
  });
  return { loader, calls };
}

test("a caller that leaves does not cancel the load: the other caller gets the result and the loader runs once", async () => {
  const host = new AbortController();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { loader, calls } = recordingLoader(async () => {
    started.resolve();
    await release.promise;
    return LOADED;
  });
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => "allow"),
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
  expect(calls.length).toEqual(1);
  expect(calls[0]?.signal).toBe(host.signal);
  expect(calls[0]?.signal.aborted).toEqual(false);
});

test("closing the engine aborts the shared load, and the caller waiting on it gets the load's failure", async () => {
  const host = new AbortController();
  const started = Promise.withResolvers<void>();
  // 실제 로더처럼 신호가 닫히면 적재를 그 사유로 거절한다
  const aborted = new Error("engine closed during the project load");
  const { loader, calls } = recordingLoader((options) => {
    started.resolve();
    return new Promise<ProjectLoadReport>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(aborted), { once: true });
    });
  });
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => "allow"),
    logger: SILENT,
    signal: host.signal,
  });
  const caller = new AbortController();
  const call = extensions.ensure(WORKSPACE, caller.signal);
  await started.promise;

  host.abort();
  expect(calls.map((options) => options.signal.aborted)).toEqual([true]);
  expect(await rejectionOf(call)).toBe(aborted);
  expect(caller.signal.aborted).toEqual(false);
});

test("a failed shared load is forgotten, so the next call loads the project again", async () => {
  const host = new AbortController();
  const failure = new Error("trust store unreadable");
  const { loader, calls } = recordingLoader((_options, call) =>
    call === 1 ? Promise.reject(failure) : Promise.resolve(LOADED),
  );
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => "allow"),
    logger: SILENT,
    signal: host.signal,
  });
  const caller = new AbortController();

  expect(await rejectionOf(extensions.ensure(WORKSPACE, caller.signal))).toBe(failure);
  expect(await extensions.ensure(WORKSPACE, caller.signal)).toEqual(undefined);
  expect(calls.length).toEqual(2);
});

test("a trusted workspace loads its project once, and the verdict reaches the loader as an override with no prompter", async () => {
  const host = new AbortController();
  const { loader, calls } = recordingLoader(() => Promise.resolve(LOADED));
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => "allow"),
    logger: SILENT,
    signal: host.signal,
  });

  expect(await extensions.ensure(WORKSPACE, new AbortController().signal)).toEqual(undefined);
  expect(
    calls.map((options) => [options.projectRoot, options.mode, options.trustOverride]),
  ).toEqual([[WORKSPACE, "headless", true]]);
  expect(calls[0]?.prompter).toBeUndefined();
  expect(calls[0]?.signal).toBe(host.signal);
});

test("an undecided or denied workspace loads nothing and asks nothing", async () => {
  let verdict: TrustVerdict = "undecided";
  const { loader, calls } = recordingLoader(() => Promise.resolve(LOADED));
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => verdict),
    logger: SILENT,
    signal: new AbortController().signal,
  });
  const caller = new AbortController();

  expect(await extensions.ensure(WORKSPACE, caller.signal)).toEqual(undefined);
  expect(calls.length).toEqual(0);

  verdict = "deny";
  expect(await extensions.ensure(WORKSPACE, caller.signal)).toEqual(undefined);
  expect(calls.length).toEqual(0);
});

test("after the decision is recorded, the next ensure of the workspace loads it", async () => {
  let verdict: TrustVerdict = "undecided";
  const { loader, calls } = recordingLoader(() => Promise.resolve(LOADED));
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => verdict),
    logger: SILENT,
    signal: new AbortController().signal,
  });
  const caller = new AbortController();

  await extensions.ensure(WORKSPACE, caller.signal);
  expect(calls.length).toEqual(0);

  // trust.decide가 허용을 반영한 뒤 신뢰 포트가 같은 폴더로 다시 부른다. 이전 호출은 아무것도 기억하지 않았다
  verdict = "allow";
  expect(await extensions.ensure(WORKSPACE, caller.signal)).toEqual(undefined);
  expect(calls.map((options) => [options.projectRoot, options.trustOverride])).toEqual([
    [WORKSPACE, true],
  ]);
});

test("concurrent calls for one workspace share a single load, and a later call finds it already loaded", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  // 실제 로더처럼 같은 루트는 한 번만 싣고, 다음 호출에는 alreadyLoaded로 답한다
  const actuallyLoaded: string[] = [];
  const { loader, calls } = recordingLoader(async (options) => {
    if (actuallyLoaded.includes(options.projectRoot)) return ALREADY;
    started.resolve();
    await release.promise;
    actuallyLoaded.push(options.projectRoot);
    return LOADED;
  });
  const extensions = createProjectExtensions({
    loader: () => loader,
    trust: trustWith(() => "allow"),
    logger: SILENT,
    signal: new AbortController().signal,
  });

  const first = extensions.ensure(WORKSPACE, new AbortController().signal);
  const second = extensions.ensure(WORKSPACE, new AbortController().signal);
  await started.promise;
  expect(calls.length).toEqual(1);

  release.resolve();
  expect(await Promise.all([first, second])).toEqual([undefined, undefined]);
  expect(calls.length).toEqual(1);

  expect(await extensions.ensure(WORKSPACE, new AbortController().signal)).toEqual(undefined);
  expect(calls.length).toEqual(2);
  expect(actuallyLoaded).toEqual([WORKSPACE]);
});

test("with no loader or no workspace, ensure resolves at once without judging trust", async () => {
  const signal = new AbortController().signal;
  // 판정 대역이 비어 있어서 판정을 부르면 시험이 실패한다
  const withoutLoader = createProjectExtensions({
    loader: () => undefined,
    trust: partial<ProjectTrust>({}),
    logger: SILENT,
    signal,
  });
  expect(await withoutLoader.ensure(WORKSPACE, signal)).toEqual(undefined);

  const { loader, calls } = recordingLoader(() => Promise.resolve(LOADED));
  const withoutWorkspace = createProjectExtensions({
    loader: () => loader,
    trust: partial<ProjectTrust>({}),
    logger: SILENT,
    signal,
  });
  expect(await withoutWorkspace.ensure(undefined, signal)).toEqual(undefined);
  expect(calls.length).toEqual(0);
});
