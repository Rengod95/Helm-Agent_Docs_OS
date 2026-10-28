import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, type Logger } from "@xeon/contracts";
import {
  SecretNameSchema,
  type SecretMeta,
  type SecretName,
  type SecretUsePolicy,
} from "@xeon/contracts/capabilities";
import type { SecretMetaPatch } from "@xeon/contracts/services";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";
import {
  createProviderLinker,
  linkPatchOf,
  modelProviderPurpose,
  useWithModelProvider,
  userProviderLinks,
} from "../../src/secrets/provider-link.ts";
import { createFakeSecrets, sampleMeta } from "../fixtures/fake-secrets.ts";

// HS-45 [결정: M2 Mac 실기]. 모델 provider 연결이 비밀 메타에 더하는 허용은 정확히 그 호출 하나다: runtime-http, `model.provider:<id>`, provider 호스트.

const scratch = mkdtempSync(join(tmpdir(), "xh-link-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const KEY = nameOf("anthropic-api-key");
const ANTHROPIC = { host: "api.anthropic.com", port: null } as const;
const EMPTY: SecretUsePolicy = { modes: [], tools: [], hosts: [] };

function metaWith(use: SecretUsePolicy, approval: SecretMeta["approval"]): SecretMeta {
  return { ...sampleMeta(KEY), use, approval };
}

function quietLogger(onWarn: (message: string) => void = () => {}): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn: onWarn,
    error() {},
    child: () => logger,
  };
  return logger;
}

let counter = 0;
async function engineWith(values: Readonly<Record<string, unknown>>): Promise<SettingsEngine> {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const settings = createSettingsEngine(built.catalog);
  counter += 1;
  const path = join(scratch, `settings-${counter}.json`);
  writeFileSync(path, JSON.stringify(values));
  await settings.loadUserFile(path);
  return settings;
}

function catalogOf(): ReturnType<typeof createSettingsEngine>["catalog"] {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return built.catalog;
}

test("a fresh secret gets exactly the model provider use: runtime-http, the purpose and the host, approval none", () => {
  const patch = linkPatchOf(metaWith(EMPTY, "per-session"), "anthropic", ANTHROPIC);
  expect(patch).toEqual({
    use: {
      modes: ["runtime-http"],
      tools: ["model.provider:anthropic"],
      hosts: ["api.anthropic.com"],
    },
    approval: "none",
  });
  // env 모드, 도구 이름, 다른 호스트, 별표 와일드카드는 들어 있지 않다
  expect(patch?.use?.modes).not.toContain("env");
  expect(patch?.use?.tools.some((tool) => tool.includes("*") || tool.startsWith("bash"))).toBe(
    false,
  );
});

test("a non-default port is written with the host because the policy matches only 443 otherwise", () => {
  const use = useWithModelProvider(EMPTY, "anthropic", { host: "127.0.0.1", port: 8443 });
  expect(use.hosts).toEqual(["127.0.0.1:8443"]);
  expect(modelProviderPurpose("anthropic")).toBe("model.provider:anthropic");
});

test("the grant is idempotent: nothing to write when the use is already there", () => {
  const first = linkPatchOf(metaWith(EMPTY, "per-session"), "anthropic", ANTHROPIC);
  if (first === null || first.use === undefined) throw new Error("a fresh secret needs a patch");
  const second = linkPatchOf(
    metaWith(first.use, first.approval ?? "per-session"),
    "anthropic",
    ANTHROPIC,
  );
  expect(second).toBeNull();
});

test("a second provider on the same secret adds its own purpose and host and keeps the first", () => {
  const first = useWithModelProvider(EMPTY, "anthropic", ANTHROPIC);
  const both = useWithModelProvider(first, "gateway", { host: "gw.example.test", port: null });
  expect(both).toEqual({
    modes: ["runtime-http"],
    tools: ["model.provider:anthropic", "model.provider:gateway"],
    hosts: ["api.anthropic.com", "gw.example.test"],
  });
});

test("a policy a person already widened keeps its other uses and its approval", () => {
  const widened: SecretUsePolicy = {
    modes: ["env"],
    tools: ["bash:printenv"],
    hosts: [],
    commands: ["printenv KEY"],
  };
  const patch = linkPatchOf(metaWith(widened, "per-use"), "anthropic", ANTHROPIC);
  expect(patch).toEqual({
    use: {
      modes: ["env", "runtime-http"],
      tools: ["bash:printenv", "model.provider:anthropic"],
      hosts: ["api.anthropic.com"],
      commands: ["printenv KEY"],
    },
    approval: "per-use",
  });
});

test("only enabled user-scope provider entries with a well-formed secret reference are links", async () => {
  const settings = await engineWith({
    "l1.models.providers": [
      { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
      { id: "off", enabled: false, apiKeyRef: "secret://off-key", baseUrl: null },
      { id: "nokey", enabled: true, apiKeyRef: null, baseUrl: null },
    ],
  });
  const links = userProviderLinks(settings, catalogOf());
  expect(links.map((link) => [link.providerId, link.name])).toEqual([["anthropic", KEY]]);
  expect(userProviderLinks(await engineWith({}), catalogOf())).toEqual([]);
});

test("the linker patches an existing secret once and leaves a missing secret for its creation", async () => {
  const settings = await engineWith({
    "l1.models.providers": [
      { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
      { id: "other", enabled: true, apiKeyRef: "secret://other-key", baseUrl: null },
    ],
  });
  const fake = createFakeSecrets();
  fake.records.set(KEY, {
    meta: metaWith(EMPTY, "per-session"),
    exists: true,
    decryptable: true,
    value: "sk-fake-0123456789",
    lastUsedAt: null,
    activeLeases: 0,
  });
  const patches: SecretMetaPatch[] = [];
  const admin = {
    ...fake.port.admin,
    meta: (handle: Parameters<typeof fake.port.admin.meta>[0], patch: SecretMetaPatch) => {
      patches.push(patch);
      return fake.port.admin.meta(handle, patch);
    },
  };
  const warnings: string[] = [];
  const linker = createProviderLinker({
    admin,
    settings,
    catalog: catalogOf(),
    targetOf: (id) => (id === "anthropic" ? ANTHROPIC : null),
    logger: quietLogger((message) => warnings.push(message)),
  });
  await linker.link();
  expect(patches).toEqual([
    {
      use: {
        modes: ["runtime-http"],
        tools: ["model.provider:anthropic"],
        hosts: ["api.anthropic.com"],
      },
      approval: "none",
    },
  ]);
  // 두 번째 호출은 이미 허용돼 있어 아무것도 쓰지 않는다. 없는 비밀(other-key)은 경고 없이 건너뛴다
  await linker.link();
  expect(patches).toHaveLength(1);
  expect(warnings).toEqual([]);
});

test("grantFor gives a new secret its policy only when a user setting already links its name", async () => {
  const settings = await engineWith({
    "l1.models.providers": [
      { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
    ],
  });
  const linker = createProviderLinker({
    admin: createFakeSecrets().port.admin,
    settings,
    catalog: catalogOf(),
    targetOf: () => ANTHROPIC,
    logger: quietLogger(),
  });
  expect(linker.grantFor(KEY)).toEqual({
    use: {
      modes: ["runtime-http"],
      tools: ["model.provider:anthropic"],
      hosts: ["api.anthropic.com"],
    },
    approval: "none",
  });
  expect(linker.grantFor(nameOf("unrelated-key"))).toBeUndefined();
});
