import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// L3.authoring.spec §4.5 `fresnel author <명령>`. 파서는 값으로 비교하고, 실행은 실제 호스트 위에서 모델 없이 돈다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

/** `author ls --json`이 낸 이름들(기본 플러그인도 사용자 위치에 설치돼 있어 같이 나온다) */
function namesOf(text: string): readonly string[] {
  const doc: unknown = JSON.parse(text);
  if (!Array.isArray(doc)) throw new Error("author ls --json is not an array");
  return doc.map((entry: unknown) =>
    typeof entry === "object" && entry !== null && "name" in entry ? String(entry.name) : "",
  );
}

test("author subcommands parse into their command values", () => {
  expect(parse(["author", "scaffold", "demo-ext", "--dir", "out"])).toEqual({
    kind: "author.scaffold",
    name: "demo-ext",
    dir: "out",
    extensionKind: "single-plugin",
    output: "text",
  });
  expect(parse(["author", "scaffold", "demo-ext", "--dir", "out", "--group", "--json"])).toEqual({
    kind: "author.scaffold",
    name: "demo-ext",
    dir: "out",
    extensionKind: "plugin-group",
    output: "json",
  });
  expect(parse(["author", "validate", "x"])).toEqual({
    kind: "author.validate",
    dir: "x",
    output: "text",
  });
  expect(parse(["author", "pack", "x", "--out", "y"])).toEqual({
    kind: "author.pack",
    dir: "x",
    out: "y",
    output: "text",
  });
  expect(parse(["author", "install", "x", "--yes"])).toEqual({
    kind: "author.install",
    dir: "x",
    yes: true,
    output: "text",
  });
  expect(parse(["author", "remove", "demo-ext", "--drop-data"])).toEqual({
    kind: "author.remove",
    name: "demo-ext",
    dropData: true,
    yes: false,
    output: "text",
  });
  expect(parse(["author", "ls", "--json"])).toEqual({ kind: "author.ls", output: "json" });
});

test("author usage mistakes are usage errors", () => {
  expect(parse(["author"])).toBe("missingArgument");
  expect(parse(["author", "publish"])).toBe("unknownCommand");
  expect(parse(["author", "validate"])).toBe("missingArgument");
  expect(parse(["author", "validate", "a", "b"])).toBe("unexpectedArgument");
  expect(parse(["author", "scaffold", "demo-ext"])).toBe("missingArgument");
  expect(parse(["author", "scaffold", "Bad Name", "--dir", "x"])).toBe("invalidGroupName");
  expect(parse(["author", "ls", "extra"])).toBe("unexpectedArgument");
});

test("scaffold, validate, pack, install, ls and remove run end to end without a model", async () => {
  const cli = createRealCli({ loadExtensions: true });
  clis.push(cli);
  const h = cli.harness;
  const clear = (): void => {
    h.stdout.length = 0;
    h.stderr.length = 0;
  };
  const dir = join(cli.home.work, "demo-ext");

  expect(await h.run(["author", "scaffold", "demo-ext", "--dir", "demo-ext", "--json"])).toBe(
    EXIT.ok,
  );
  const made: unknown = JSON.parse(h.stdoutText());
  expect(made).toMatchObject({ name: "demo-ext", kind: "single-plugin", dir });
  expect(existsSync(join(dir, ".fresnel-plugin", "plugin.json"))).toBe(true);

  clear();
  expect(await h.run(["author", "validate", "demo-ext"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain(`${dir}: 검사를 통과했다`);

  clear();
  expect(await h.run(["author", "pack", "demo-ext", "--json"])).toBe(EXIT.ok);
  const packed: unknown = JSON.parse(h.stdoutText());
  const packedPath = join(dir, "dist", "package");
  expect(packed).toMatchObject({ path: packedPath });
  expect(existsSync(join(packedPath, "dist", "index.js"))).toBe(true);

  // 터미널이 아니고 --yes도 없으면 거부한다(2). 아무것도 설치되지 않는다
  clear();
  h.useTerminal({ stdinIsTty: false, stdoutIsTty: false });
  expect(await h.run(["author", "install", packedPath])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("해결:");
  expect(await h.run(["author", "ls", "--json"])).toBe(EXIT.ok);
  expect(namesOf(h.stdoutText())).not.toContain("demo-ext");

  clear();
  expect(await h.run(["author", "install", packedPath, "--yes", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(h.stdoutText())).toMatchObject({
    name: "demo-ext",
    version: "0.1.0",
    location: join(cli.home.root, "config", "extensions", "demo-ext"),
  });

  clear();
  expect(await h.run(["author", "ls", "--json"])).toBe(EXIT.ok);
  expect(namesOf(h.stdoutText())).toContain("demo-ext");

  clear();
  expect(await h.run(["author", "remove", "demo-ext", "--yes"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("demo-ext을 지웠다\n");
  clear();
  expect(await h.run(["author", "ls", "--json"])).toBe(EXIT.ok);
  expect(namesOf(h.stdoutText())).not.toContain("demo-ext");
}, 120_000);

test("validate prints one line per issue with the path and code, and pack refuses a broken manifest", async () => {
  const cli = createRealCli();
  clis.push(cli);
  const h = cli.harness;
  expect(await h.run(["author", "scaffold", "demo-ext", "--dir", "demo-ext"])).toBe(EXIT.ok);
  const manifestPath = join(cli.home.work, "demo-ext", ".fresnel-plugin", "plugin.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null)
    throw new Error("manifest is not an object");
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, name: "Bad Name", version: 3 }));

  h.stdout.length = 0;
  h.stderr.length = 0;
  expect(await h.run(["author", "validate", "demo-ext"])).toBe(EXIT.error);
  const lines = h.stderrText().split("\n");
  expect(lines.some((line) => line.startsWith("  error ") && line.includes(" /name:"))).toBe(true);
  expect(lines.some((line) => line.startsWith("  error ") && line.includes(" /version:"))).toBe(
    true,
  );
  expect(h.stdoutText()).toBe("");

  h.stdout.length = 0;
  h.stderr.length = 0;
  expect(await h.run(["author", "pack", "demo-ext"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("검사 오류가 있어 묶지 않았다");
  expect(existsSync(join(cli.home.work, "demo-ext", "dist"))).toBe(false);
}, 120_000);
