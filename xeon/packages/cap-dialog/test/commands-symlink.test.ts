import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandsService } from "../src/commands/service.ts";
import { MAX_COMMAND_FILE_BYTES } from "../src/upstream/pi/prompt-templates.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { realCommandFiles } from "./support/real-command-files.ts";

// 실제 임시 폴더와 실제 심볼릭 링크로 명령 읽기 경로를 시험한다. 끊어진 링크만 흉내 내던 시험을 보완한다.

let root: string;
let project: string;
let commandsDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dialog-symlink-"));
  project = join(root, "project");
  commandsDir = join(project, ".fresnel", "commands");
  await mkdir(commandsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 실제 파일 원천과 프로젝트 폴더로 명령 서비스를 만든다. 프로젝트는 신뢰한 것으로 본다 */
function setup() {
  const h = harness({ projectRoot: () => project });
  const deps = { ...h.deps, commandFiles: realCommandFiles() };
  return { h, ...createCommandsService(deps) };
}

describe("명령 파일 심볼릭 링크와 크기 상한", () => {
  test("폴더 밖을 가리키는 링크는 건너뛰고, 그 내용은 목록과 광고에 없다", async () => {
    const secrets = join(root, "secrets");
    await mkdir(secrets);
    const secretFile = join(secrets, ".env");
    await writeFile(secretFile, "OUTSIDE_MARKER LEAK-0001\nsecond line\n");
    await writeFile(join(commandsDir, "ok.md"), "정상 명령");
    await symlink(secretFile, join(commandsDir, "notes.md"));

    const { h, api, advertisement } = setup();
    const thread = newThread();
    const { commands } = await api.list({}, callOptions(thread));
    expect(commands.map((command) => command.name)).toEqual(["ok"]);

    const advertised = await advertisement(thread, new AbortController().signal);
    expect(advertised).toContain("- /ok: 정상 명령");
    expect(advertised).not.toContain("LEAK");
    expect(advertised).not.toContain("notes");

    const skipped = h.lines.filter((line) => line.event === "dialog.command_file_skipped");
    expect(skipped.map((line): unknown => line.fields)).toEqual([
      expect.objectContaining({ path: join(commandsDir, "notes.md") }),
    ]);
  });

  test("폴더 안을 가리키는 링크는 대상을 읽는다", async () => {
    await writeFile(join(commandsDir, "target.md"), "안쪽 대상 설명");
    await symlink("target.md", join(commandsDir, "alias.md"));

    const { api } = setup();
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands).toMatchObject([
      { name: "alias", description: "안쪽 대상 설명", source: "project" },
      { name: "target", description: "안쪽 대상 설명", source: "project" },
    ]);
  });

  test("일반 파일은 읽는다", async () => {
    await writeFile(join(commandsDir, "plain.md"), "---\ndescription: 평범한 명령\n---\n본문");

    const { api } = setup();
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands).toMatchObject([{ name: "plain", description: "평범한 명령" }]);
  });

  test("크기 상한 이하의 파일은 읽고, 넘는 파일은 건너뛴다", async () => {
    await writeFile(join(commandsDir, "fits.md"), "a".repeat(MAX_COMMAND_FILE_BYTES));
    await writeFile(join(commandsDir, "huge.md"), "b".repeat(MAX_COMMAND_FILE_BYTES + 1));

    const { h, api } = setup();
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands.map((command) => command.name)).toEqual(["fits"]);
    const skipped = h.lines.filter((line) => line.event === "dialog.command_file_skipped");
    expect(skipped.map((line): unknown => line.fields)).toEqual([
      expect.objectContaining({ path: join(commandsDir, "huge.md") }),
    ]);
  });
});
