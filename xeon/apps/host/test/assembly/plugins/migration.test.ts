import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { err, ok, parseJson, type LogFields, type Logger, type Result } from "@fresnel/contracts";
import type {
  MigrationChangedParams,
  MigrationProgressParams,
  MigrationScanRoot,
  Profile,
  ProfileListResult,
  ProfilePutResult,
} from "@fresnel/contracts/wire";
import type { ScanFs } from "@fresnel/plugin-migration";
import {
  createMigrationService,
  type MigrationProfilePort,
} from "../../../src/assembly/plugins/migration.ts";
import { createExistenceFs } from "../../../src/assembly/plugins/migration-fs.ts";
import { createMigrationSubmitter } from "../../../src/assembly/plugins/migration-submit.ts";
import type { MigrationPort } from "../../../src/handlers/m5/migration.ts";
import {
  APPROVE_TO_WORK,
  errorOf,
  instructionTextsOf,
  pluginRigOf,
  removeRigs,
  SILENT,
  valueOf,
  type PluginRig,
} from "./intake-rig.ts";
import { writeFiles } from "./support.ts";

// 가져오기 서비스(migration.md §6, §7.4, §7.5)를 임시 폴더의 고정 자료로 시험한다. 수용 기준 4~6, 12, 13, 14, 19를 맡는다.
// 실제 홈 폴더는 읽지 않는다: 홈 대신 임시 폴더 `home/`을 넘긴다. 자료의 시크릿 값은 모두 가짜 문자열이다.

afterEach(() => {
  removeRigs();
});

/** 시험의 시각. 모든 호출이 같은 시각을 본다 */
const CLOCK = { now: () => Date.UTC(2026, 10, 18, 2, 0, 0) };
const STAMP = "2026-11-18T00:00:00.000Z";

/** 출력 어디에도 있으면 안 되는 가짜 시크릿 값(수용 기준 7) */
const SECRET_VALUES = [
  "sk-test-AAAABBBBCCCC1111",
  "ghp_TESTTESTTESTTEST1111",
  "tok-test-VALUE-9f3a",
  "sk-test-ZZZZ9876",
  "${API_KEY}",
  "Bearer sk-test",
];

/** 로그를 모아 둔다. 시험이 로그에 값이 없는지 본다 */
function captureOf(): { readonly logger: Logger; readonly text: () => string } {
  const lines: string[] = [];
  const write = (level: string) => (event: string, fields?: LogFields) => {
    lines.push(JSON.stringify({ level, event, fields: fields ?? null }));
  };
  const logger: Logger = {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => logger,
  };
  return { logger, text: () => lines.join("\n") };
}

function profileOf(id: string): Profile {
  return {
    id,
    title: id,
    builtin: false,
    plugins: [],
    settings: [],
    startDrive: null,
    updatedAt: STAMP,
    rev: 1,
  };
}

/** 프로필 저장소 대역. `profile.put`과 같은 충돌 규칙을 쓴다(같은 id, `baseRev`가 null) */
function profilesOf(existing: readonly string[]): {
  readonly port: MigrationProfilePort;
  readonly ids: () => readonly string[];
  readonly puts: { readonly id: string; readonly plugins: number }[];
} {
  const ids = [...existing];
  const puts: { id: string; plugins: number }[] = [];
  const port: MigrationProfilePort = {
    list: (): Promise<Result<ProfileListResult, never>> =>
      Promise.resolve(
        ok({
          profiles: ids.map((id) => profileOf(id)),
          common: { plugins: [], settings: [], updatedAt: STAMP, rev: 1 },
          rev: 1,
        }),
      ),
    put: (
      input,
      baseRev,
    ): Promise<
      Result<
        ProfilePutResult,
        { kind: "conflict"; id: string; rev: number | null; baseRev: number | null }
      >
    > => {
      if (ids.includes(input.id) && baseRev === null) {
        return Promise.resolve(err({ kind: "conflict", id: input.id, rev: 1, baseRev }));
      }
      ids.push(input.id);
      puts.push({ id: input.id, plugins: input.plugins.length });
      return Promise.resolve(ok({ profile: profileOf(input.id), issues: [] }));
    },
  };
  return { port, ids: () => [...ids], puts };
}

const PROJECT_LABEL = "fresnel-proj";

interface Fixture {
  /** 홈 대역(정규 경로). 사용자 수준 자료가 든다 */
  readonly home: string;
  /** 프로젝트 폴더 */
  readonly proj: string;
  /** 호스트 상태 폴더 */
  readonly state: string;
  /** 명령이 돌았으면 생기는 파일 */
  readonly marker: string;
}

/**
 * 원본 자료. 사용자 수준(홈)과 프로젝트 폴더를 만든다. 스킬 본문의 `!` 명령과 MCP의 headersHelper는
 * 실행되면 `marker` 파일을 만든다(수용 기준 6).
 */
function fixtureOf(rig: PluginRig): Fixture {
  const home = join(rig.root, "home");
  const proj = join(rig.root, PROJECT_LABEL);
  const state = join(rig.root, "state");
  const marker = join(rig.root, "ran-marker.txt");
  writeFiles(home, {
    ".claude/CLAUDE.md": "항상 한국어로 답한다\n",
    ".claude.json": JSON.stringify(
      {
        mcpServers: {
          sentry: {
            command: "npx",
            args: ["sentry-mcp"],
            env: { SENTRY_TOKEN: "sk-test-ZZZZ9876" },
          },
        },
      },
      null,
      2,
    ),
  });
  const bang = `!\`touch ${marker}\``;
  writeFiles(proj, {
    ".mcp.json": JSON.stringify(
      {
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "server-github"],
            env: {
              GITHUB_TOKEN: "${GITHUB_TOKEN}",
              API_KEY: "${API_KEY}",
              API_TOKEN: "tok-test-VALUE-9f3a",
            },
          },
          legacy: {
            command: "node",
            args: ["srv.js"],
            env: { OPENAI_KEY: "sk-test-AAAABBBBCCCC1111", GH: "ghp_TESTTESTTESTTEST1111" },
          },
          docs: {
            type: "http",
            url: "https://docs.example.test/mcp",
            headers: { Authorization: "Bearer sk-test-ZZZZ9876" },
            headersHelper: `touch ${marker}`,
          },
        },
      },
      null,
      2,
    ),
    ".agents/skills/deploy/SKILL.md": `---\nname: deploy\ndescription: 배포를 돕는다\n---\n지금 상태: ${bang}\n`,
    ".agents/skills/notes/SKILL.md": "---\nname: notes\ndescription: 메모를 정리한다\n---\n본문\n",
    ".agents/skills/long/SKILL.md": `---\nname: long\ndescription: ${"길다".repeat(600)}\n---\n본문\n`,
    "CLAUDE.md": "프로젝트 지침\n",
  });
  return { home, proj, state, marker };
}

/** 두 루트. 홈은 정규 경로로 넘긴다(`os.homedir()`처럼) */
function scanRootsOf(fixture: Fixture): readonly MigrationScanRoot[] {
  return [
    { path: fixture.home, scope: "user", label: "홈" },
    { path: fixture.proj, scope: "project", label: PROJECT_LABEL },
  ];
}

/** 서비스 한 세트: 제출 포트, 프로필 대역, 로그. 감지 포트는 시험이 바꿔 낄 수 있다 */
function serviceOf(
  rig: PluginRig,
  fixture: Fixture,
  profiles: ReturnType<typeof profilesOf>,
  options: { readonly log?: Logger; readonly detectFs?: () => ScanFs } = {},
): MigrationPort {
  const log = options.log ?? SILENT;
  const submitter = createMigrationSubmitter({
    userDir: rig.userDir,
    intake: rig.intake,
    review: rig.review,
    log,
  });
  return createMigrationService({
    homeDir: realpathSync(fixture.home),
    stateDir: fixture.state,
    submitter,
    profiles: profiles.port,
    clock: CLOCK,
    log,
    ...(options.detectFs === undefined ? {} : { detectFs: options.detectFs }),
  });
}

/** 설명이 1024자를 넘는 스킬의 질문 id. 이 자료의 질문은 이것 하나다 */
function longQuestionIdOf(questions: readonly { readonly id: string }[]): string {
  const found = questions.find((question) => question.id.startsWith("skill-description:"));
  if (found === undefined) throw new Error("expected the long-description question");
  return found.id;
}

/** 폴더 트리의 지문. 상대 경로, 폴더의 mtime, 파일의 내용 sha256과 mtime */
function fingerprintOf(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir).toSorted()) {
      const abs = join(dir, name);
      const stat = lstatSync(abs);
      const rel = relative(root, abs);
      if (stat.isDirectory()) {
        out.push(`${rel}/ dir ${stat.mtimeMs}`);
        walk(abs);
      } else {
        const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
        out.push(`${rel} ${digest} ${stat.mtimeMs}`);
      }
    }
  }
  walk(root);
  return out;
}

/** 폴더 아래 모든 파일의 내용을 한 문자열로 모은다. 초안 바이트 검사에 쓴다 */
function bytesUnder(root: string): string {
  if (!existsSync(root)) return "";
  const parts: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir).toSorted()) {
      const abs = join(dir, name);
      if (lstatSync(abs).isDirectory()) walk(abs);
      else parts.push(readFileSync(abs).toString("latin1"));
    }
  }
  walk(root);
  return parts.join("\n");
}

/** 항목을 차례로 처리한다. 앞선 일이 끝난 뒤 다음을 시작한다(승인 순서를 지키려고 루프 안 `await`를 쓰지 않는다) */
function inTurn<T>(items: readonly T[], step: (item: T) => Promise<unknown>): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => step(item)).then(() => undefined),
    Promise.resolve(),
  );
}

/** 탐색한 뒤 제안을 만든다. 시험마다 같은 순서를 쓴다 */
async function scannedProposal(service: MigrationPort, fixture: Fixture) {
  const scanned = valueOf(await service.scan(scanRootsOf(fixture)));
  const proposed = valueOf(await service.proposal(scanned.scanId, undefined));
  return { scanned, proposed };
}

test("detect names the markers that exist, reads no content, and a dismissed marker disappears", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  // 감지 포트를 세는 대역. 감지는 `lstat`만 불러야 하고 목록이나 내용은 읽지 않는다
  const base = createExistenceFs();
  const calls: string[] = [];
  const counting: ScanFs = {
    lstat: (path) => {
      calls.push(`lstat ${path}`);
      return base.lstat(path);
    },
    listDir: (path) => {
      calls.push(`listDir ${path}`);
      return base.listDir(path);
    },
    readBounded: (path, maxBytes) => {
      calls.push(`readBounded ${path}`);
      return base.readBounded(path, maxBytes);
    },
    realpath: (path) => {
      calls.push(`realpath ${path}`);
      return base.realpath(path);
    },
  };
  const service = serviceOf(rig, fixture, profilesOf([]), { detectFs: () => counting });

  const detected = valueOf(await service.detect(fixture.proj));
  expect(detected.found.map((item) => item.marker)).toEqual([
    ".mcp.json",
    ".agents/skills",
    "CLAUDE.md",
  ]);
  expect(detected.notice).toEqual({
    code: "foreign_format_found",
    willStopReading: [".mcp.json", ".agents/skills"],
    importable: ["CLAUDE.md"],
    importAvailable: true,
  });
  expect(calls.filter((call) => !call.startsWith("lstat "))).toEqual([]);
  expect(calls.length).toBeGreaterThan(0);

  // 신뢰 읽기가 쓰는 짧은 판은 같은 표지를 준다
  const foreign = await service.foreignFormatsOf(fixture.proj);
  expect(foreign?.importable).toEqual(["CLAUDE.md"]);

  // 숨긴 표지는 알림에서 빠진다. 같은 폴더의 다른 표지는 남는다
  valueOf(await service.dismiss(fixture.proj, "CLAUDE.md"));
  const after = valueOf(await service.detect(fixture.proj));
  expect(after.found.map((item) => item.marker)).toEqual([".mcp.json", ".agents/skills"]);
  // `.mcp.json`은 엔진이 지금 읽는 표지이지만 가져오기로 옮길 수 있어서 `importAvailable`은 남는다
  expect(after.notice?.importable).toEqual([]);
  expect(after.notice?.importAvailable).toBe(true);
});

test("a folder with no foreign markers has no notice, and dismissals survive a new service on the same state folder", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const empty = join(rig.root, "empty");
  writeFiles(empty, { "README.md": "x\n" });
  const profiles = profilesOf([]);
  const first = serviceOf(rig, fixture, profiles);
  expect(valueOf(await first.detect(empty))).toEqual({ found: [], notice: null });
  expect(await first.foreignFormatsOf(empty)).toBeUndefined();

  valueOf(await first.dismiss(fixture.proj, ".mcp.json"));
  valueOf(await first.dismiss(fixture.proj, ".agents/skills"));
  valueOf(await first.dismiss(fixture.proj, "CLAUDE.md"));
  expect(valueOf(await first.detect(fixture.proj))).toEqual({ found: [], notice: null });

  // 상태 파일은 정규 경로와 숨긴 시각을 적는다. 새 서비스가 같은 파일을 읽어 숨김을 그대로 안다
  const stored = valueOf(
    parseJson(readFileSync(join(fixture.state, "migration-state.json"), "utf8")),
  );
  const projReal = realpathSync(fixture.proj);
  expect(stored).toEqual({
    version: 1,
    dismissed: [
      { root: projReal, marker: ".mcp.json", at: "2026-11-18T02:00:00.000Z" },
      { root: projReal, marker: ".agents/skills", at: "2026-11-18T02:00:00.000Z" },
      { root: projReal, marker: "CLAUDE.md", at: "2026-11-18T02:00:00.000Z" },
    ],
  });
  const second = serviceOf(rig, fixture, profiles);
  expect(valueOf(await second.detect(fixture.proj))).toEqual({ found: [], notice: null });
});

test("a relative, missing, or file root is refused with rootInvalid", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  expect(
    errorOf(await service.scan([{ path: PROJECT_LABEL, scope: "project", label: "x" }])),
  ).toEqual({
    kind: "root_invalid",
  });
  expect(
    errorOf(
      await service.scan([
        { path: join(rig.root, "does-not-exist"), scope: "project", label: "x" },
      ]),
    ),
  ).toEqual({ kind: "root_invalid" });
  expect(
    errorOf(
      await service.scan([{ path: join(fixture.proj, ".mcp.json"), scope: "project", label: "x" }]),
    ),
  ).toEqual({ kind: "root_invalid" });
  expect(errorOf(await service.detect("relative/path"))).toEqual({ kind: "root_invalid" });
  expect(errorOf(await service.dismiss("relative/path", "CLAUDE.md"))).toEqual({
    kind: "root_invalid",
  });
});

test("a scan lists the items with a secret count and no value, and reports progress per root", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const progress: MigrationProgressParams[] = [];
  service.onProgress((item) => progress.push(item));

  const scanned = valueOf(await service.scan(scanRootsOf(fixture)));
  expect(scanned.summary.itemCount).toBe(scanned.items.length);
  expect(scanned.items.length).toBeGreaterThan(0);
  // 리터럴 시크릿이 든 항목은 값 없이 개수만 낸다
  expect(scanned.items.some((item) => item.secretCount > 0)).toBe(true);
  expect(
    scanned.items.some((item) => item.scope === "user" && item.path === "~/.claude.json"),
  ).toBe(true);
  expect(progress.map((item) => [item.done, item.total])).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(new Set(progress.map((item) => item.scanId))).toEqual(new Set([scanned.scanId]));
});

test("the approval gate: an open question applies nothing; the answer makes drafts that stay pending until approved", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const changes: MigrationChangedParams[] = [];
  service.onChanged((change) => changes.push(change));

  const { proposed } = await scannedProposal(service, fixture);
  // 프로젝트 범위 묶음은 프로젝트 이름의 프로필 제안이고, 사용자 수준 지침은 공통 후보다
  const project = proposed.profileProposals.find((profile) => profile.scope === "project");
  expect(project?.name).toBe(PROJECT_LABEL);
  expect(project?.pluginNames.length).toBeGreaterThan(0);
  expect(proposed.profileProposals.map((profile) => profile.scope)).toContain("user-common");

  expect(errorOf(await service.apply(proposed.proposalId, { answers: {} }, []))).toEqual({
    kind: "questions_open",
    proposalId: proposed.proposalId,
  });
  // 질문이 닫히지 않은 적용은 검토함에 아무것도 올리지 않는다
  expect(valueOf(await rig.review.list({})).items).toEqual([]);

  const answers = { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } };
  const applied = valueOf(await service.apply(proposed.proposalId, answers, []));
  expect(applied.drafts.length).toBeGreaterThan(0);
  expect(applied.profiles).toEqual([]);

  // 초안은 검토함에 `migration` 대기 항목으로 들어간다
  const items = valueOf(await rig.review.list({})).items;
  expect(items.length).toBe(applied.drafts.length);
  expect(items.every((item) => item.provenance === "migration" && item.state === "pending")).toBe(
    true,
  );

  // 승인 전: 대기 이름으로만 보이고 재료 포트는 아무것도 읽지 않는다(수용 기준 13)
  const pending = valueOf(await rig.review.pendingNames());
  expect(pending.length).toBe(applied.drafts.length);
  const readingsBefore = await Promise.all(pending.map((name) => instructionTextsOf(rig, name)));
  expect(readingsBefore.flat()).toEqual([]);

  // 승인하면 재료에 든다. 사용자 지침 본문이 그 안에 있다
  await inTurn(items, async (item) => {
    valueOf(await rig.review.decide(item.itemId, APPROVE_TO_WORK));
  });
  expect(valueOf(await rig.review.pendingNames())).toEqual([]);
  const texts = (await Promise.all(pending.map((name) => instructionTextsOf(rig, name)))).flat();
  expect(texts.some((text) => text.includes("항상 한국어로 답한다"))).toBe(true);

  expect(changes.map((change) => change.kind)).toEqual(["scan", "proposal", "apply"]);
});

test("the original trees keep their bytes and times across scan, proposal and apply", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const homeBefore = fingerprintOf(fixture.home);
  const projBefore = fingerprintOf(fixture.proj);

  const { proposed } = await scannedProposal(service, fixture);
  valueOf(
    await service.apply(
      proposed.proposalId,
      { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
      [],
    ),
  );

  expect(fingerprintOf(fixture.home)).toEqual(homeBefore);
  // 프로젝트 폴더에는 파일이 하나도 생기지 않는다(수용 기준 5)
  expect(fingerprintOf(fixture.proj)).toEqual(projBefore);
});

test("project-scope plugins go to the user plugin folder; the profile is created only when named, and is empty", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const profiles = profilesOf([]);
  const service = serviceOf(rig, fixture, profiles);
  const { proposed } = await scannedProposal(service, fixture);
  const answers = { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } };

  const applied = valueOf(await service.apply(proposed.proposalId, answers, [PROJECT_LABEL]));
  expect(applied.profiles).toEqual([{ profileId: "fresnel-proj", name: PROJECT_LABEL }]);
  expect(profiles.puts).toEqual([{ id: "fresnel-proj", plugins: 0 }]);
  // 초안 폴더는 사용자 플러그인 폴더에 있다. 프로젝트 안에는 아무것도 쓰지 않는다
  for (const draft of applied.drafts) expect(existsSync(join(rig.userDir, draft.name))).toBe(true);
});

test("without a confirmed profile name no profile is created", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const profiles = profilesOf([]);
  const service = serviceOf(rig, fixture, profiles);
  const { proposed } = await scannedProposal(service, fixture);
  const applied = valueOf(
    await service.apply(
      proposed.proposalId,
      { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
      [],
    ),
  );
  expect(applied.profiles).toEqual([]);
  expect(profiles.puts).toEqual([]);
  expect(profiles.ids()).toEqual([]);
});

test("a profile name that was not proposed is refused before anything is written", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const { proposed } = await scannedProposal(service, fixture);
  expect(
    errorOf(
      await service.apply(
        proposed.proposalId,
        { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
        ["없는-프로필"],
      ),
    ),
  ).toEqual({ kind: "profile_not_proposed", name: "없는-프로필" });
  expect(valueOf(await rig.review.list({})).items).toEqual([]);
});

test("a profile that already has the name is a nameConflict, and no draft is written", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const profiles = profilesOf(["fresnel-proj"]);
  const service = serviceOf(rig, fixture, profiles);
  const { proposed } = await scannedProposal(service, fixture);
  expect(
    errorOf(
      await service.apply(
        proposed.proposalId,
        { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
        [PROJECT_LABEL],
      ),
    ),
  ).toEqual({ kind: "name_conflict", name: PROJECT_LABEL });
  expect(valueOf(await rig.review.list({})).items).toEqual([]);
  expect(profiles.puts).toEqual([]);
});

test("a hand-written folder with a planned name is never overwritten: nameConflict, and its bytes stay", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const { proposed } = await scannedProposal(service, fixture);
  const first = proposed.plugins[0];
  if (first === undefined) throw new Error("expected at least one planned plugin");
  writeFiles(rig.userDir, { [`${first.name}/instructions/01-note.md`]: "직접 쓴 것\n" });
  const before = fingerprintOf(rig.userDir);

  expect(
    errorOf(
      await service.apply(
        proposed.proposalId,
        { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
        [],
      ),
    ),
  ).toEqual({ kind: "name_conflict", name: first.name });
  expect(fingerprintOf(rig.userDir)).toEqual(before);
});

test("applying the same proposal after approval makes no new draft (the source is unchanged)", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const { proposed } = await scannedProposal(service, fixture);
  const answers = { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } };
  const first = valueOf(await service.apply(proposed.proposalId, answers, []));
  await inTurn(first.drafts, async (draft) => {
    valueOf(await rig.review.decide(draft.itemId, APPROVE_TO_WORK));
  });

  const again = valueOf(await service.apply(proposed.proposalId, answers, []));
  expect(again.drafts).toEqual([]);
  expect(valueOf(await rig.review.list({ state: "pending" })).items).toEqual([]);
});

test("nothing runs: the `!` command and the headersHelper leave no marker file through scan, proposal and apply", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const { proposed } = await scannedProposal(service, fixture);
  valueOf(
    await service.apply(
      proposed.proposalId,
      { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
      [],
    ),
  );
  expect(existsSync(fixture.marker)).toBe(false);
});

test("no wire response, draft byte, review item, or log carries a secret value; references become secret://", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const capture = captureOf();
  const service = serviceOf(rig, fixture, profilesOf([]), { log: capture.logger });
  const responses: unknown[] = [];

  responses.push(valueOf(await service.detect(fixture.proj)));
  const { scanned, proposed } = await scannedProposal(service, fixture);
  responses.push(scanned, proposed);
  const applied = valueOf(
    await service.apply(
      proposed.proposalId,
      { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
      [],
    ),
  );
  responses.push(applied, valueOf(await service.reportGet(applied.reportId)));

  const items = valueOf(await rig.review.list({})).items;
  const haystack = [
    JSON.stringify(responses),
    JSON.stringify(items),
    bytesUnder(rig.userDir),
    capture.text(),
  ].join("\n");
  for (const value of SECRET_VALUES) expect(haystack.includes(value)).toBe(false);
  expect(bytesUnder(rig.userDir)).toContain("secret://");
});

test("a report is kept under its id, and an unknown id answers notFound", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  expect(errorOf(await service.proposal("scan-missing", undefined))).toEqual({
    kind: "not_found",
    id: "scan-missing",
  });
  expect(errorOf(await service.apply("proposal-missing", { answers: {} }, []))).toEqual({
    kind: "not_found",
    id: "proposal-missing",
  });
  expect(errorOf(await service.reportGet("report-missing"))).toEqual({
    kind: "not_found",
    id: "report-missing",
  });

  const { proposed } = await scannedProposal(service, fixture);
  const applied = valueOf(
    await service.apply(
      proposed.proposalId,
      { answers: { [longQuestionIdOf(proposed.questions)]: "keep" } },
      [],
    ),
  );
  const report = valueOf(await service.reportGet(applied.reportId));
  // 항목마다 보고 줄이 하나다. 답을 받은 적용의 보고서는 질문이 닫힌 판정을 담는다
  expect(report.report.length).toBe(proposed.report.length);
  expect(report.rulesVersions).toHaveProperty("claude-code");
});

test("the migration files import no process or network module, and the reader has no write call", async () => {
  // 소스 검사(§7.4, 수용 기준 4·6): 가져오기 파일은 프로세스나 네트워크 모듈을 가져오지 않는다
  const files = [
    "src/assembly/plugins/migration.ts",
    "src/assembly/plugins/migration-fs.ts",
    "src/assembly/plugins/migration-state.ts",
    "src/handlers/m5/migration.ts",
  ];
  const root = join(import.meta.dir, "..", "..", "..");
  const forbidden = /child_process|node:net|node:http|node:https|Bun\.spawn|\bspawn\(|\bexec\(/;
  for (const file of files) {
    expect(forbidden.test(readFileSync(join(root, file), "utf8"))).toBe(false);
  }
  const reader = readFileSync(join(root, "src/assembly/plugins/migration-fs.ts"), "utf8");
  for (const write of [
    "writeFile",
    "appendFile",
    "rename(",
    "unlink",
    "rm(",
    "mkdir",
    "rmdir",
    "copyFile",
    "chmod",
    "truncate",
  ]) {
    expect(reader.includes(write)).toBe(false);
  }
});

test("onChanged announces each applied change, and a refused call announces nothing", async () => {
  const rig = pluginRigOf();
  const fixture = fixtureOf(rig);
  const service = serviceOf(rig, fixture, profilesOf([]));
  const changes: string[] = [];
  const off = service.onChanged((change) => changes.push(change.kind));
  valueOf(await service.dismiss(fixture.proj, "CLAUDE.md"));
  off();
  valueOf(await service.dismiss(fixture.proj, ".mcp.json"));
  expect(changes).toEqual(["dismiss"]);
  expect(errorOf(await service.dismiss("relative", "x"))).toEqual({ kind: "root_invalid" });
  expect(changes).toEqual(["dismiss"]);
});
