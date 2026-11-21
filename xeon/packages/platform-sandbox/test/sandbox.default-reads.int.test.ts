import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import { canonicalizePath } from "../src/paths.ts";
import {
  ENVIRONMENT_EXIT_CODE,
  VAULT_SECRET,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] 기본은 읽기를 막지 않는다. 실제 srt로 확인한다:
// (a) 기본 상태에서 사용자 폴더 안의 자격 파일과 다른 하네스 폴더를 읽는다, (b) 쓰기 범위가 좁은 길(MCP 서버 정책)의 쓰기 경계는 그대로다
// (셸 도구의 쓰기 제한 없음은 sandbox.open-writes.int.test.ts),
// (c) Fresnel 자신의 시크릿·데이터 폴더는 읽기도 막힌다, (d) 설정 extra 경로는 읽기와 쓰기를 모두 막힌다,
// (g) 셸 정책과 파일 도구가 보는 보호 경로 목록이 같다. 임시 홈만 쓰고 실제 홈의 파일은 읽지 않는다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const FAKE = "fake-value-for-default-reads";
/** 이 OS의 키체인 모양 폴더(홈 아래). 기본 목록에 있지만 읽기는 허용된다 */
const KEYRING_FOLDER =
  process.platform === "darwin" ? "Library/Keychains" : ".local/share/keyrings";

suite(
  "default reads: the shell reads the user's folders; Fresnel's own and listed paths stay denied (real srt)",
  () => {
    let box: RealSandbox;
    let home = "";
    let workspace = "";

    const shellFor = (writeRootsWorkspace: boolean) =>
      box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({
          workspaceRoots: writeRootsWorkspace ? [workspace] : [],
          tempDir: box.dirs.tmp,
        }),
      );
    const run = (command: string, wrapped: boolean) =>
      runCollected(wrapped ? shellFor(true) : box.shell, command, { cwd: workspace });

    beforeAll(async () => {
      box = await startRealSandbox();
      home = box.dirs.home;
      workspace = box.dirs.workspace;
      const files: Record<string, string> = {
        [join(home, ".ssh", "id_ed25519")]: FAKE,
        [join(home, KEYRING_FOLDER, "login.db")]: FAKE,
        [join(home, ".claude", "x")]: FAKE,
        [join(home, ".codex", "x")]: FAKE,
        [join(workspace, ".env")]: FAKE,
        [join(box.dirs.data, "canary.txt")]: FAKE,
        [join(box.dirs.config, "secrets", "key.txt")]: FAKE,
        [join(home, ".config", "sops", "age", "keys.txt")]: FAKE,
      };
      for (const [path, value] of Object.entries(files)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, value);
      }
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    test("(a) by default, reads of an SSH key, a keyring folder, agent folders and a workspace .env succeed in the sandbox", async () => {
      const paths = [
        join(home, ".ssh", "id_ed25519"),
        join(home, KEYRING_FOLDER, "login.db"),
        join(home, ".claude", "x"),
        join(home, ".codex", "x"),
        join(workspace, ".env"),
      ];
      const reads = await Promise.all(paths.map((path) => run(`cat '${path}'`, true)));
      for (const [index, read] of reads.entries()) {
        expect({ path: paths[index], output: read.output }).toEqual({
          path: paths[index],
          output: FAKE,
        });
      }
    }, 120_000);

    test("(a) the listing and the file tools' protected-path list agree: none of those folders is read-denied", () => {
      const listed = box.service.protectedPaths([workspace]);
      const readDenied = listed
        .filter((entry) => entry.access === "read_write")
        .map((entry) => entry.reason);
      expect([...new Set(readDenied)].toSorted()).toEqual([
        "fresnel_data",
        "secret_key",
        "user_extra",
      ]);
      for (const path of [
        join(home, ".ssh", "id_ed25519"),
        join(home, KEYRING_FOLDER, "login.db"),
        join(home, ".claude", "x"),
        join(home, ".codex", "x"),
        join(workspace, ".env"),
      ]) {
        expect(matchProtectedPath(listed, canonicalizePath(path), "read")).toBeUndefined();
      }
    });

    test("(b) on the narrow default policy (no writeEverywhere), writes outside the workspace are still refused, and nothing is created", async () => {
      const outside = join(home, "escaped.txt");
      const write = await run(`echo x > '${outside}'`, true);
      expect(write.exitCode === 0).toBe(false);
      expect(existsSync(outside)).toBe(false);
    });

    test("(b) a former credential folder added as a write root stays write-protected", async () => {
      // 쓰기 범위가 좁은 정책(쓰기 제한 없음이 아닌 길)에 자격 폴더를 쓰기 루트로 넘겨도 보호 경로 안의 루트는 빠진다
      const policy = box.service.defaultPolicy({
        workspaceRoots: [workspace, join(home, ".ssh"), join(home, ".claude")],
        tempDir: box.dirs.tmp,
      });
      expect(policy.writeRoots).not.toContain(join(home, ".ssh"));
      expect(policy.writeRoots).not.toContain(join(home, ".claude"));
      const sshWrite = await run(`echo x > '${join(home, ".ssh", "new-key")}'`, true);
      expect(sshWrite.exitCode === 0).toBe(false);
      const claudeWrite = await run(`echo x >> '${join(home, ".claude", "x")}'`, true);
      expect(claudeWrite.exitCode === 0).toBe(false);
      expect(readFileSync(join(home, ".claude", "x"), "utf8")).toBe(FAKE);
      expect(existsSync(join(home, ".ssh", "new-key"))).toBe(false);
    });

    test("(c) Fresnel's data folder, its secret folder and the sops age key stay read-denied", async () => {
      const paths = [
        join(box.dirs.data, "canary.txt"),
        join(box.dirs.config, "secrets", "key.txt"),
        join(home, ".config", "sops", "age", "keys.txt"),
      ];
      const reads = await Promise.all(paths.map((path) => run(`cat '${path}'`, true)));
      for (const [index, read] of reads.entries()) {
        expect({ path: paths[index], ok: read.exitCode === 0 }).toEqual({
          path: paths[index],
          ok: false,
        });
        expect(read.output).not.toContain(FAKE);
      }
      // 같은 명령을 감싸지 않으면 읽힌다(대조군)
      const control = await run(`cat '${paths[0]}'`, false);
      expect(control.output).toBe(FAKE);
    });

    test("(d) a folder listed in protectedPaths.extra is refused for reading and writing, and its content is unchanged", async () => {
      const vault = join(box.dirs.root, "vault", "secret.txt");
      const read = await run(`cat '${vault}'`, true);
      expect(read.exitCode === 0).toBe(false);
      expect(read.output).not.toContain(VAULT_SECRET);
      const write = await run(`echo x >> '${vault}'`, true);
      expect(write.exitCode === 0).toBe(false);
      expect(readFileSync(vault, "utf8")).toBe(VAULT_SECRET);
    });
  },
);

/** 중복을 지우고 정렬한다(비교용) */
const sorted = (values: readonly string[]): string[] => [...new Set(values)].toSorted();

/** 이름 패턴 항목을 뺀 경로 항목 */
const named = (entries: readonly ProtectedPathEntry[]): ProtectedPathEntry[] =>
  entries.filter((entry) => entry.match !== "basename");

suite(
  "protected-path list: the shell policy and the file tools see the same denials (real srt)",
  () => {
    let box: RealSandbox;

    beforeAll(async () => {
      box = await startRealSandbox();
      mkdirSync(join(box.dirs.home, ".ssh"), { recursive: true });
      writeFileSync(join(box.dirs.home, ".ssh", "id_ed25519"), FAKE);
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    test("(g) the shell policy's read and write denials equal the protected-path list the file tools check", () => {
      // 정책은 작업 공간과 임시 폴더를 쓰기 루트로 보므로 목록도 같은 root로 묻는다(root별 git 항목이 같아진다)
      const roots = [box.dirs.workspace, box.dirs.tmp];
      const listed = box.service.protectedPaths(roots);
      const policy = box.service.defaultPolicy({
        workspaceRoots: [box.dirs.workspace],
        tempDir: box.dirs.tmp,
      });
      expect(policy.readDeny).toEqual(
        sorted(
          named(listed)
            .filter((e) => e.access === "read_write")
            .map((e) => e.path),
        ),
      );
      expect(policy.writeDeny).toEqual(sorted(named(listed).map((e) => e.path)));
      // 파일 도구는 같은 목록을 realpath로 검사한다. 자격 파일은 읽히고, extra 경로는 막힌다
      const sshKey = canonicalizePath(join(box.dirs.home, ".ssh", "id_ed25519"));
      expect(matchProtectedPath(listed, sshKey, "read")).toBeUndefined();
      expect(matchProtectedPath(listed, sshKey, "write")?.reason).toBe("credentials");
      const dataFile = canonicalizePath(join(box.dirs.data, "canary.txt"));
      expect(matchProtectedPath(listed, dataFile, "read")?.reason).toBe("fresnel_data");
    });
  },
);
