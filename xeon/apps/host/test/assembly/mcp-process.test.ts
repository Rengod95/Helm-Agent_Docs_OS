import { expect, test } from "bun:test";
import { err, ok, type Logger } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import type {
  BackgroundRegistry,
  ProcessService,
  RegisterBackgroundInput,
  SecretService,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import { createHostMcpProcessPort } from "../../src/assembly/mcp-process.ts";
import { createManualScheduler } from "../fixtures/manual-scheduler.ts";
import { partial } from "../fixtures/unsafe.ts";

// G1-04, ADR-0011: 조립 루트가 L0의 McpProcessPort를 만든다. 레지스트리는 xeon.process의 것이고, 비밀 env 서버는 기동 승인 지점이 없어
// secret_denied로 끝난다(자식을 띄우지 않는다).

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

function extWith(service: ProcessService | undefined): Pick<ExtHost, "ports"> {
  return partial<Pick<ExtHost, "ports">>({
    ports: partial<ExtHost["ports"]>({ get: partial<ExtHost["ports"]["get"]>(() => service) }),
  });
}

function recordingRegistry(): {
  readonly registry: BackgroundRegistry;
  readonly seen: RegisterBackgroundInput[];
} {
  const seen: RegisterBackgroundInput[] = [];
  const registry = partial<BackgroundRegistry>({
    register: (input) => {
      seen.push(input);
      return ok("bgp_1");
    },
  });
  return { registry, seen };
}

const NODE = process.execPath;

test("without xeon.process there is no port, so stdio servers fail to connect instead of starting", () => {
  const port = createHostMcpProcessPort({
    ext: extWith(undefined),
    secrets: partial<SecretService>({}),
    scheduler: createManualScheduler(),
    parentEnv: {},
    logger: LOGGER,
  });
  expect(port).toBeUndefined();
});

test("a server is started as a child and registered in the xeon.process registry under the mcp owner", async () => {
  const { registry, seen } = recordingRegistry();
  const port = createHostMcpProcessPort({
    ext: extWith(partial<ProcessService>({ background: registry })),
    secrets: partial<SecretService>({}),
    scheduler: createManualScheduler(),
    parentEnv: { PATH: process.env["PATH"], SECRET_TOKEN: "must-not-pass" },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spawned = await port.spawn(
    {
      command: NODE,
      args: ["-e", "process.stdin.resume()"],
      cwd: undefined,
      secretEnv: {},
      label: "fixture server",
      server: "fixture",
    },
    new AbortController().signal,
  );
  if (!spawned.ok) throw new Error(`spawn failed: ${spawned.error.kind}`);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.label).toBe("fixture server");
  expect(seen[0]?.owner).toEqual({ kind: "mcp", threadId: null, ref: "fixture" });
  expect(seen[0]?.pid).toBe(spawned.value.pid);
  spawned.value.stdin.end();
  await spawned.value.exited;
});

test("a server whose environment needs a secret is secret_denied and nothing is started", async () => {
  const { registry, seen } = recordingRegistry();
  const asked: string[] = [];
  const secrets = partial<SecretService>({
    withEnv: (handle, ctx) => {
      asked.push(`${handle} ${ctx.purpose} ${ctx.approval === null ? "no-approval" : "approval"}`);
      return Promise.resolve(err({ kind: "denied", handle, reason: "approval_missing" }));
    },
  });
  const port = createHostMcpProcessPort({
    ext: extWith(partial<ProcessService>({ background: registry })),
    secrets,
    scheduler: createManualScheduler(),
    parentEnv: {},
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const reference = parseSecretRef("secret://github-token");
  if (!reference.ok) throw new Error("fixture reference must be valid");
  const spawned = await port.spawn(
    {
      command: NODE,
      args: ["-e", "process.exit(0)"],
      cwd: undefined,
      secretEnv: { GITHUB_TOKEN: "secret://github-token" },
      label: "needs a secret",
      server: "gh",
    },
    new AbortController().signal,
  );
  expect(spawned).toEqual({
    ok: false,
    error: { kind: "secret_denied", ref: "secret://github-token" },
  });
  // 승인 증거가 없는 채로 물었다(기동 시점에 승인 지점이 없다)
  expect(asked).toEqual([`${reference.value.handle} mcp:gh no-approval`]);
  expect(seen).toEqual([]);
});
