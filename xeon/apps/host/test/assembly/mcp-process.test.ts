import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Logger, type Result } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  ProcessServiceName,
  SandboxServiceName,
  type BackgroundRegistry,
  type ProcessService,
  type RegisterBackgroundInput,
  type SandboxArgvRequest,
  type SandboxPolicy,
  type SandboxService,
  type SandboxWrapError,
  type SandboxedArgv,
  type SecretService,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import { createHostMcpProcessPort } from "../../src/assembly/mcp-process.ts";
import { createManualScheduler } from "../fixtures/manual-scheduler.ts";
import { partial } from "../fixtures/unsafe.ts";

// G1-04, ADR-0011: 조립 루트가 L0의 McpProcessPort를 만든다. 레지스트리는 xeon.process의 것이고, 비밀 env 서버는 기동 승인 지점이 없어
// secret_denied로 끝난다(자식을 띄우지 않는다).
// P-15: 샌드박스를 요청한 서버(`sandbox: true`)는 xeon.sandbox의 `wrapArgv` 명령줄로 뜬다. xeon.sandbox는 이 포트보다 늦게 올라오므로
// spawn 때마다 찾고, 없거나 격리할 수 없으면 `sandbox_unavailable`로 막힌다. 자식이 떴는지는 표식 파일로 본다.

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

/** 조회할 서비스. 시험이 조회 뒤에 채울 수 있게 가변이다(조립 순서: xeon.sandbox는 나중에 올라온다) */
interface Services {
  process?: ProcessService;
  sandbox?: SandboxService;
}

function extWith(services: Services): Pick<ExtHost, "ports"> {
  return partial<Pick<ExtHost, "ports">>({
    ports: partial<ExtHost["ports"]>({
      get: partial<ExtHost["ports"]["get"]>((key: { readonly name: string }) => {
        if (key.name === ProcessServiceName) return services.process;
        if (key.name === SandboxServiceName) return services.sandbox;
        return undefined;
      }),
    }),
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
const MARKER_CHILD = join(import.meta.dir, "..", "fixtures", "marker-child.ts");
const EMPTY_POLICY: SandboxPolicy = {
  writeRoots: [],
  readDeny: [],
  writeDeny: [],
  network: { allowedDomains: [], deniedDomains: [] },
  allowEscape: false,
};

const scratchDirs: string[] = [];

/** 시험마다 임시 디렉터리를 하나 쓴다. 끝나면 지운다 */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-mcp-process-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface FakeSandbox {
  readonly service: SandboxService;
  /** defaultPolicy에 넘어온 tempDir */
  readonly policyTempDirs: string[];
  /** wrapArgv에 넘어온 요청 */
  readonly wrapped: SandboxArgvRequest[];
}

/** wrapArgv가 `wrap`의 결과를 돌려주는 가짜 샌드박스. 쓰는 두 멤버만 채운다 */
function fakeSandbox(
  wrap: (request: SandboxArgvRequest) => Result<SandboxedArgv, SandboxWrapError>,
): FakeSandbox {
  const policyTempDirs: string[] = [];
  const wrapped: SandboxArgvRequest[] = [];
  const service = partial<SandboxService>({
    defaultPolicy: (input) => {
      policyTempDirs.push(input.tempDir);
      return EMPTY_POLICY;
    },
    wrapArgv: (_policy, request) => {
      wrapped.push(request);
      return Promise.resolve(wrap(request));
    },
  });
  return { service, policyTempDirs, wrapped };
}

function markerArgv(marker: string): SandboxedArgv {
  return { argv: [NODE, MARKER_CHILD, marker], env: {}, sandboxed: true, cleanup: () => undefined };
}

test("without xeon.process there is no port, so stdio servers fail to connect instead of starting", () => {
  const port = createHostMcpProcessPort({
    ext: extWith({}),
    secrets: partial<SecretService>({}),
    tempDir: tmpdir(),
    scheduler: createManualScheduler(),
    parentEnv: {},
    logger: LOGGER,
  });
  expect(port).toBeUndefined();
});

test("a server is started as a child and registered in the xeon.process registry under the mcp owner", async () => {
  const { registry, seen } = recordingRegistry();
  const port = createHostMcpProcessPort({
    ext: extWith({ process: partial<ProcessService>({ background: registry }) }),
    secrets: partial<SecretService>({}),
    tempDir: tmpdir(),
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
    ext: extWith({ process: partial<ProcessService>({ background: registry }) }),
    secrets,
    tempDir: tmpdir(),
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
  // 승인 증거가 없는 채로 물었고, 기동 목적(mcp.start:)과 대상(mcp:<서버 id>)이 L0.secrets의 기동 맥락과 같다
  expect(asked).toEqual([`${reference.value.handle} mcp.start:gh no-approval`]);
  expect(seen).toEqual([]);
});

test("a sandboxed server runs the command line that xeon.sandbox wraps, with the given temp dir as the policy's temp root", async () => {
  const dir = scratch();
  const marker = join(dir, "ran");
  const tempDir = join(dir, "tmp");
  const sandbox = fakeSandbox(() => ok(markerArgv(marker)));
  const { registry } = recordingRegistry();
  const port = createHostMcpProcessPort({
    ext: extWith({
      process: partial<ProcessService>({ background: registry }),
      sandbox: sandbox.service,
    }),
    secrets: partial<SecretService>({}),
    tempDir,
    scheduler: createManualScheduler(),
    parentEnv: { PATH: process.env["PATH"] },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spawned = await port.spawn(
    {
      command: NODE,
      args: ["-e", "process.exit(9)"],
      cwd: undefined,
      secretEnv: {},
      sandbox: true,
      label: "sandboxed",
      server: "sb",
    },
    new AbortController().signal,
  );
  if (!spawned.ok) throw new Error(`spawn failed: ${spawned.error.kind}`);
  await spawned.value.exited;
  expect(sandbox.policyTempDirs).toEqual([tempDir]);
  expect(sandbox.wrapped).toEqual([
    { command: NODE, args: ["-e", "process.exit(9)"], cwd: undefined },
  ]);
  // 감싼 명령줄이 떴다. 요청의 명령(`process.exit(9)`)이 떴다면 표식 파일이 없다
  expect(existsSync(marker)).toBe(true);
});

test("xeon.sandbox is looked up at spawn time: a server refused before it appears starts after it does", async () => {
  const dir = scratch();
  const marker = join(dir, "ran");
  const { registry } = recordingRegistry();
  const services: Services = { process: partial<ProcessService>({ background: registry }) };
  // 샌드박스 서비스가 없는 채로 포트를 만든다
  const port = createHostMcpProcessPort({
    ext: extWith(services),
    secrets: partial<SecretService>({}),
    tempDir: join(dir, "tmp"),
    scheduler: createManualScheduler(),
    parentEnv: { PATH: process.env["PATH"] },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spec = {
    command: NODE,
    args: [MARKER_CHILD, marker],
    cwd: undefined,
    secretEnv: {},
    sandbox: true,
    label: "late sandbox",
    server: "late",
  } as const;
  const before = await port.spawn(spec, new AbortController().signal);
  expect(before).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "service_missing" },
  });
  expect(existsSync(marker)).toBe(false);

  // 서비스가 올라온 뒤의 spawn은 같은 포트로 그 서비스를 쓴다
  const sandbox = fakeSandbox(() => ok(markerArgv(join(dir, "wrapped"))));
  services.sandbox = sandbox.service;
  const after = await port.spawn(spec, new AbortController().signal);
  if (!after.ok) throw new Error(`spawn failed: ${after.error.kind}`);
  await after.value.exited;
  expect(sandbox.wrapped).toHaveLength(1);
  expect(sandbox.policyTempDirs).toEqual([join(dir, "tmp")]);
  expect(existsSync(join(dir, "wrapped"))).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("without xeon.sandbox a sandboxed server is refused as service_missing and no child runs", async () => {
  const dir = scratch();
  const marker = join(dir, "ran");
  const { registry, seen } = recordingRegistry();
  const port = createHostMcpProcessPort({
    ext: extWith({ process: partial<ProcessService>({ background: registry }) }),
    secrets: partial<SecretService>({}),
    tempDir: dir,
    scheduler: createManualScheduler(),
    parentEnv: { PATH: process.env["PATH"] },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spec = {
    command: NODE,
    args: [MARKER_CHILD, marker],
    cwd: undefined,
    secretEnv: {},
    label: "no sandbox",
    server: "nosb",
  } as const;
  const refused = await port.spawn({ ...spec, sandbox: true }, new AbortController().signal);
  expect(refused).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "service_missing" },
  });
  expect(existsSync(marker)).toBe(false);
  expect(seen).toEqual([]);

  // 대조: 같은 요청을 샌드박스 없이 내면 자식이 뜨고 표식을 남긴다. 표식 검사가 빈 검사가 아님을 보인다
  const plain = await port.spawn(spec, new AbortController().signal);
  if (!plain.ok) throw new Error(`spawn failed: ${plain.error.kind}`);
  await plain.value.exited;
  expect(existsSync(marker)).toBe(true);
});

test("a sandbox that cannot isolate here refuses the server with its own reason and no child runs", async () => {
  const dir = scratch();
  const marker = join(dir, "ran");
  const sandbox = fakeSandbox(() => err({ kind: "unavailable", reason: "missing_dependency" }));
  const { registry, seen } = recordingRegistry();
  const port = createHostMcpProcessPort({
    ext: extWith({
      process: partial<ProcessService>({ background: registry }),
      sandbox: sandbox.service,
    }),
    secrets: partial<SecretService>({}),
    tempDir: dir,
    scheduler: createManualScheduler(),
    parentEnv: { PATH: process.env["PATH"] },
    logger: LOGGER,
  });
  if (port === undefined) throw new Error("expected a port");
  const spawned = await port.spawn(
    {
      command: NODE,
      args: [MARKER_CHILD, marker],
      cwd: undefined,
      secretEnv: {},
      sandbox: true,
      label: "unavailable",
      server: "unavail",
    },
    new AbortController().signal,
  );
  expect(spawned).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "missing_dependency" },
  });
  expect(sandbox.wrapped).toHaveLength(1);
  expect(existsSync(marker)).toBe(false);
  expect(seen).toEqual([]);
});
