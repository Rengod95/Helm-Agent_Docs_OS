import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import {
  defineCapability,
  parseSecretRef,
  WorkspaceShell,
  WorkspaceShellKey,
  type SecretAuditRecord,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
} from "@xeon/contracts/capabilities";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { ToolServicePortKey } from "@xeon/contracts/services";
import { hostOf, type BuiltinExtensionModule } from "@xeon/ext-host";
import type { EventWire, HostConnection } from "@xeon/contracts/wire";
import { memorySecrets, type MemorySecrets } from "@xeon/platform-secrets/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "./call-tape.ts";
import { useEngineHome } from "./engine-home.ts";
import { toolResultTexts } from "./tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "./user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  type EventCollector,
} from "./wire-client.ts";

// U-19 종단 시험의 조립: 모델 테이프가 `secretEnv`를 쓰는 bash 호출을 내고, 호스트가 비밀 사용 승인을 올린다.
// 비밀 서비스는 `AssembleOptions.secretsRuntime`으로 바꾼 메모리 대역(`memorySecrets`)이다: sops와 age 키는 쓰지 않고
// 정책 판정, lease, 감사 기록은 운영 구현 그대로다. 명령은 실제로 실행된다(샌드박스는 끈다).

const parsedRef = parseSecretRef("secret://github-token");
if (!parsedRef.ok) throw new Error("the fixture secret reference is invalid");
const SECRET_NAME: SecretName = parsedRef.value.name;
export const SECRET_REF: SecretHandle = parsedRef.value.handle;
/** 와이어, 이벤트, 도구 결과 어디에도 나오면 안 되는 가짜 값 */
export const SECRET_VALUE = "xeon-fake-token-7f3a91c2d4e85b60";
/** env에 값이 들어왔을 때만 표지를 내는 명령. 값은 출력하지 않는다 */
const SECRET_COMMAND = "printenv GH_TOKEN >/dev/null && echo secret-env-present";

/** 시험용 도구 이름. 운영 `bash` 도구는 `secretEnv`를 모델에 노출하지 않는다(L2.workspace.spec §3.3) */
export const SECRET_TOOL = "bash_env";

const SecretShellParams = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    secretEnv: Type.Record(Type.String(), Type.String()),
  },
  { additionalProperties: false },
);

/**
 * 운영의 `bash` 도구는 모델 파라미터에 `secretEnv`가 없다(L1.tools.spec §8 [미결]: 모델 도구 호출이 `secretEnv`를 받는 경로). 그래서 같은 셸 서비스
 * (`workspace.shell`의 `run`) 위에 `secretEnv`를 받는 시험 전용 도구 하나를 더한다. 도구 스키마만 다르고, 그 아래 승인 증거 전달,
 * 셸 서비스, 실제 명령 실행, env 주입, lease, 감사는 모두 운영 코드다.
 */
const SecretShellDef = defineCapability({
  id: WorkspaceShell.id,
  version: WorkspaceShell.version,
  description: WorkspaceShell.description,
  service: WorkspaceShell.service,
  tools: [
    {
      name: SECRET_TOOL,
      label: "Shell with secrets",
      method: "run",
      parameters: SecretShellParams,
      toInput: (p: Static<typeof SecretShellParams>) => ({
        command: p.command,
        failOnNonZero: true,
        secretEnv: p.secretEnv,
      }),
      description: "Runs a bash command with secrets injected into its environment (test only).",
      replay: "unsafe",
      executionMode: "sequential",
    },
  ],
});

const secretToolManifest = defineManifest({
  schemaVersion: 1,
  name: "secret-env-test-tool",
  version: "0.1.0",
  layer: "plugin",
  kind: "plugin",
  entry: "./index.ts",
  points: [],
  usesDrive: false,
  trust: { level: "builtin" },
});

const secretToolEntry: ExtensionEntry = ({ manifest: loaded, scope }) => {
  scope(loaded.name, {}, (g) => {
    const registered = hostOf(g)
      .port(ToolServicePortKey)
      .register({
        kind: "capability",
        def: SecretShellDef,
        key: WorkspaceShellKey,
        policy: { [SECRET_TOOL]: { risk: "exec" } },
      });
    if (!registered.ok) throw new Error(`tool registration failed: ${registered.error.kind}`);
    g.onDispose(registered.value);
  });
};

const secretToolModule: BuiltinExtensionModule = {
  manifest: secretToolManifest,
  extension: secretToolEntry,
};

function metaOf(): SecretMeta {
  return {
    name: SECRET_NAME,
    desc: "GitHub token for the host int test",
    provider: "sops",
    ref: "dev/GITHUB_TOKEN",
    scope: "user",
    expiresAt: null,
    use: { modes: ["env"], tools: ["bash:printenv"], hosts: [], commands: [SECRET_COMMAND] },
    approval: "per-use",
    ttlSeconds: 900,
    maxUses: 5,
  };
}

export interface SecretEnvScenario {
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  /** 첫 `approval.requested`. 정책 승인이거나(`allowBashByRule` false) 비밀 사용 승인이다 */
  readonly asked: EventWire;
  readonly secrets: MemorySecrets;
  /** 승인을 허용하고 turn이 끝날 때까지 기다린다 */
  allow(): Promise<{ readonly applied: boolean }>;
  auditRecords(): readonly SecretAuditRecord[];
  texts(): string;
  close(): Promise<void>;
}

export interface SecretEnvOptions {
  /** true면 사용자 규칙이 bash를 허용해, 비밀 사용을 묻는 승인(규칙 `secret.use`)이 따로 올라온다 */
  readonly allowBashByRule?: boolean;
}

export async function startSecretEnvScenario(
  options: SecretEnvOptions = {},
): Promise<SecretEnvScenario> {
  const home = useEngineHome();
  writeUserSettings(home, {
    ...TAPE_SETTINGS,
    "l0.sandbox.enabled": false,
    "l1.tools.rules": [
      {
        id: "u.bash-env",
        action: "tool.call",
        resource: { tool: SECRET_TOOL },
        effect: options.allowBashByRule === true ? "allow" : "ask",
      },
    ],
  });
  const workspace = mkdtempSync(join(tmpdir(), "xh-secret-env-"));
  const previousCwd = process.cwd();
  // 엔진은 시작할 때의 작업 폴더를 도구의 root로 잡는다(cap-workspace)
  process.chdir(workspace);
  const holder: { secrets: MemorySecrets | undefined } = { secrets: undefined };
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [secretToolModule],
    buildModels: callingModels("secret-env", [
      { name: SECRET_TOOL, args: { command: SECRET_COMMAND, secretEnv: { GH_TOKEN: SECRET_REF } } },
    ]),
    secretsRuntime: (deps) => {
      const secrets = memorySecrets({
        clock: deps.os.time.clock,
        scheduler: deps.os.time.scheduler,
        ids: deps.ids,
        secrets: [{ meta: metaOf(), value: SECRET_VALUE }],
      });
      holder.secrets = secrets;
      return { service: secrets, admin: secrets.admin };
    },
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", { workspace });
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "use the token",
    });
    const asked = await collector
      .waitFor((event) => event.kind === "approval.requested")
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${reason}; tool results: ${toolResultTexts(collector.events).join(" | ")}`,
        );
      });
    const secrets = holder.secrets;
    if (secrets === undefined) throw new Error("the secrets runtime was not built");
    return {
      connection,
      collector,
      threadId: created.threadId,
      turnId: started.turnId,
      asked,
      secrets,
      async allow() {
        const answered = await connection.request("approval.respond", {
          approvalId: asked.id,
          decision: "allow",
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        );
        return answered;
      },
      auditRecords: () => secrets.auditRecords(),
      texts: () => toolResultTexts(collector.events).join("\n"),
      async close() {
        await connection.close();
        await host.close();
        process.chdir(previousCwd);
        rmSync(workspace, { recursive: true, force: true });
        home.dispose();
      },
    };
  } catch (error) {
    await connection.close();
    await host.close();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
    throw error;
  }
}
