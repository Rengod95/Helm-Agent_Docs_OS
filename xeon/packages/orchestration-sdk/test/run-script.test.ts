import { expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type {
  ExtensionEntry,
  RegistrationApi,
  ScriptRunFailure,
  ScriptRunResult,
} from "@fresnel/contracts/extensions";
import { createTestHost, type TestHost } from "@fresnel/ext-host/testing";
import { defineOrchestration, type OrchestrationApi, type RunScriptOptions } from "../src/index.ts";
import { realHostAccess, wrap } from "../src/wrap.ts";
import { install } from "./support/host.ts";
import { orchestrationManifestOf } from "./support/manifests.ts";

// 타입 시험은 tsc -b가 컴파일 시점에 판정한다. Equal과 Expect는 contracts/test/types/expect.ts와 같은 모양이다.
type Equal<A, B> =
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Equal의 표준 구현은 T를 한 번만 쓴다 (eng.typescript.guide TY-23 타입 테스트 도구)
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;

type RunScriptValue = Result<ScriptRunResult, ScriptRunFailure>;

/** g.runScript는 이름과 옵션을 받고 Result의 Promise를 돌려준다. 거절과 기동 실패는 값이다 (F.extensions.spec §3.1.4) */
export type RunScriptSignature = Expect<
  Equal<
    OrchestrationApi<never>["runScript"],
    (name: string, options?: RunScriptOptions) => Promise<RunScriptValue>
  >
>;

/** 옵션은 stdin 하나를 가진 선택 문자열 묶음이다 */
export type RunScriptOptionsShape = Expect<Equal<RunScriptOptions, { readonly stdin?: string }>>;

/** 이름이 문자열이 아니면 대입되지 않는다 */
export type NumericNameRejected = Expect<
  Equal<Assignable<number, Parameters<OrchestrationApi<never>["runScript"]>[0]>, false>
>;

/** stdin이 문자열이 아니면 옵션으로 대입되지 않는다 */
export type NumericStdinRejected = Expect<
  Equal<Assignable<{ readonly stdin: number }, RunScriptOptions>, false>
>;

const IN_ENGINE_REFUSAL = {
  ok: false,
  error: { kind: "sandbox_unavailable", reason: "in_engine_registration" },
} as const;

const LINT_RESULT: ScriptRunResult = {
  exitCode: 0,
  signal: null,
  stdout: "lint diff",
  stdoutTruncated: false,
  stderr: "",
  stderrTruncated: false,
  timedOut: false,
};

/**
 * 격리 자식의 대리 g를 흉내 낸다. 엔진 쪽 등록 API에 자식의 runScript(child-api.ts)를 더해 wrap에 넘긴다.
 * hostOf는 엔진이 만든 원래 객체를 찾으므로 접근 연산은 원래 API로 받는다.
 */
async function installWithChildScript(
  t: TestHost,
  name: string,
  run: (scriptName: string, options?: RunScriptOptions) => Promise<RunScriptValue>,
  sink: { api?: OrchestrationApi<never> },
): Promise<void> {
  const manifest = orchestrationManifestOf({ name });
  const entry: ExtensionEntry = ({ register }) => {
    register(manifest.name, {}, (api: RegistrationApi<never>) => {
      const childLike = { ...api, runScript: run };
      sink.api = wrap(childLike, { manifest }, () => realHostAccess(api));
    });
  };
  await t.host.install({ manifest, entry, loadIndex: 0, builtin: true });
  await t.settled();
}

test("runScript.child-returns-the-engine-value-unchanged", async () => {
  const calls: [string, RunScriptOptions | undefined][] = [];
  const t = await createTestHost();
  const sink: { api?: OrchestrationApi<never> } = {};
  await installWithChildScript(
    t,
    "child-script-ok",
    async (scriptName, options) => {
      calls.push([scriptName, options]);
      return ok(LINT_RESULT);
    },
    sink,
  );
  expect(await sink.api?.runScript("lint", { stdin: "diff" })).toEqual({
    ok: true,
    value: LINT_RESULT,
  });
  expect(calls).toEqual([["lint", { stdin: "diff" }]]);
});

test("runScript.child-passes-an-omitted-stdin-through-as-omitted", async () => {
  const calls: [string, RunScriptOptions | undefined][] = [];
  const t = await createTestHost();
  const sink: { api?: OrchestrationApi<never> } = {};
  await installWithChildScript(
    t,
    "child-script-omit",
    async (scriptName, options) => {
      calls.push([scriptName, options]);
      return ok(LINT_RESULT);
    },
    sink,
  );
  await sink.api?.runScript("lint");
  // 빈 문자열로 채우는 일은 자식 대리 객체(child-api.ts)가 한다
  expect(calls).toEqual([["lint", undefined]]);
});

test("runScript.child-refusal-comes-back-as-the-failure-value", async () => {
  const t = await createTestHost();
  const sink: { api?: OrchestrationApi<never> } = {};
  await installWithChildScript(
    t,
    "child-script-refuse",
    async () => err({ kind: "script_not_approved" }),
    sink,
  );
  expect(await sink.api?.runScript("rm")).toEqual({
    ok: false,
    error: { kind: "script_not_approved" },
  });
});

test("runScript.in-engine-registration-answers-sandbox_unavailable-with-a-reason", async () => {
  const t = await createTestHost();
  const sink: { api?: OrchestrationApi<never> } = {};
  await install(
    t,
    defineOrchestration({
      manifest: orchestrationManifestOf({ name: "in-engine-script" }),
      setup(g) {
        sink.api = g;
      },
    }),
  );
  expect(await sink.api?.runScript("lint", { stdin: "x" })).toEqual(IN_ENGINE_REFUSAL);
  expect(await sink.api?.runScript("lint")).toEqual(IN_ENGINE_REFUSAL);
});
