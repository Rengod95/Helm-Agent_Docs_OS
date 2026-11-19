import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import {
  WireError,
  type HostConnection,
  type MigrationChangedParams,
  type MigrationProgressParams,
} from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { requireSandboxOrSkip, sandboxGate } from "../fixtures/sandbox-service.ts";

// migration.md §6, §7.7 [제안] (int, 실제 엔진): 다른 하네스(Claude Code)의 설정이 든 프로젝트를 가져온다.
// 감지는 표지를 존재만 보고, 훑기는 항목을 값 없이 세고, 제안은 플러그인 계획과 보고 줄을 주고,
// 적용은 `<설정>/plugins/<이름>/` 폴더와 `migration` 검토 항목을 만든다. 보고서는 적용 뒤 다시 읽힌다.
// 홈 폴더는 임시 폴더로 바꿔 감지가 실제 홈을 보지 않게 한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
// 훑기는 샌드박스 자식 프로세스에서 돈다(migration.md §7.4 [제안]). 샌드박스를 쓸 수 없으면 훑기와 적용을 건너뛴다(mcp-sandbox.int.test.ts와 같다)
const sandbox = await sandboxGate(tmpdir());
requireSandboxOrSkip(sandbox, "migration-wire.int");
const scanTest = gate.blocker === undefined && sandbox.runnable ? test : test.skip;
/** 자식을 띄울 자기 실행 값. 소스 실행이므로 진입 파일을 준다(운영은 이 파일이 컴파일된 실행 파일이다) */
const MAIN_ENTRY = new URL("../../src/main.ts", import.meta.url).pathname;

const TIMEOUT_MS = 60_000;
/** 시험 프로젝트의 시크릿 가짜 값. 응답 어디에도 나오면 안 된다(§6.6, 값 없이 개수만 싣는다) */
const SECRET = "tok-test-VALUE-9f3a";
const SKILL_NAME = "notes";

interface Fixture {
  readonly home: string;
  readonly proj: string;
}

/**
 * 프로젝트 자료. `CLAUDE.md`(지침), `.claude/skills/notes/SKILL.md`(스킬), `.mcp.json`(서버 하나, 시크릿 가짜 값 하나).
 * 홈 폴더는 비어 있다
 */
function fixtureOf(root: string): Fixture {
  const home = join(root, "home");
  const proj = join(root, "proj");
  mkdirSync(home, { recursive: true });
  writeText(join(proj, "CLAUDE.md"), "프로젝트 지침\n");
  writeText(
    join(proj, ".claude", "skills", SKILL_NAME, "SKILL.md"),
    `---\nname: ${SKILL_NAME}\ndescription: 메모를 정리한다\n---\n본문\n`,
  );
  writeText(
    join(proj, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "server-github"],
            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", API_TOKEN: SECRET },
          },
        },
      },
      null,
      2,
    ),
  );
  return { home, proj: realpathSync(proj) };
}

/** Hook 시험의 시크릿 가짜 값. 두 번째 훅의 스크립트에만 든다 */
const HOOK_SECRET = "sk-test-VALUE-4c7e1b9d";
/** 첫 훅의 스크립트 바이트(한글 주석이 있어 UTF-8 바이트가 그대로 복사되는지 본다) */
const GUARD_TEXT =
  '#!/bin/sh\n# 위험한 명령을 막는다\ninput=$(cat)\ncase "$input" in\n  *"rm -rf"*) echo "rm -rf is blocked" >&2; exit 2 ;;\nesac\nexit 0\n';
const LEAK_TEXT = `#!/bin/sh\nexport API_KEY=${HOOK_SECRET}\nexit 0\n`;
/** 프로젝트 설정의 Hook: PreToolUse 훅 하나(옮긴다), PostToolUse 훅 하나(스크립트에 시크릿 값이 있어 옮기지 않는다) */
const HOOK_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash|Write",
        hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh" }],
      },
    ],
    PostToolUse: [
      {
        matcher: "",
        hooks: [{ type: "command", command: "sh $CLAUDE_PROJECT_DIR/.claude/hooks/leak.sh" }],
      },
    ],
  },
};

/** Hook 시험의 프로젝트. 홈 폴더는 비어 있다 */
function hookFixtureOf(root: string): Fixture {
  const home = join(root, "home");
  const proj = join(root, "proj");
  mkdirSync(home, { recursive: true });
  writeText(join(proj, ".claude", "settings.json"), `${JSON.stringify(HOOK_SETTINGS, null, 2)}\n`);
  writeText(join(proj, ".claude", "hooks", "guard.sh"), GUARD_TEXT);
  writeText(join(proj, ".claude", "hooks", "leak.sh"), LEAK_TEXT);
  return { home, proj: realpathSync(proj) };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** 폴더 안의 모든 파일을 상대 경로와 바이트로 모은다 */
function bytesOf(root: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else files[rel] = readFileSync(join(dir, entry.name));
    }
  };
  walk(root, "");
  return files;
}

/** 파일 바이트 가운데 값이 든 것이 있는가 */
function holdsValue(files: Record<string, Uint8Array>, value: string): boolean {
  const needle = Buffer.from(value);
  return Object.values(files).some((bytes) => Buffer.from(bytes).includes(needle));
}

function sha256Of(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 실제 엔진을 시작한다. `HOME`은 호출자가 임시 폴더로 바꿔 둔다 */
async function startMigrationHost(bundles: string) {
  const host = await startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true, self: { execPath: process.execPath, entry: MAIN_ENTRY } },
    defaultPluginsDir: bundles,
    extraPlugins: [],
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

/** 홈을 임시 폴더로 바꾸고 돌려줄 복원 함수를 만든다. 실제 홈은 읽히지 않는다 */
function redirectHome(home: string): () => void {
  const previous = process.env["HOME"];
  process.env["HOME"] = home;
  return () => {
    if (previous === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previous;
  };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

scanTest(
  "after the migrated plugins are approved, applying the same plan submits nothing again; a proposed project profile is created empty and listed",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = mkdtempSync(join(tmpdir(), "xh-migration-approve-"));
    const fixture = fixtureOf(root);
    const restoreHome = redirectHome(fixture.home);
    const bundles = mkdtempSync(join(tmpdir(), "migration-bundles-"));
    const { host, connection } = await startMigrationHost(bundles);
    try {
      const scanned = await connection.request("migration.scan", {
        roots: [{ path: fixture.proj, scope: "project", label: "proj" }],
      });
      const proposal = await connection.request("migration.proposal", { scanId: scanned.scanId });
      const first = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      expect(first.drafts.length).toBeGreaterThan(0);

      // 검토함에서 보관으로 승인한다. 그러면 같은 계획의 내용은 승인본과 같아진다
      for (const draft of first.drafts) {
        // 항목마다 차례로 승인한다(승인은 같은 검토 저장소를 쓴다)
        // eslint-disable-next-line no-await-in-loop -- 항목마다 차례로 승인한다
        const decided = await connection.request("pluginReview.decide", {
          itemId: draft.itemId,
          decision: { kind: "approve", profileIds: [], libraryOnly: true },
        });
        expect(decided.item.state).toBe("approved");
      }
      const approvedNames = await connection.request("plugin.list", {
        filter: { origin: "user", reviewState: "approved" },
      });
      expect(approvedNames.plugins.map((card) => card.name).toSorted()).toEqual(
        first.drafts.map((draft) => draft.name).toSorted(),
      );

      // 다시 적용하면 바뀐 것이 없어 초안도 항목도 없다. 보고서는 새로 만든다
      const again = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      expect(again.drafts).toEqual([]);
      expect(again.reportId).not.toBe(first.reportId);
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      expect(pending.items.filter((item) => item.provenance === "migration")).toEqual([]);

      // 제안된 프로젝트 프로필은 비어서 만들어지고 프로필 목록에 든다
      const projectProfile = proposal.profileProposals.find(
        (profile) => profile.scope === "project",
      );
      if (projectProfile === undefined) throw new Error("expected a proposed project profile");
      const withProfile = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
        createProfiles: [projectProfile.name],
      });
      expect(withProfile.profiles.map((profile) => profile.name)).toEqual([projectProfile.name]);
      const [created] = withProfile.profiles;
      if (created === undefined) throw new Error("expected the profile to be created");
      const listed = await connection.request("profile.list", {});
      const stored = listed.profiles.find((profile) => profile.id === created.profileId);
      expect(stored?.title).toBe(projectProfile.name);
      expect(stored?.plugins).toEqual([]);

      // 같은 프로필 이름을 다시 만들면 이름이 겹친다
      const clash = await wireErrorOf(
        connection.request("migration.apply", {
          proposalId: proposal.proposalId,
          choices: { answers: {} },
          createProfiles: [projectProfile.name],
        }),
      );
      expect(clash.data.kind).toBe("migration.nameConflict");
      expect(clash.data.details).toEqual({ name: projectProfile.name });
    } finally {
      await connection.close();
      await host.close();
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

/** 알림 `migration.changed`와 `migration.progress`를 모은다. 처음 온 것을 기다릴 약속도 함께 돌려준다 */
function notificationsOf(connection: HostConnection): {
  readonly changes: MigrationChangedParams[];
  readonly progress: MigrationProgressParams[];
  readonly firstChange: Promise<MigrationChangedParams>;
  readonly firstProgress: Promise<MigrationProgressParams>;
} {
  const changes: MigrationChangedParams[] = [];
  const progress: MigrationProgressParams[] = [];
  const firstChange = new Promise<MigrationChangedParams>((resolve) => {
    connection.onNotification("migration.changed", (params) => {
      changes.push(params);
      resolve(params);
    });
  });
  const firstProgress = new Promise<MigrationProgressParams>((resolve) => {
    connection.onNotification("migration.progress", (params) => {
      progress.push(params);
      resolve(params);
    });
  });
  return { changes, progress, firstChange, firstProgress };
}

realTest(
  "migration.detect announces the foreign markers of a project in table order, and a dismissed marker stops being announced",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = mkdtempSync(join(tmpdir(), "xh-migration-detect-"));
    const fixture = fixtureOf(root);
    const restoreHome = redirectHome(fixture.home);
    const bundles = mkdtempSync(join(tmpdir(), "migration-bundles-"));
    const { host, connection } = await startMigrationHost(bundles);
    try {
      const detected = await connection.request("migration.detect", { workspace: fixture.proj });
      // 표 순서다: `.mcp.json`, `.claude/`, `CLAUDE.md`. 셋 다 옮길 수 있고 엔진은 읽지 않는다
      expect(detected.found).toEqual([
        { marker: ".mcp.json", harness: "claude-code", engineReads: false, importable: true },
        { marker: ".claude/", harness: "claude-code", engineReads: false, importable: true },
        { marker: "CLAUDE.md", harness: "claude-code", engineReads: false, importable: true },
      ]);
      expect(detected.notice).toEqual({
        code: "foreign_format_found",
        willStopReading: [".mcp.json"],
        importable: [".mcp.json", ".claude/", "CLAUDE.md"],
        importAvailable: true,
      });

      // 표지가 없는 폴더는 빈 목록이고 알림도 없다
      const empty = realpathSync(mkdtempSync(join(tmpdir(), "xh-migration-empty-")));
      expect(await connection.request("migration.detect", { workspace: empty })).toEqual({
        found: [],
        notice: null,
      });

      // 숨긴 표지는 다시 알리지 않는다. 나머지는 그대로다
      expect(
        await connection.request("migration.dismiss", { root: fixture.proj, marker: "CLAUDE.md" }),
      ).toEqual({});
      const afterDismiss = await connection.request("migration.detect", {
        workspace: fixture.proj,
      });
      expect(afterDismiss.found.map((entry) => entry.marker)).toEqual([".mcp.json", ".claude/"]);
      expect(afterDismiss.notice?.importable).toEqual([".mcp.json", ".claude/"]);

      // 상대 경로와 없는 폴더는 훑을 수 없다
      const relative = await wireErrorOf(
        connection.request("migration.detect", { workspace: "relative/dir" }),
      );
      expect(relative.code).toBe(3671);
      expect(relative.data.kind).toBe("migration.rootInvalid");
      const missing = await wireErrorOf(
        connection.request("migration.detect", { workspace: join(root, "no-such-dir") }),
      );
      expect(missing.data.kind).toBe("migration.rootInvalid");
    } finally {
      await connection.close();
      await host.close();
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

scanTest(
  "migration.scan counts the project's items without their values, announces progress and change, and refuses bad roots",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = mkdtempSync(join(tmpdir(), "xh-migration-scan-"));
    const fixture = fixtureOf(root);
    const restoreHome = redirectHome(fixture.home);
    const bundles = mkdtempSync(join(tmpdir(), "migration-bundles-"));
    const { host, connection } = await startMigrationHost(bundles);
    const seen = notificationsOf(connection);
    try {
      const scanned = await connection.request("migration.scan", {
        roots: [{ path: fixture.proj, scope: "project", label: "proj" }],
      });
      expect(scanned.summary.itemCount).toBe(scanned.items.length);
      // 값은 싣지 않는다: 시크릿 가짜 값이 응답에 없고, 개수만 있다
      expect(JSON.stringify(scanned)).not.toContain(SECRET);
      // 항목은 경로 순서다. 경로는 루트 기준의 절대 경로다
      expect(scanned.items.map((item) => [item.harness, item.kind, item.scope, item.path])).toEqual(
        [
          ["claude-code", "skill", "project", join(fixture.proj, ".claude", "skills", SKILL_NAME)],
          ["claude-code", "mcp", "project", join(fixture.proj, ".mcp.json")],
          ["claude-code", "instruction", "project", join(fixture.proj, "CLAUDE.md")],
        ],
      );
      expect(scanned.summary.itemCount).toBe(3);
      // 시크릿은 개수로만 보인다. MCP 서버의 `GITHUB_TOKEN` 환경 참조와 `API_TOKEN` 평문 값, 둘 다 시크릿 참조가 된다
      expect(scanned.items.map((item) => item.secretCount)).toEqual([0, 2, 0]);
      expect(scanned.diagnostics).toEqual([]);

      // 처리 알림: 루트마다 한 번, 훑기가 끝나면 변화 알림이 하나 온다
      expect(await seen.firstProgress).toEqual({ scanId: scanned.scanId, done: 1, total: 1 });
      expect(await seen.firstChange).toEqual({ kind: "scan" });
      expect(seen.progress).toEqual([{ scanId: scanned.scanId, done: 1, total: 1 }]);
      expect(seen.changes).toEqual([{ kind: "scan" }]);

      // 루트가 없는 목록, 상대 경로, 없는 폴더는 거절한다
      const empty = await wireErrorOf(connection.request("migration.scan", { roots: [] }));
      expect(empty.data.kind).toBe("jsonrpc.invalidParams");
      const relative = await wireErrorOf(
        connection.request("migration.scan", {
          roots: [{ path: "relative", scope: "project", label: "x" }],
        }),
      );
      expect(relative.data.kind).toBe("migration.rootInvalid");
      const missing = await wireErrorOf(
        connection.request("migration.scan", {
          roots: [{ path: join(root, "absent"), scope: "project", label: "x" }],
        }),
      );
      expect(missing.data.kind).toBe("migration.rootInvalid");
    } finally {
      await connection.close();
      await host.close();
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

scanTest(
  "migration.apply writes the planned plugin folder and a migration review item that match the proposal; the report reads back, and a second apply of the same plan is refused while the first is pending",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = mkdtempSync(join(tmpdir(), "xh-migration-apply-"));
    const fixture = fixtureOf(root);
    const restoreHome = redirectHome(fixture.home);
    const bundles = mkdtempSync(join(tmpdir(), "migration-bundles-"));
    const pluginsDir = join(home.root, "config", "plugins");
    const { host, connection } = await startMigrationHost(bundles);
    try {
      const scanned = await connection.request("migration.scan", {
        roots: [{ path: fixture.proj, scope: "project", label: "proj" }],
      });
      const proposal = await connection.request("migration.proposal", { scanId: scanned.scanId });
      expect(proposal.questions).toEqual([]);
      expect(proposal.plugins.length).toBeGreaterThan(0);

      const applied = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      expect(applied.profiles).toEqual([]);
      expect(applied.drafts.map((draft) => draft.name).toSorted()).toEqual(
        proposal.plugins.map((plugin) => plugin.name).toSorted(),
      );

      for (const draft of applied.drafts) {
        // 초안마다 차례로 본다(시험 본문이 읽는 순서대로 값을 맞춘다)
        // eslint-disable-next-line no-await-in-loop -- 초안마다 차례로 본다
        const item = (await connection.request("pluginReview.get", { itemId: draft.itemId })).item;
        expect(item.provenance).toBe("migration");
        expect(item.kind).toBe("new");
        expect(item.state).toBe("pending");
        expect(item.name).toBe(draft.name);

        // 원본 폴더의 파일은 검토 항목의 후보 파일과 바이트 단위로 같다
        const folder = join(pluginsDir, draft.name);
        const onDisk = bytesOf(folder);
        expect(Object.keys(onDisk).toSorted()).toEqual(
          item.files.map((file) => file.path).toSorted(),
        );
        for (const file of item.files) {
          const bytes = onDisk[file.path];
          expect(bytes).toBeDefined();
          if (bytes === undefined) continue;
          expect(file.bytes).toBe(bytes.length);
          expect(file.sha256).toBe(sha256Of(bytes).slice("sha256:".length));
        }

        // 초안은 같은 항목을 가리킨다
        // eslint-disable-next-line no-await-in-loop -- 초안마다 차례로 본다
        const drafts = await connection.request("plugin.draft.list", { name: draft.name });
        expect(drafts.drafts.map((entry) => [entry.draftId, entry.submittedItemId])).toEqual([
          [draft.draftId, draft.itemId],
        ]);
        const candidateHash = item.candidateHash;
        if (candidateHash === null) throw new Error("a migrated item has a candidate");
        expect(drafts.drafts.map((entry) => entry.contentHash)).toEqual([candidateHash]);
      }

      // 보고서는 제안의 보고 줄과 같고, 규칙 버전을 싣는다
      const report = await connection.request("migration.report.get", {
        reportId: applied.reportId,
      });
      expect(report.report).toEqual(proposal.report);
      expect(report.rulesVersions["claude-code"]).toBe("2026-11-18");

      // 같은 계획을 한 번 더 적용하면 대기 중인 폴더와 겹쳐 거절한다. 폴더는 그대로다
      const before = bytesOf(join(pluginsDir, applied.drafts[0]?.name ?? ""));
      const first = applied.drafts[0];
      if (first === undefined) throw new Error("expected at least one migrated plugin");
      const again = await wireErrorOf(
        connection.request("migration.apply", {
          proposalId: proposal.proposalId,
          choices: { answers: {} },
        }),
      );
      expect(again.code).toBe(3673);
      expect(again.data.kind).toBe("migration.nameConflict");
      expect(again.data.details).toEqual({ name: first.name });
      expect(bytesOf(join(pluginsDir, first.name))).toEqual(before);

      // 제안에 없는 프로필 이름은 거절한다. 모르는 제안과 보고서는 없는 것이다
      const unproposed = await wireErrorOf(
        connection.request("migration.apply", {
          proposalId: proposal.proposalId,
          choices: { answers: {} },
          createProfiles: ["not-proposed"],
        }),
      );
      expect(unproposed.data.kind).toBe("jsonrpc.invalidParams");
      const noReport = await wireErrorOf(
        connection.request("migration.report.get", { reportId: "report-missing" }),
      );
      expect(noReport.code).toBe(3675);
      expect(noReport.data.details).toEqual({ id: "report-missing" });
      const noScan = await wireErrorOf(
        connection.request("migration.proposal", { scanId: "scan-missing" }),
      );
      expect(noScan.data.kind).toBe("migration.notFound");
      expect(noScan.data.details).toEqual({ id: "scan-missing" });
    } finally {
      await connection.close();
      await host.close();
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

scanTest(
  "a Claude Code hook config becomes one hook plugin draft: the guard script is copied byte for byte, the hook with a secret in its script is reported not_ported, and no secret value or original file changes",
  async () => {
    const home: EngineHome = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const root = mkdtempSync(join(tmpdir(), "xh-migration-hook-"));
    const fixture = hookFixtureOf(root);
    const restoreHome = redirectHome(fixture.home);
    const bundles = mkdtempSync(join(tmpdir(), "migration-bundles-"));
    const pluginsDir = join(home.root, "config", "plugins");
    const projectBefore = bytesOf(fixture.proj);
    const homeBefore = bytesOf(fixture.home);
    const { host, connection } = await startMigrationHost(bundles);
    try {
      const scanned = await connection.request("migration.scan", {
        roots: [{ path: fixture.proj, scope: "project", label: "proj" }],
      });
      // 훅 항목은 두 개다. 응답에는 시크릿 값이 없다
      expect(scanned.items.filter((item) => item.kind === "hook").length).toBe(2);
      expect(JSON.stringify(scanned)).not.toContain(HOOK_SECRET);

      const proposal = await connection.request("migration.proposal", { scanId: scanned.scanId });
      expect(proposal.questions).toEqual([]);
      expect(proposal.plugins.length).toBe(1);
      // 보고 줄: 옮긴 PreToolUse는 차이가 있고, 시크릿 값이 든 PostToolUse는 옮기지 않는다
      const hookLines = proposal.report.filter((line) => line.kind === "hook");
      expect(
        hookLines
          .map((line) => `${line.status}:${line.reason?.code ?? "-"}`)
          .toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["differs:-", "not_ported:secret_in_script"]);

      const applied = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      expect(applied.profiles).toEqual([]);
      expect(applied.drafts.length).toBe(1);
      const draft = applied.drafts[0];
      if (draft === undefined) throw new Error("expected one hook plugin draft");

      // 드래프트 폴더: 매니페스트, 이식 기록, 생성 코드, 데이터, 스크립트 복사본 하나
      const folder = join(pluginsDir, draft.name);
      const onDisk = bytesOf(folder);
      expect(Object.keys(onDisk).toSorted()).toEqual([
        ".fresnel-plugin/migration.json",
        ".fresnel-plugin/plugin.json",
        "hooks.data.json",
        "plugin.js",
        "scripts/guard.sh",
      ]);
      // 스크립트 복사본은 원본 바이트 그대로다
      expect(Buffer.from(onDisk["scripts/guard.sh"] ?? new Uint8Array())).toEqual(
        Buffer.from(GUARD_TEXT, "utf8"),
      );
      const manifestParsed = parseJson(
        readFileSync(join(folder, ".fresnel-plugin/plugin.json"), "utf8"),
      );
      if (!manifestParsed.ok) throw new Error("the manifest is not JSON");
      expect(manifestParsed.value).toMatchObject({
        schemaVersion: 2,
        name: draft.name,
        entry: "./plugin.js",
        scripts: [{ name: "guard", runner: "sh", file: "scripts/guard.sh", timeoutMs: 29_000 }],
        plugins: [
          {
            layer: "plugin",
            hooks: ["tool.call.before"],
            hookDecides: [{ hook: "tool.call.before", decides: ["ask", "block"] }],
          },
        ],
      });

      // 검토 항목: 대기 중이고 출처가 가져오기다. 카드의 스크립트 줄에 실행될 명령이 실린다
      const item = (await connection.request("pluginReview.get", { itemId: draft.itemId })).item;
      expect(item.provenance).toBe("migration");
      expect(item.state).toBe("pending");
      expect(item.card.enforcement).toBe("enforced");
      expect(item.card.does.hook?.hooks.map((hook) => hook.name)).toEqual(["tool.call.before"]);
      expect(item.card.does.inject?.scripts).toEqual([
        {
          name: "guard",
          launch: { command: "sh", args: ["scripts/guard.sh"], envNames: [], cwd: null },
          timeoutMs: 29_000,
          uses: ["system_tools", "network"],
        },
      ]);
      expect(item.card.runs).toEqual({ code: true, isolated: true });

      // 값 없음: 응답, 보고서, 검토 항목, 드래프트 폴더, 엔진 홈 어디에도 시크릿 값이 없다
      const report = await connection.request("migration.report.get", {
        reportId: applied.reportId,
      });
      expect(report.report).toEqual(proposal.report);
      for (const text of [
        JSON.stringify(scanned),
        JSON.stringify(proposal),
        JSON.stringify(applied),
        JSON.stringify(report),
        JSON.stringify(item),
      ]) {
        expect(text).not.toContain(HOOK_SECRET);
      }
      expect(holdsValue(bytesOf(home.root), HOOK_SECRET)).toBe(false);
      // 대조: 같은 검색은 원본의 `leak.sh`에서 값을 찾는다(검색이 값을 볼 수 있다는 확인)
      expect(holdsValue(projectBefore, HOOK_SECRET)).toBe(true);

      // 원본 폴더 두 곳은 시험 전후로 파일 목록과 바이트가 같다
      expect(bytesOf(fixture.proj)).toEqual(projectBefore);
      expect(bytesOf(fixture.home)).toEqual(homeBefore);
    } finally {
      await connection.close();
      await host.close();
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);
