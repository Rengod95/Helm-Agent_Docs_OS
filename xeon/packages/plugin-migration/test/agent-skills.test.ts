import { describe, expect, test } from "bun:test";
import { agentSkillsAdapter, scanSkillsDir } from "../src/adapters/agent-skills.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type IrField,
  type IrSkill,
  type ScanLimits,
  type SourceItem,
} from "../src/types.ts";
import { memoryFs, type MemoryEntry } from "./support.ts";

const HOME = "/home/sample";
const DIR = `${HOME}/.agents/skills`;
const ctx = { homeDir: HOME };
const encoder = new TextEncoder();

function skillMd(name: string, description: string, extra = "", body = "# Title\n"): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}`;
}

function scanUser(
  files: Readonly<Record<string, MemoryEntry>>,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
) {
  return scanSkillsDir({
    fs: memoryFs(files),
    dir: DIR,
    scope: "user",
    harness: "agent-skills",
    rootLabel: "user",
    limits,
    ctx,
  });
}

function single<T>(values: readonly T[]): T {
  const [first, ...rest] = values;
  if (first === undefined || rest.length > 0)
    throw new Error(`expected exactly one value, got ${values.length}`);
  return first;
}

function skillIrOf(item: SourceItem): IrSkill {
  if (item.ir.kind !== "skill") throw new Error(`expected a skill item, got ${item.ir.kind}`);
  return item.ir;
}

function fieldIrOf(item: SourceItem): IrField {
  if (item.ir.kind !== "field") throw new Error(`expected a field item, got ${item.ir.kind}`);
  return item.ir;
}

describe("agent-skills: 정상 스킬", () => {
  test("파일 목록과 바이트가 그대로 실리고 license는 머리말 항목을 만들지 않는다", async () => {
    const binary = new Uint8Array([0, 255, 1, 128]);
    const scriptText = "#!/bin/sh\necho ok\n";
    const refText = "# A\n한글 본문\n";
    const skillText = skillMd("deploy", "Deploy the app", "license: MIT\n", "Run the steps.\n");
    const result = await scanUser({
      [`${DIR}/deploy/SKILL.md`]: skillText,
      [`${DIR}/deploy/scripts/run.sh`]: scriptText,
      [`${DIR}/deploy/references/a.md`]: refText,
      [`${DIR}/deploy/assets/x.bin`]: binary,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.scanned).toEqual(["~/.agents/skills"]);
    expect(result.items.map((item) => item.kind)).toEqual(["skill"]);

    const item = single(result.items);
    const skill = skillIrOf(item);
    expect(skill.dirName).toBe("deploy");
    expect(skill.name).toBe("deploy");
    expect(skill.description).toBe("Deploy the app");
    expect(skill.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "assets/x.bin",
      "references/a.md",
      "scripts/run.sh",
    ]);
    const bytesOf = (path: string): Uint8Array | undefined =>
      skill.files.find((file) => file.path === path)?.bytes;
    expect(bytesOf("SKILL.md")).toEqual(encoder.encode(skillText));
    expect(bytesOf("scripts/run.sh")).toEqual(encoder.encode(scriptText));
    expect(bytesOf("references/a.md")).toEqual(encoder.encode(refText));
    expect(bytesOf("assets/x.bin")).toEqual(binary);

    expect(item.bytes).toBe(
      encoder.encode(skillText).length +
        encoder.encode(scriptText).length +
        encoder.encode(refText).length +
        binary.length,
    );
    expect(item.path).toBe("~/.agents/skills/deploy");
    expect(item.keyPath).toBe("deploy");
    expect(item.scope).toBe("user");
    expect(item.rootLabel).toBe("user");
    expect(item.harness).toBe("agent-skills");
    expect(item.secrets).toEqual([]);
    expect(item.warnings).toEqual([]);
  });

  test("스킬 항목 순서는 폴더 이름 순이다", async () => {
    const result = await scanUser({
      [`${DIR}/b-skill/SKILL.md`]: skillMd("b-skill", "B"),
      [`${DIR}/a-skill/SKILL.md`]: skillMd("a-skill", "A"),
    });
    expect(result.items.map((item) => item.keyPath)).toEqual(["a-skill", "b-skill"]);
  });
});

describe("agent-skills: 머리말 키마다 항목", () => {
  test("Claude 확장 키와 모르는 키는 키마다 field 항목이고 summary가 맞다", async () => {
    const result = await scanUser({
      [`${DIR}/review/SKILL.md`]: skillMd(
        "review",
        "Review code",
        [
          "allowed-tools: Read, Grep",
          "model: sonnet",
          "context: fork",
          "hooks:",
          "  PreToolUse:",
          "    command: echo hi",
          "foo: bar",
          "api_token: hunter2",
          "",
        ].join("\n"),
      ),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.items.map((item) => item.kind)).toEqual([
      "skill",
      "field",
      "field",
      "field",
      "field",
      "field",
      "field",
    ]);

    const fields = result.items.slice(1).map((item) => {
      const ir = fieldIrOf(item);
      return {
        keyPath: item.keyPath,
        key: ir.key,
        container: ir.container,
        summary: ir.summary,
        path: item.path,
      };
    });
    expect(fields).toEqual([
      {
        keyPath: "review.frontmatter.allowed-tools",
        key: "allowed-tools",
        container: "skill",
        summary: "Read, Grep",
        path: "~/.agents/skills/review/SKILL.md",
      },
      {
        keyPath: "review.frontmatter.model",
        key: "model",
        container: "skill",
        summary: "sonnet",
        path: "~/.agents/skills/review/SKILL.md",
      },
      {
        keyPath: "review.frontmatter.context",
        key: "context",
        container: "skill",
        summary: "fork",
        path: "~/.agents/skills/review/SKILL.md",
      },
      {
        keyPath: "review.frontmatter.hooks",
        key: "hooks",
        container: "skill",
        summary: undefined,
        path: "~/.agents/skills/review/SKILL.md",
      },
      {
        keyPath: "review.frontmatter.foo",
        key: "foo",
        container: "skill",
        summary: "bar",
        path: "~/.agents/skills/review/SKILL.md",
      },
      // 시크릿 모양의 키는 항목은 남기고 요약은 비운다
      {
        keyPath: "review.frontmatter.api_token",
        key: "api_token",
        container: "skill",
        summary: undefined,
        path: "~/.agents/skills/review/SKILL.md",
      },
    ]);
  });
});

describe("agent-skills: 본문 치환", () => {
  test("세 종류가 감지되고 항목마다 한 번씩 나온다", async () => {
    const body = "Status: !`git status`\nDir: ${CLAUDE_SKILL_DIR}/scripts\nArgs: $ARGUMENTS\n";
    const result = await scanUser({
      [`${DIR}/lint/SKILL.md`]: skillMd("lint", "Lint things", "", body),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.items.map((item) => item.kind)).toEqual(["skill", "field", "field", "field"]);

    const bodyFields = result.items.slice(1).map((item) => {
      const ir = fieldIrOf(item);
      return { keyPath: item.keyPath, container: ir.container, key: ir.key, summary: ir.summary };
    });
    expect(bodyFields).toEqual([
      {
        keyPath: "lint.body.shell-injection",
        container: "skill-body",
        key: "shell-injection",
        summary: undefined,
      },
      {
        keyPath: "lint.body.skill-dir-var",
        container: "skill-body",
        key: "skill-dir-var",
        summary: undefined,
      },
      {
        keyPath: "lint.body.argument-substitution",
        container: "skill-body",
        key: "argument-substitution",
        summary: undefined,
      },
    ]);
  });

  test("코드 펜스 안의 치환은 세지 않고, 펜스 밖의 $2는 센다", async () => {
    const body =
      "Example:\n```\n!`ls`\n${CLAUDE_SKILL_DIR}\n$1 and $ARGUMENTS\n```\nUse $2 here.\n";
    const result = await scanUser({
      [`${DIR}/fenced/SKILL.md`]: skillMd("fenced", "Fenced", "", body),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.items.map((item) => item.keyPath)).toEqual([
      "fenced",
      "fenced.body.argument-substitution",
    ]);
  });
});

describe("agent-skills: 머리말 오류", () => {
  test("머리말이 없으면 진단과 name undefined", async () => {
    const result = await scanUser({ [`${DIR}/plain/SKILL.md`]: "# Just text\nno frontmatter\n" });
    expect(result.diagnostics.map((item) => item.code)).toEqual(["invalid_frontmatter"]);
    expect(result.diagnostics[0]?.path).toBe("~/.agents/skills/plain/SKILL.md");
    const skill = skillIrOf(single(result.items));
    expect(skill.name).toBeUndefined();
    expect(skill.description).toBeUndefined();
  });

  test("머리말이 깨지면 진단, 항목은 name undefined, 진단 문장에 원문 줄이 없다", async () => {
    const result = await scanUser({
      [`${DIR}/broken/SKILL.md`]: "---\nname: x\n  bad: indentation\n---\nbody\n",
      [`${DIR}/unclosed/SKILL.md`]: "---\nname: y\n",
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "invalid_frontmatter",
      "invalid_frontmatter",
    ]);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toContain("indentation");
    }
    expect(result.items.map((item) => item.keyPath)).toEqual(["broken", "unclosed"]);
    for (const item of result.items) {
      const skill = skillIrOf(item);
      expect(skill.name).toBeUndefined();
      expect(skill.description).toBeUndefined();
    }
  });
});

describe("agent-skills: IR에 그대로 드러나는 문제", () => {
  test("name이 폴더 이름과 다르고 description이 없으면 IR에 그대로 실린다", async () => {
    const result = await scanUser({
      [`${DIR}/deploy-app/SKILL.md`]: "---\nname: Deploy_App\n---\nbody\n",
    });
    expect(result.diagnostics).toEqual([]);
    const skill = skillIrOf(single(result.items));
    expect(skill.dirName).toBe("deploy-app");
    expect(skill.name).toBe("Deploy_App");
    expect(skill.description).toBeUndefined();
  });
});

describe("agent-skills: 상한", () => {
  test("maxSkillFiles를 넘으면 그 스킬만 빠지고 limit 진단이 난다", async () => {
    const limits = { ...DEFAULT_SCAN_LIMITS, maxSkillFiles: 2 };
    const result = await scanUser(
      {
        [`${DIR}/big/SKILL.md`]: skillMd("big", "Big"),
        [`${DIR}/big/a.md`]: "a",
        [`${DIR}/big/b.md`]: "b",
        [`${DIR}/small/SKILL.md`]: skillMd("small", "Small"),
      },
      limits,
    );
    expect(result.items.map((item) => item.keyPath)).toEqual(["small"]);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["limit", "~/.agents/skills/big"],
    ]);
  });

  test("maxFileBytes를 넘는 파일이 있으면 too_large 진단이고 스킬 항목은 없다", async () => {
    const limits = { ...DEFAULT_SCAN_LIMITS, maxFileBytes: 64 };
    const result = await scanUser(
      {
        [`${DIR}/huge/SKILL.md`]: skillMd("huge", "d"),
        [`${DIR}/huge/assets/big.bin`]: new Uint8Array(100),
      },
      limits,
    );
    expect(result.items).toEqual([]);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["too_large", "~/.agents/skills/huge/assets/big.bin"],
    ]);
  });

  test("maxSkillBytes와 maxDepth를 넘어도 그 스킬만 빠진다", async () => {
    const bytesLimited = await scanUser(
      {
        [`${DIR}/heavy/SKILL.md`]: skillMd("heavy", "h"),
        [`${DIR}/heavy/data.bin`]: new Uint8Array(20),
      },
      { ...DEFAULT_SCAN_LIMITS, maxSkillBytes: 50 },
    );
    expect(bytesLimited.items).toEqual([]);
    expect(bytesLimited.diagnostics.map((item) => item.code)).toEqual(["limit"]);

    const depthLimited = await scanUser(
      {
        [`${DIR}/shallow/SKILL.md`]: skillMd("shallow", "s"),
        [`${DIR}/shallow/x/y.md`]: "y",
        [`${DIR}/deep/SKILL.md`]: skillMd("deep", "d"),
        [`${DIR}/deep/a/b/c.md`]: "c",
      },
      { ...DEFAULT_SCAN_LIMITS, maxDepth: 1 },
    );
    expect(depthLimited.items.map((item) => item.keyPath)).toEqual(["shallow"]);
    expect(depthLimited.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["limit", "~/.agents/skills/deep"],
    ]);
  });
});

describe("agent-skills: symlink", () => {
  test("하위 폴더 symlink는 따라가지 않고 unreadable 한 번, 나머지 스킬은 그대로", async () => {
    const result = await scanUser({
      [`${DIR}/linked`]: { symlinkTo: "/elsewhere/skill" },
      [`${DIR}/plain/SKILL.md`]: skillMd("plain", "Plain"),
    });
    expect(result.items.map((item) => item.keyPath)).toEqual(["plain"]);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["unreadable", "~/.agents/skills/linked"],
    ]);
  });

  test("SKILL.md가 symlink면 그 스킬을 건너뛴다", async () => {
    const result = await scanUser({
      [`${DIR}/mainlink/SKILL.md`]: { symlinkTo: "/elsewhere/SKILL.md" },
    });
    expect(result.items).toEqual([]);
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["unreadable", "~/.agents/skills/mainlink/SKILL.md"],
    ]);
  });

  test("스킬 안의 symlink 파일은 그 항목만 빠지고 진단이 난다(스킬은 남는다)", async () => {
    const result = await scanUser({
      [`${DIR}/withlink/SKILL.md`]: skillMd("withlink", "With link"),
      [`${DIR}/withlink/assets/ext`]: { symlinkTo: "/elsewhere/file" },
    });
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual([
      ["unreadable", "~/.agents/skills/withlink/assets/ext"],
    ]);
    expect(skillIrOf(single(result.items)).files.map((file) => file.path)).toEqual(["SKILL.md"]);
  });
});

describe("agent-skills: 결정성과 식별자", () => {
  test("같은 입력을 두 번 훑으면 결과가 같고, 내용이 바뀌어도 itemId는 같다", async () => {
    const original = {
      [`${DIR}/b-skill/SKILL.md`]: skillMd("b-skill", "B", "model: sonnet\n"),
      [`${DIR}/a-skill/SKILL.md`]: skillMd("a-skill", "A"),
      [`${DIR}/a-skill/scripts/run.sh`]: "echo 1\n",
    };
    const first = await scanUser(original);
    const second = await scanUser(original);
    expect(second).toEqual(first);

    const changed = await scanUser({
      [`${DIR}/b-skill/SKILL.md`]: skillMd("b-skill", "B changed", "model: sonnet\n"),
      [`${DIR}/a-skill/SKILL.md`]: skillMd("a-skill", "A"),
      [`${DIR}/a-skill/scripts/run.sh`]: "echo 2\n",
    });
    expect(changed.items.map((item) => item.itemId)).toEqual(
      first.items.map((item) => item.itemId),
    );
    const firstSkill = single(first.items.filter((item) => item.keyPath === "a-skill"));
    const changedSkill = single(changed.items.filter((item) => item.keyPath === "a-skill"));
    expect(changedSkill.sha256).not.toBe(firstSkill.sha256);
    expect(changedSkill.sha256).toHaveLength(64);
  });
});

describe("agent-skills: 어댑터 경로와 범위", () => {
  test("사용자 범위는 path가 ~/로 시작하고, 프로젝트 범위는 그 프로젝트 경로를 쓴다", async () => {
    const user = await agentSkillsAdapter.scan(
      { path: HOME, scope: "user", label: "user" },
      memoryFs({ [`${DIR}/deploy/SKILL.md`]: skillMd("deploy", "Deploy") }),
      DEFAULT_SCAN_LIMITS,
      ctx,
    );
    expect(user.scanned).toEqual(["~/.agents/skills"]);
    expect(single(user.items).path).toBe("~/.agents/skills/deploy");
    expect(single(user.items).scope).toBe("user");

    const project = await agentSkillsAdapter.scan(
      { path: "/work/app", scope: "project", label: "app" },
      memoryFs({ "/work/app/.agents/skills/lint/SKILL.md": skillMd("lint", "Lint") }),
      DEFAULT_SCAN_LIMITS,
      ctx,
    );
    expect(project.scanned).toEqual(["/work/app/.agents/skills"]);
    const projectItem = single(project.items);
    expect(projectItem.path).toBe("/work/app/.agents/skills/lint");
    expect(projectItem.scope).toBe("project");
    expect(projectItem.rootLabel).toBe("app");
  });

  test("폴더가 없으면 항목 0개이고 scanned에도 넣지 않는다", async () => {
    const result = await agentSkillsAdapter.scan(
      { path: HOME, scope: "user", label: "user" },
      memoryFs({ [`${HOME}/notes.txt`]: "x" }),
      DEFAULT_SCAN_LIMITS,
      ctx,
    );
    expect(result).toEqual({ items: [], diagnostics: [], scanned: [] });
  });
});

describe("agent-skills: 스킬이 아닌 것은 무시", () => {
  test("SKILL.md가 없는 폴더와 폴더가 아닌 항목은 항목도 진단도 없다", async () => {
    const result = await scanUser({
      [`${DIR}/notes/readme.md`]: "x",
      [`${DIR}/notes/sub/a.txt`]: "y",
      [`${DIR}/README.md`]: "top level file",
      [`${DIR}/weird/SKILL.md/inner.md`]: "a folder named SKILL.md",
    });
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.scanned).toEqual(["~/.agents/skills"]);
  });
});
