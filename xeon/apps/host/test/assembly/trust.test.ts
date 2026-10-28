import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import { createProjectTrust, type ProjectTrust } from "../../src/assembly/trust.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";

// 프로젝트 신뢰 질의와 결정(HS-58): 엔진은 프롬프트를 띄우지 않고, 결정은 `decide`로 저장 파일이나 세션 기억에 들어간다.
// 임시 디렉터리 위의 실제 저장 파일과 실제 OS 파일 잠금을 쓴다.

const SIGNAL = new AbortController().signal;
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

interface Rig {
  readonly trust: ProjectTrust;
  readonly workspace: string;
  readonly root: string;
  readonly configDir: string;
  readonly trustFile: string;
}

async function lockFor(root: string): Promise<OpenedFileLock> {
  const opened = await openFileLock(root);
  locks.push(opened);
  return opened;
}

async function trustAt(
  root: string,
  configDir: string,
  defaultTrust: "ask" | "always" | "never" = "ask",
): Promise<ProjectTrust> {
  const { fileLock } = await lockFor(root);
  return createProjectTrust({
    configDir,
    fileLock,
    homeDir: join(root, "home"),
    clock: { now: () => 1_000 },
    logger: SILENT,
    defaultTrust: () => defaultTrust,
  });
}

async function rig(defaultTrust: "ask" | "always" | "never" = "ask"): Promise<Rig> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-trust-")));
  cleanup.push(root);
  const configDir = join(root, "config");
  mkdirSync(configDir, { recursive: true });
  const workspace = join(root, "projects", "app");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, ".mcp.json"), "{}");
  return {
    trust: await trustAt(root, configDir, defaultTrust),
    workspace,
    root,
    configDir,
    trustFile: join(configDir, "trust.json"),
  };
}

test("a project with trust-requiring files and no decision is undecided and offers every choice", async () => {
  const { trust, workspace } = await rig();
  const inspected = await trust.inspect(workspace, SIGNAL);
  expect(inspected.result).toMatchObject({
    projectRoot: workspace,
    required: true,
    trusted: false,
    verdict: "undecided",
    via: "headless",
  });
  expect(inspected.result.resources).toContain(".mcp.json");
  expect(inspected.options.map((option) => option.label)).toEqual([
    "trust-folder",
    "trust-parent",
    "trust-session",
    "deny-folder",
    "deny-session",
  ]);
  expect(await trust.isTrusted(workspace, SIGNAL)).toBe(false);
});

test("a folder decision is saved and wins over an earlier session choice", async () => {
  const { trust, workspace, trustFile } = await rig();
  await trust.decide(workspace, { kind: "session", verdict: "deny" }, SIGNAL);
  expect((await trust.inspect(workspace, SIGNAL)).result).toMatchObject({
    verdict: "deny",
    via: "sessionMemory",
  });
  const decided = await trust.decide(workspace, { kind: "folder", verdict: "allow" }, SIGNAL);
  if (!decided.ok) throw new Error("expected the decision to be applied");
  expect(decided.value.result).toMatchObject({ trusted: true, verdict: "allow", via: "store" });
  expect(readFileSync(trustFile, "utf8")).toContain(workspace);
  expect(await trust.isTrusted(workspace, SIGNAL)).toBe(true);
});

test("a parent decision trusts the parent folder and drops the entry of this folder", async () => {
  const { trust, workspace, trustFile } = await rig();
  await trust.decide(workspace, { kind: "folder", verdict: "deny" }, SIGNAL);
  const decided = await trust.decide(workspace, { kind: "parent", verdict: "allow" }, SIGNAL);
  if (!decided.ok) throw new Error("expected the decision to be applied");
  expect(decided.value.result.trusted).toBe(true);
  const stored = readFileSync(trustFile, "utf8");
  expect(stored).toContain(dirname(workspace));
  expect(stored).not.toContain(`"${workspace}"`);
});

test("a session decision is not saved", async () => {
  const { trust, workspace, trustFile } = await rig();
  const decided = await trust.decide(workspace, { kind: "session", verdict: "allow" }, SIGNAL);
  if (!decided.ok) throw new Error("expected the decision to be applied");
  expect(decided.value.result).toMatchObject({ trusted: true, via: "sessionMemory" });
  expect(() => readFileSync(trustFile, "utf8")).toThrow();
});

test("a choice that is not among the options is refused and changes nothing", async () => {
  const { trust, workspace } = await rig();
  // 상위 폴더 선택지는 허용 하나뿐이다
  const refused = await trust.decide(workspace, { kind: "parent", verdict: "deny" }, SIGNAL);
  expect(refused).toEqual({ ok: false, error: { kind: "invalid_choice" } });
  expect((await trust.inspect(workspace, SIGNAL)).result.verdict).toBe("undecided");
});

test("a project without trust-requiring files is allowed and can still be decided ahead of time", async () => {
  const { trust } = await rig();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-trust-empty-")));
  cleanup.push(root);
  const empty = await trust.inspect(root, SIGNAL);
  expect(empty.result).toMatchObject({ required: false, verdict: "allow", via: "notRequired" });
  const decided = await trust.decide(root, { kind: "folder", verdict: "deny" }, SIGNAL);
  expect(decided.ok).toBe(true);
});

test("a corrupt trust file refuses the decision and keeps the file as it was", async () => {
  const { trust, workspace, trustFile } = await rig();
  writeFileSync(trustFile, "{not json");
  const refused = await trust.decide(workspace, { kind: "folder", verdict: "allow" }, SIGNAL);
  expect(refused).toEqual({ ok: false, error: { kind: "store_failed", reason: "corrupt" } });
  expect(readFileSync(trustFile, "utf8")).toBe("{not json");
});

test("the default policy always is trusted without a decision", async () => {
  const { trust, workspace } = await rig("always");
  expect((await trust.inspect(workspace, SIGNAL)).result).toMatchObject({
    verdict: "allow",
    via: "default",
  });
});

// G1-10: CLI의 `xeon trust`와 데스크톱 카드는 각자의 호스트 프로세스로 같은 trust.json에 쓴다. 서비스가 다른 두 신뢰 저장소가
// 동시에 결정을 저장해도 어느 쪽 결정도 잃지 않는다(잠금이 없으면 나중 쓰기가 앞 쓰기를 덮는다).
test("two hosts deciding at the same time lose no decision", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-trust-two-")));
  cleanup.push(root);
  const configDir = join(root, "config");
  mkdirSync(configDir, { recursive: true });
  const first = await trustAt(join(root, "a"), configDir);
  const second = await trustAt(join(root, "b"), configDir);
  const workspaces: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const workspace = join(root, "projects", `app-${String(index)}`);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, ".mcp.json"), "{}");
    workspaces.push(workspace);
  }
  const results = await Promise.all(
    workspaces.map((workspace, index) =>
      (index % 2 === 0 ? first : second).decide(
        workspace,
        { kind: "folder", verdict: "allow" },
        SIGNAL,
      ),
    ),
  );
  expect(results.every((result) => result.ok)).toBe(true);
  const stored: unknown = JSON.parse(readFileSync(join(configDir, "trust.json"), "utf8"));
  expect(entryPathsOf(stored)).toEqual(workspaces.toSorted());
});

/** 저장 파일 `{ version, entries: { <폴더>: ... } }`의 폴더 경로들 */
function entryPathsOf(stored: unknown): string[] {
  if (typeof stored !== "object" || stored === null || !("entries" in stored)) return [];
  const entries: unknown = stored.entries;
  return typeof entries === "object" && entries !== null ? Object.keys(entries).toSorted() : [];
}
