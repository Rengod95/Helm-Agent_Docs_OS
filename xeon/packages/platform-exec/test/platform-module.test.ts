import { describe, expect, test } from "bun:test";
import type { PortKey } from "@xeon/contracts/extensions";
import { type ExecService, ExecPortKey, SecretServiceName } from "@xeon/contracts/services";
import type { PlatformContext } from "@xeon/ext-host";
import { portAs } from "@xeon/ext-host/testing";
import { createExecPlatformModule } from "../src/platform-module.ts";
import { darwinProvider } from "../src/providers/darwin.ts";
import { fakeSecrets } from "./support/fake-secrets.ts";

interface FakeContext {
  readonly ctx: PlatformContext;
  readonly provided: Map<string, unknown>;
  readonly disposers: (() => void | Promise<void>)[];
}

/** ext-host의 PlatformContext 대역. `existing`은 먼저 등록된 포트(이름 → API)다 */
function fakeContext(existing: ReadonlyMap<string, unknown>): FakeContext {
  const provided = new Map<string, unknown>();
  const disposers: (() => void | Promise<void>)[] = [];
  const ctx: PlatformContext = {
    providePort<Api>(key: PortKey<Api>, impl: Api): void {
      provided.set(key.name, impl);
    },
    port<Api>(key: PortKey<Api>): Api {
      if (!existing.has(key.name)) throw new Error(`port_unavailable: ${key.name}`);
      return portAs(key, existing.get(key.name));
    },
    onDispose(fn) {
      disposers.push(fn);
    },
  };
  return { ctx, provided, disposers };
}

const config = {
  options: {
    cwd: "/",
    shellPath: undefined,
    defaultTimeoutMs: 0,
    outputSpillBytes: 0,
    envExtra: [],
  },
  platform: darwinProvider,
  parentEnv: {},
};

const request = {
  refs: { GH_TOKEN: "secret://gh" },
  ctx: {
    purpose: "bash:gh",
    actor: "agent",
    threadId: null,
    toolCallId: null,
    projectId: null,
    approval: null,
  },
} as const;

function providedService(fake: FakeContext): ExecService {
  const service = fake.provided.get(ExecPortKey.name);
  if (service === undefined) throw new Error("xeon.exec was not provided");
  return portAs(ExecPortKey, service);
}

describe("createExecPlatformModule", () => {
  test("the module provides the xeon.exec port and cleans up on dispose", async () => {
    const module = createExecPlatformModule(config);
    expect(module.name).toBe("platform-exec");
    const fake = fakeContext(new Map());
    await module.setup(fake.ctx);
    expect(ExecPortKey.name).toBe("xeon.exec");
    expect(typeof providedService(fake).exec).toBe("function");
    expect(fake.disposers).toHaveLength(1);
    await fake.disposers[0]?.();
  });

  test("without xeon.secrets a secretEnv call fails as secret_unavailable", async () => {
    const fake = fakeContext(new Map());
    await createExecPlatformModule(config).setup(fake.ctx);
    const result = await providedService(fake).exec(
      "true",
      { secretEnv: request },
      { abortSignal: undefined },
    );
    expect(!result.ok && result.error.code).toBe("secret_unavailable");
  });

  test("the module wires xeon.secrets when it is registered first", async () => {
    const secrets = fakeSecrets({});
    const fake = fakeContext(new Map([[SecretServiceName, secrets]]));
    await createExecPlatformModule(config).setup(fake.ctx);
    const result = await providedService(fake).exec(
      "true",
      { secretEnv: request },
      { abortSignal: undefined },
    );
    expect(!result.ok && result.error.code).toBe("secret_unavailable");
    expect(secrets.calls).toHaveLength(1);
  });
});
