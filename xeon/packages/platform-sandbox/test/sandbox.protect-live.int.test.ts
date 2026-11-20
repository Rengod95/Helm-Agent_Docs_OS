import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { matchProtectedPath, type Shell } from "@fresnel/contracts/services";
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

// [제안, AGE-63, 2026-11-20 사용자 결정 "전체 허용, 막을 부분만 대화로 더한다"] 대화에서 `sandbox_protect`로 더한 경로는 설정 extra의
// 값이 바뀌는 것만으로 같은 서비스의 다음 셸 호출부터 막힌다. 서비스를 다시 만들거나 갱신하지 않는다. 실제 srt로 확인한다:
// (a) 더하기 전에는 같은 감싼 셸이 읽고 쓴다, (b) 설정만 바꾼 뒤 그 감싼 셸(정책 객체도 더하기 전에 만든 것)이 읽기와 쓰기를 막는다,
// (c) 파일 도구가 보는 목록도 같은 시점에 바뀐다. 실제 홈은 건드리지 않는다(임시 디렉터리만 쓴다).

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const NOTE = "note.txt";
const OPEN = "open.txt";

suite(
  "protect live: a path added to protectedPaths.extra is refused by the next call of the same service (real srt)",
  () => {
    let box: RealSandbox;
    let folder = "";
    let wrapped: Shell;

    beforeAll(async () => {
      // 시작할 때는 extra가 비어 있다. 보호 폴더는 쓰기 루트(작업 공간) 안에 있어 쓰기 거부가 보호 때문인지 확인할 수 있다
      box = await startRealSandbox({ protectedPathsExtra: [] });
      folder = join(box.dirs.workspace, "later-protected");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "secret.txt"), VAULT_SECRET);
      writeFileSync(join(folder, NOTE), "before\n");
      writeFileSync(join(box.dirs.workspace, OPEN), "open-value");
      // 감싼 셸과 그 정책은 더하기 전에 만든다. 뒤의 호출이 막히려면 호출마다 다시 읽어야 한다
      wrapped = box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({
          workspaceRoots: [box.dirs.workspace],
          tempDir: box.dirs.tmp,
        }),
      );
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    const run = (command: string) => runCollected(wrapped, command, { cwd: box.dirs.workspace });

    test("(a) before the path is added, the wrapped shell reads and writes it", async () => {
      const read = await run(`cat '${join(folder, "secret.txt")}'`);
      expect({ exitCode: read.exitCode, output: read.output }).toEqual({
        exitCode: 0,
        output: VAULT_SECRET,
      });
      const write = await run(`echo after >> '${join(folder, NOTE)}'`);
      expect(write.exitCode).toBe(0);
    });

    test("(b) after only the setting changes, the next call of the same wrapped shell cannot read or write it, with no refresh", async () => {
      box.setSettings({ protectedPathsExtra: [folder] });
      const read = await run(`cat '${join(folder, "secret.txt")}'`);
      expect(read.exitCode === 0).toBe(false);
      expect(read.output).not.toContain(VAULT_SECRET);
      const write = await run(`echo x >> '${join(folder, NOTE)}'`);
      expect(write.exitCode === 0).toBe(false);
      expect(readFileSync(join(folder, NOTE), "utf8")).toBe("before\nafter\n");
      // 같은 셸로 보호 밖의 파일은 그대로 읽힌다(대조군)
      const control = await run(`cat '${join(box.dirs.workspace, OPEN)}'`);
      expect({ exitCode: control.exitCode, output: control.output }).toEqual({
        exitCode: 0,
        output: "open-value",
      });
    });

    test("(c) the file tools' protected-path list changes at the same moment: reads and writes are both refused", () => {
      const listed = box.service.protectedPaths([box.dirs.workspace]);
      const secret = canonicalizePath(join(folder, "secret.txt"));
      expect(matchProtectedPath(listed, secret, "read")?.reason).toBe("user_extra");
      expect(
        matchProtectedPath(listed, canonicalizePath(join(folder, NOTE)), "write")?.reason,
      ).toBe("user_extra");
    });
  },
);
