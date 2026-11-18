import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.4 (int, 실제 엔진): 프로젝트 목록과 한 건 읽기, 이름 바꾸기, 기록만 지우기, 지침 파일 목록.
// 프로젝트 소속은 대화 폴더가 속한 가장 깊은 루트로 정해지고, 대화를 만들 때 루트가 없으면 그 폴더로 프로젝트가 생긴다(§4.4.3).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Engine {
  readonly connection: HostConnection;
  close(): Promise<void>;
}

/** 실제 엔진을 임시 홈에 세우고 hello까지 맞춘 연결을 돌려준다. `close`가 연결, 엔진, 홈을 정리한다 */
async function openEngine(): Promise<Engine> {
  const home = useEngineHome();
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return {
    connection,
    async close() {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

/** 실패한 호출의 와이어 오류. 와이어 오류가 아니면 시험을 실패시킨다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw new Error("expected the request to fail with a WireError");
}

/** 임시 폴더 하나. 심볼릭 링크를 푼 정규 경로로 돌려준다(대화 폴더와 루트 비교가 정규 경로로 이뤄진다) */
function tempBase(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "xh-project-wire-")));
}

realTest(
  "project.list counts the threads under each project: a thread in a subfolder counts for its project, a folder outside every project makes its own, and a deleted thread stops counting",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    const base = tempBase();
    try {
      const main = join(base, "main");
      const sub = join(main, "sub");
      const other = join(base, "other");
      for (const folder of [main, sub, other]) mkdirSync(folder, { recursive: true });
      const created = await connection.request("project.create", { root: main, name: "Main" });
      const onRoot = await connection.request("thread.create", { workspace: main });
      const inSub = await connection.request("thread.create", { workspace: sub });
      // 기본 폴더 대화는 명시 프로젝트 묶음에 들지 않는다
      await connection.request("thread.create", {});
      // 어느 루트에도 없는 폴더는 대화를 만들 때 그 폴더를 루트로 프로젝트를 만든다(§4.4.3)
      await connection.request("thread.create", { workspace: other });

      const listed = await connection.request("project.list", {});
      expect(
        listed.projects.map((item) => [item.name, item.threadCount, item.runningCount]),
      ).toEqual([
        ["Main", 2, 0],
        ["other", 1, 0],
      ]);
      expect(listed.projects[0]).toEqual({
        ...created.project,
        threadCount: 2,
        runningCount: 0,
      });

      // 지운 대화는 세지 않는다
      await connection.request("thread.delete", { threadId: inSub.threadId });
      expect(
        (await connection.request("project.list", {})).projects.map((item) => [
          item.name,
          item.threadCount,
        ]),
      ).toEqual([
        ["Main", 1],
        ["other", 1],
      ]);
      expect(
        (await connection.request("thread.list", {})).threads.map((thread) => thread.threadId),
      ).toContain(onRoot.threadId);
    } finally {
      await engine.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
  60_000,
);

realTest(
  "project.create names the project after its folder when no name is given, and project.get returns the stored record; an unknown id is project.notFound",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    const base = tempBase();
    try {
      const named = join(base, "named");
      const plain = join(base, "plain");
      mkdirSync(named);
      mkdirSync(plain);
      const withName = await connection.request("project.create", { root: named, name: "Named" });
      const withoutName = await connection.request("project.create", { root: plain });
      expect(withName.project).toMatchObject({ name: "Named", root: named, rev: 1 });
      expect(withoutName.project).toMatchObject({ name: "plain", root: plain, rev: 1 });

      expect(
        await connection.request("project.get", { projectId: withName.project.projectId }),
      ).toMatchObject({ project: withName.project });
      expect(
        await wireErrorOf(connection.request("project.get", { projectId: "prj_nope" })),
      ).toMatchObject({ data: { kind: "project.notFound", details: { id: "prj_nope" } } });
    } finally {
      await engine.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
  60_000,
);

realTest(
  "project.rename changes the name and bumps the rev; the list, the get and the threads under it read the new name; an unknown id is project.notFound",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    const base = tempBase();
    try {
      const root = join(base, "renamed");
      mkdirSync(root);
      const created = await connection.request("project.create", { root, name: "First" });
      const thread = await connection.request("thread.create", { workspace: root });
      expect(thread.project).toEqual({ projectId: created.project.projectId, name: "First" });

      const renamed = await connection.request("project.rename", {
        projectId: created.project.projectId,
        name: "Second",
      });
      expect(renamed.project).toEqual({ ...created.project, name: "Second", rev: 2 });
      expect(
        (await connection.request("project.get", { projectId: created.project.projectId })).project,
      ).toEqual(renamed.project);
      const listed = await connection.request("project.list", {});
      expect(listed.projects.map((item) => [item.name, item.rev])).toEqual([["Second", 2]]);
      // 대화가 가리키는 프로젝트 이름도 새 이름이다
      const rows = (await connection.request("thread.list", {})).threads;
      expect(rows.map((row) => row.project)).toEqual([
        { projectId: created.project.projectId, name: "Second" },
      ]);

      expect(
        await wireErrorOf(
          connection.request("project.rename", { projectId: "prj_nope", name: "x" }),
        ),
      ).toMatchObject({ data: { kind: "project.notFound", details: { id: "prj_nope" } } });
    } finally {
      await engine.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
  60_000,
);

realTest(
  "project.delete removes only the project record: its folder and threads stay, the threads stop belonging to it, and a second delete is project.notFound",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    const base = tempBase();
    try {
      const root = join(base, "gone");
      mkdirSync(root);
      const created = await connection.request("project.create", { root, name: "Gone" });
      const thread = await connection.request("thread.create", { workspace: root });

      expect(
        await connection.request("project.delete", { projectId: created.project.projectId }),
      ).toEqual({});
      expect((await connection.request("project.list", {})).projects).toEqual([]);
      expect(
        await wireErrorOf(
          connection.request("project.get", { projectId: created.project.projectId }),
        ),
      ).toMatchObject({
        data: { kind: "project.notFound", details: { id: created.project.projectId } },
      });
      // 폴더와 대화는 그대로다. 대화는 더 이상 프로젝트에 속하지 않는다
      expect(existsSync(root)).toBe(true);
      expect(
        (await connection.request("thread.list", {})).threads.map((row) => [
          row.threadId,
          row.workspace,
          row.project ?? null,
        ]),
      ).toEqual([[thread.threadId, root, null]]);
      expect(
        await wireErrorOf(
          connection.request("project.delete", { projectId: created.project.projectId }),
        ),
      ).toMatchObject({
        data: { kind: "project.notFound", details: { id: created.project.projectId } },
      });
    } finally {
      await engine.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
  60_000,
);

realTest(
  "project.instructions lists the AGENTS.md files from the workspace up to the project root with their bytes; an oversized one is listed as not included; a folder outside every project is project.rootInvalid",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    const base = tempBase();
    try {
      const root = join(base, "proj");
      const sub = join(root, "sub");
      const deeper = join(sub, "deeper");
      const loose = join(base, "loose");
      for (const folder of [deeper, loose]) mkdirSync(folder, { recursive: true });
      await connection.request("project.create", { root, name: "Proj" });
      writeFileSync(join(root, "AGENTS.md"), "root rule\n");
      writeFileSync(join(sub, "AGENTS.md"), "sub rule\n");
      // 기본 상한(64 KiB)을 넘는 파일은 읽지 않고 목록에만 올린다
      writeFileSync(join(deeper, "AGENTS.md"), "x".repeat(70_000));

      // 루트 파일이 먼저, 그다음 깊이 순서다. 바이트는 절 본문의 바이트 수다
      expect(await connection.request("project.instructions", { workspace: deeper })).toEqual({
        files: [
          { path: "AGENTS.md", bytes: 10, included: true },
          { path: "sub/AGENTS.md", bytes: 9, included: true },
          { path: "sub/deeper/AGENTS.md", bytes: 70_000, included: false },
        ],
      });
      // 위 폴더에서 보면 그 아래 파일은 빠진다
      expect(await connection.request("project.instructions", { workspace: sub })).toEqual({
        files: [
          { path: "AGENTS.md", bytes: 10, included: true },
          { path: "sub/AGENTS.md", bytes: 9, included: true },
        ],
      });

      // 어느 프로젝트에도 없는 폴더, 없는 폴더, 상대 경로는 루트가 없다
      expect(
        await wireErrorOf(connection.request("project.instructions", { workspace: loose })),
      ).toMatchObject({ data: { kind: "project.rootInvalid" } });
      expect(
        await wireErrorOf(
          connection.request("project.instructions", { workspace: join(base, "missing") }),
        ),
      ).toMatchObject({ data: { kind: "project.rootInvalid" } });
      expect(
        await wireErrorOf(connection.request("project.instructions", { workspace: "rel/x" })),
      ).toMatchObject({ data: { kind: "project.rootInvalid" } });
    } finally {
      await engine.close();
      rmSync(base, { recursive: true, force: true });
    }
  },
  60_000,
);
