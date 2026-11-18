import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 설정 목록, 신뢰 목록, 작업 폴더 존재, 스킬 목록(실제 엔진). 설정과 신뢰는 임시 홈의 파일에, 폴더는 임시 디렉터리에만 둔다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Session {
  readonly host: InProcessHost;
  readonly connection: HostConnection;
}

async function open(): Promise<Session> {
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

/** 임시 디렉터리 하나(정규 경로). 시험이 끝나면 지운다 */
function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** 글 목록의 비교 함수(코드 단위 순서) */
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** `[경로, 결정]` 짝을 경로 순으로 세우는 비교 함수 */
function byPath(a: readonly string[], b: readonly string[]): number {
  return byText(a[0] ?? "", b[0] ?? "");
}

realTest(
  "settings.list: the catalog comes in key order, a prefix narrows it, reserved keys appear only on request, and each default is what settings.get reads with nothing set",
  async () => {
    const home = useEngineHome();
    const { host, connection } = await open();
    try {
      const all = await connection.request("settings.list", {});
      const keys = all.defs.map((def) => def.key);
      expect(keys).toEqual(keys.toSorted(byText));
      expect(new Set(keys).size).toBe(keys.length);

      // 접두로 좁힌 목록은 전체 목록의 같은 부분이다
      const models = await connection.request("settings.list", { prefix: "l1.models." });
      expect(models.defs).toEqual(all.defs.filter((def) => def.key.startsWith("l1.models.")));
      expect(models.defs.map((def) => def.key)).toContain("l1.models.default");

      // 아무 일도 하지 않는 예약 키(`stage: reserved`)는 요청할 때만 든다
      const reserved = (await connection.request("settings.list", { includeReserved: true })).defs;
      const allKeys = new Set(all.defs.map((def) => def.key));
      const onlyReserved = reserved.filter((def) => !allKeys.has(def.key));
      // 예약 키는 학습 그룹의 큐레이터 키뿐이었고 그 그룹이 빌트인에서 빠졌다(2026-11-18): 지금은 예약 키가 없다
      expect(onlyReserved).toEqual([]);
      expect(onlyReserved.every((def) => def.stage === "reserved")).toBe(true);
      expect(all.defs.some((def) => def.stage === "reserved")).toBe(false);

      // 폐기 키는 요청할 때만 든다
      const deprecatedToo = await connection.request("settings.list", { includeDeprecated: true });
      expect(deprecatedToo.defs.filter((def) => def.deprecated !== undefined)).toEqual(
        all.defs.filter((def) => def.deprecated !== undefined),
      );

      // 목록의 기본값과 settings.get이 아무것도 설정하지 않았을 때 읽는 값은 같다
      const sample = ["l1.loop.maxSteps", "l1.models.allowedModels", "l1.models.accounts"];
      const read = await connection.request("settings.get", { keys: sample });
      for (const row of read.settings) {
        const def = all.defs.find((item) => item.key === row.key);
        expect(def?.default).toEqual(row.value);
        expect(row.source).toEqual({ scope: "default" });
      }
      expect(read.settings.map((row) => row.key)).toEqual(sample);

      // 목록은 값을 싣지 않는다: 사용자 설정을 바꿔도 정의는 그대로다
      await connection.request("settings.set", {
        key: "l1.loop.maxSteps",
        value: 8,
        scope: "user",
      });
      const after = await connection.request("settings.list", {});
      expect(after.defs).toEqual(all.defs);
      const changed = await connection.request("settings.get", { keys: ["l1.loop.maxSteps"] });
      expect(changed.settings[0]).toMatchObject({ value: 8, source: { scope: "user" } });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "trust.list: stored folder decisions come with verdict and time, a session decision is not stored, and a removed folder leaves the list",
  async () => {
    const home = useEngineHome();
    const base = tempDir("xh-trustlist-");
    const allowed = join(base, "allowed");
    const denied = join(base, "denied");
    const session = join(base, "session");
    const link = join(base, "denied-link");
    for (const dir of [allowed, denied, session]) mkdirSync(dir);
    symlinkSync(denied, link);
    // 프로젝트 설정 파일이 있어야 신뢰가 필요하고, 그때 trust.get은 저장된 결정을 낸다
    for (const dir of [allowed, denied, session]) {
      mkdirSync(join(dir, ".fresnel"));
      writeFileSync(join(dir, ".fresnel", "settings.json"), "{}");
    }

    const first = await open();
    try {
      expect(await first.connection.request("trust.list", {})).toEqual({ entries: [] });
      await first.connection.request("trust.decide", {
        workspace: allowed,
        choice: { kind: "folder", verdict: "allow" },
      });
      // 심볼릭 링크로 정해도 저장되는 폴더는 정규 경로다
      await first.connection.request("trust.decide", {
        workspace: link,
        choice: { kind: "folder", verdict: "deny" },
      });
      await first.connection.request("trust.decide", {
        workspace: session,
        choice: { kind: "session", verdict: "allow" },
      });

      const listed = await first.connection.request("trust.list", {});
      expect(listed.entries.map((entry) => [entry.path, entry.verdict]).toSorted(byPath)).toEqual(
        [
          [allowed, "allow"],
          [denied, "deny"],
        ].toSorted(byPath),
      );
      // 목록의 결정은 trust.get이 저장된 결정으로 보는 것과 같다
      const askedAll = await Promise.all(
        listed.entries.map((entry) =>
          first.connection.request("trust.get", { workspace: entry.path }),
        ),
      );
      listed.entries.forEach((entry, index) => {
        // 저장 시각은 UTC ISO 8601 글이다
        if (entry.savedAt === undefined) throw new Error("a stored decision has no time");
        expect(new Date(entry.savedAt).toISOString()).toBe(entry.savedAt);
        expect(askedAll[index]).toMatchObject({
          projectRoot: entry.path,
          required: true,
          verdict: entry.verdict,
          via: "store",
        });
      });
    } finally {
      await first.connection.close();
      await first.host.close();
    }

    // 재시작 뒤에도 저장된 결정만 남는다. 세션 결정은 사라진다
    const second = await open();
    try {
      const reopened = await second.connection.request("trust.list", {});
      expect(reopened.entries.map((entry) => [entry.path, entry.verdict]).toSorted(byPath)).toEqual(
        [
          [allowed, "allow"],
          [denied, "deny"],
        ].toSorted(byPath),
      );
      expect(await second.connection.request("trust.get", { workspace: session })).toMatchObject({
        required: true,
        verdict: "undecided",
        via: "headless",
      });

      // 지우면 목록에서 빠지고 나머지는 그대로다
      await second.connection.request("trust.remove", { workspace: allowed });
      const remaining = await second.connection.request("trust.list", {});
      expect(remaining.entries.map((entry) => [entry.path, entry.verdict])).toEqual([
        [denied, "deny"],
      ]);
    } finally {
      await second.connection.close();
      await second.host.close();
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "workspace.status: an existing folder is reported by its real path, a missing path or a file says exists false with the cleaned path, a relative path is invalid params",
  async () => {
    const home = useEngineHome();
    const base = tempDir("xh-wsstatus-");
    const folder = join(base, "project");
    mkdirSync(folder);
    const link = join(base, "project-link");
    symlinkSync(folder, link);
    const file = join(base, "notes.txt");
    writeFileSync(file, "x");
    const { host, connection } = await open();
    try {
      expect(await connection.request("workspace.status", { workspace: folder })).toEqual({
        exists: true,
        path: folder,
      });
      // 심볼릭 링크로 부르면 정규 경로를 돌려준다
      expect(await connection.request("workspace.status", { workspace: `${link}/` })).toEqual({
        exists: true,
        path: folder,
      });
      // 없는 폴더: `.`·`..`만 정리한 절대 경로
      const gone = join(base, "a", "..", "gone");
      expect(await connection.request("workspace.status", { workspace: gone })).toEqual({
        exists: false,
        path: join(base, "gone"),
      });
      // 파일은 폴더가 아니다
      expect(await connection.request("workspace.status", { workspace: file })).toEqual({
        exists: false,
        path: file,
      });
      // 폴더를 만들면 다음 조회에서 있다고 나온다
      mkdirSync(join(base, "gone"));
      expect(await connection.request("workspace.status", { workspace: gone })).toEqual({
        exists: true,
        path: join(base, "gone"),
      });

      const relative = await wireErrorOf(
        connection.request("workspace.status", { workspace: "relative/dir" }),
      );
      expect(relative.data.kind).toBe("jsonrpc.invalidParams");
      expect(relative.data.details).toEqual({
        issues: [{ path: "workspace", message: "workspace must be an absolute path" }],
      });
      // 상태 조회는 아무것도 만들지 않는다
      expect(readdirSync(base).toSorted(byText)).toEqual(
        ["gone", "notes.txt", "project", "project-link"].toSorted(byText),
      );
    } finally {
      await connection.close();
      await host.close();
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "knowledge.skills.list: a thread's project skills appear only once its folder is trusted, and the skills left out say why",
  async () => {
    const home = useEngineHome();
    const workspace = tempDir("xh-skills-");
    const skills = join(workspace, ".fresnel", "skills");
    const writeSkill = (name: string, text: string): void => {
      mkdirSync(join(skills, name), { recursive: true });
      writeFileSync(join(skills, name, "SKILL.md"), text);
    };
    writeSkill("demo-skill", "---\nname: demo-skill\ndescription: Demo skill d1\n---\n본문\n");
    writeSkill(
      "manual-only",
      "---\nname: manual-only\ndescription: Only when asked\ndisable-model-invocation: true\n---\n본문\n",
    );
    writeSkill("broken", "설명이 없는 스킬\n");
    const { host, connection } = await open();
    try {
      const created = await connection.request("thread.create", { workspace });
      // 신뢰하지 않은 폴더의 프로젝트 스킬은 싣지 않고, 이유를 알린다
      expect(
        await connection.request("knowledge.skills.list", { threadId: created.threadId }),
      ).toEqual({
        skills: [],
        diagnostics: [
          {
            severity: "warning",
            message: "project skills are not loaded: the project is not trusted",
            path: skills,
          },
        ],
      });

      await connection.request("trust.decide", {
        workspace,
        choice: { kind: "folder", verdict: "allow" },
      });
      const trusted = await connection.request("knowledge.skills.list", {
        threadId: created.threadId,
      });
      expect(trusted.skills.toSorted((a, b) => (a.name < b.name ? -1 : 1))).toEqual([
        {
          name: "demo-skill",
          description: "Demo skill d1",
          scope: "project",
          modelInvocable: true,
        },
        {
          name: "manual-only",
          description: "Only when asked",
          scope: "project",
          modelInvocable: false,
        },
      ]);
      // 설명이 없는 스킬은 목록에 없고, 그 파일이 진단으로 남는다
      expect(trusted.diagnostics).toEqual([
        {
          severity: "warning",
          message: "description is required",
          path: join(skills, "broken", "SKILL.md"),
        },
      ]);
    } finally {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
