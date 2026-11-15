import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Logger } from "@fresnel/contracts";
import type { SessionService } from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  createAccess,
  readWebSettings,
  type WebAskAnswer,
  type WebAskRequest,
} from "@fresnel/cap-web";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import { createSettingsStore } from "../../src/assembly/settings-store.ts";
import { createWebPolicyWriter } from "../../src/assembly/web-policy-writer.ts";
import type { ProjectTrust } from "../../src/assembly/trust.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";
import { partial } from "../fixtures/unsafe.ts";

// L2.web.spec §4.5.5. "이 사이트 계속 허용"·"모든 사이트 허용"이 실제 설정 저장소(임시 디렉터리의 settings.json)에 쓰이고,
// 설정에서 되돌리면 다시 묻는다. 웹 정책 판정은 cap-web의 실제 `createAccess` 경로(`createWebRuntime`의 access)를 쓴다.

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};
const home = useEngineHome();
const cleanup: string[] = [];
const locks: OpenedFileLock[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await Promise.all(locks.splice(0).map((lock) => lock.dispose()));
  home.dispose();
});

async function rig() {
  const root = mkdtempSync(join(tmpdir(), "xh-webpolicy-"));
  cleanup.push(root);
  const configDir = join(root, "config");
  const file = join(configDir, "settings.json");
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const engine = createSettingsEngine(built.catalog);
  await engine.loadUserFile(file);
  const opened = await openFileLock(root);
  locks.push(opened);
  const store = createSettingsStore({
    engine,
    session: partial<SessionService>({}),
    configDir,
    fileLock: opened.fileLock,
    trust: partial<ProjectTrust>({}),
    ids: fixedIdFactory(),
    logger: SILENT,
    signal: new AbortController().signal,
    holds: () => false,
  });
  const writer = createWebPolicyWriter({
    catalog: built.catalog,
    store: () => store,
    layers: () => engine.layers(undefined),
  });
  const policy = () => readWebSettings(engine.layers(undefined)).policy;
  return { file, store, writer, policy };
}

function fileValues(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected an object");
  return Object.fromEntries(Object.entries(parsed));
}

test("allowHost writes the normalized host to the user allow list, keeps earlier hosts, and is idempotent", async () => {
  const fx = await rig();
  expect((await fx.writer.allowHost("Docs.Example.com")).ok).toBe(true);
  expect((await fx.writer.allowHost("api.example.org")).ok).toBe(true);
  expect((await fx.writer.allowHost("docs.example.com")).ok).toBe(true);
  expect(fileValues(fx.file)["l2.web.policy.allow"]).toEqual([
    "docs.example.com",
    "api.example.org",
  ]);
  expect(fx.policy().allow).toEqual(["docs.example.com", "api.example.org"]);
});

test("allowHost refuses a value that is not a domain pattern and writes nothing", async () => {
  const fx = await rig();
  const refused = await fx.writer.allowHost("2606:4700:4700::1111");
  expect(refused.ok).toBe(false);
  expect(fx.policy().allow).toEqual([]);
});

test("allowAllSites writes the default; resetting the key in the user scope restores ask", async () => {
  const fx = await rig();
  expect(fx.policy().default).toBe("ask");
  expect((await fx.writer.allowAllSites()).ok).toBe(true);
  expect(fileValues(fx.file)["l2.web.policy.default"]).toBe("allow");
  expect(fx.policy().default).toBe("allow");
  expect((await fx.store.reset("user", "l2.web.policy.default", undefined)).ok).toBe(true);
  expect(fx.policy().default).toBe("ask");
});

test("end to end: a this-site answer stops the domain question in another conversation; removing the host asks again", async () => {
  const fx = await rig();
  const ids = fixedIdFactory(7);
  const first = ids.next("thr");
  const second = ids.next("thr");
  const asked: WebAskRequest[] = [];
  const answers: WebAskAnswer[] = ["allow_site", "deny"];
  const access = createAccess({
    resolver: { resolve: () => Promise.resolve(ok(["93.184.216.34"])) },
    settings: () => readWebSettings(fx.store.layers(undefined)),
    seen: {
      note() {},
      noteText() {},
      has: () => Promise.resolve(ok(true)),
    },
    guard: undefined,
    policyWriter: fx.writer,
    asker: {
      ask(request) {
        asked.push(request);
        const answer = answers.shift();
        return Promise.resolve(
          answer === undefined ? err({ kind: "unavailable", message: "none" }) : ok(answer),
        );
      },
    },
  });
  const authorize = (url: string, threadId: typeof first) =>
    access.authorize(url, {
      threadId,
      caller: { kind: "host" },
      capability: "web.fetch",
      askKey: `${url}-${threadId}`,
      signal: new AbortController().signal,
    });

  expect((await authorize("https://docs.example.com/a", first)).ok).toBe(true);
  expect(asked.length).toBe(1);
  expect(fileValues(fx.file)["l2.web.policy.allow"]).toEqual(["docs.example.com"]);
  // 다른 대화: 묻지 않는다. 다른 호스트: 묻는다(거부)
  expect((await authorize("https://docs.example.com/b", second)).ok).toBe(true);
  expect(asked.length).toBe(1);
  expect((await authorize("https://other.example.org/", second)).ok).toBe(false);
  expect(asked.length).toBe(2);
  // 설정에서 호스트를 빼면 다시 묻는다
  expect((await fx.store.reset("user", "l2.web.policy.allow", undefined)).ok).toBe(true);
  expect((await authorize("https://docs.example.com/c", second)).ok).toBe(false);
  expect(asked.length).toBe(3);
});
