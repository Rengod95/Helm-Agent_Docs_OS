import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import {
  ExecPortKey,
  SandboxServiceName,
  type ExecService,
  type SandboxService,
  type SelfTestReport,
} from "@fresnel/contracts/services";
import type { ExtHost } from "@fresnel/ext-host";
import { createSandboxSelfTestPort } from "../../src/assembly/m4/sandbox-self-test-port.ts";
import { partial } from "../fixtures/unsafe.ts";

// 샌드박스 자가 시험 포트(`sandbox.lastSelfTest`·`sandbox.selfTest`): 서비스와 Shell을 확장 호스트에서 찾아 넘긴다.

const REPORT: SelfTestReport = {
  at: 1_700_000_000_000,
  durationMs: 7,
  passed: true,
  items: [{ id: "env_allowlist", passed: true }],
};

/** 있는 포트만 돌려주는 확장 호스트 대역 */
function hostWith(services: {
  readonly sandbox?: SandboxService;
  readonly exec?: ExecService;
}): ExtHost {
  return partial<ExtHost>({
    ports: partial<ExtHost["ports"]>({
      get: partial<ExtHost["ports"]["get"]>((key: { readonly name: string }) => {
        if (key.name === SandboxServiceName) return services.sandbox;
        if (key.name === ExecPortKey.name) return services.exec;
        return undefined;
      }),
    }),
  });
}

test("the port reads the last report and runs the check with the exec shell and the caller's signal", async () => {
  const shell = partial<ExecService>({});
  const runs: { shell: unknown; signal: AbortSignal | undefined }[] = [];
  const sandbox = partial<SandboxService>({
    lastSelfTestReport: () => REPORT,
    selfTest: (given, context) => {
      runs.push({ shell: given, signal: context.abortSignal });
      return Promise.resolve(REPORT);
    },
  });
  const port = createSandboxSelfTestPort(hostWith({ sandbox, exec: shell }));
  expect(port.last()).toEqual(REPORT);

  const controller = new AbortController();
  expect(await port.run(controller.signal)).toEqual(ok(REPORT));
  expect(runs.length).toBe(1);
  expect(runs[0]?.shell).toBe(shell);
  expect(runs[0]?.signal).toBe(controller.signal);
});

test("without the sandbox service there is no report, and a run is not_running", async () => {
  const port = createSandboxSelfTestPort(hostWith({ exec: partial<ExecService>({}) }));
  expect(port.last()).toBeUndefined();
  expect(await port.run(new AbortController().signal)).toEqual({
    ok: false,
    error: { kind: "not_running" },
  });
});
