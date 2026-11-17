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

/** `author install --json`이 낸 초안 번호 */
function draftIdOf(text: string): string {
  const doc: unknown = JSON.parse(text);
  if (
    typeof doc === "object" &&
    doc !== null &&
    "draftId" in doc &&
    typeof doc.draftId === "string"
  )
    return doc.draftId;
  throw new Error("author install --json has no draftId");
}

/** `author install --json`이 낸 검토 항목 번호 */
function itemIdOf(text: string): string {
  const doc: unknown = JSON.parse(text);
  if (typeof doc === "object" && doc !== null && "itemId" in doc && typeof doc.itemId === "string")
    return doc.itemId;
  throw new Error("author install --json has no itemId");
}

test("author subcommands parse into their command values", () => {
  expect(parse(["author", "scaffold", "demo-ext", "--dir", "out"])).toEqual({
    kind: "author.scaffold",
    name: "demo-ext",
    dir: "out",
    extensionKind: "single-plugin",
    output: "text",
  });
  expect(parse(["author", "scaffold", "demo-ext", "--dir", "out", "--json"])).toEqual({
    kind: "author.scaffold",
    name: "demo-ext",
    dir: "out",
    extensionKind: "single-plugin",
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
  // 묶음 종류는 M5c-1에서 뺐다. 플래그가 없으니 알 수 없는 옵션이다
  expect(parse(["author", "scaffold", "demo-ext", "--dir", "out", "--group"])).toBe("unknownFlag");
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

  // 설치는 검토함을 거친다: 원본 폴더를 초안으로 만들고(`plugin.draft.create`) 그 초안을 검토 항목으로 보낸다(`pluginReview.submitDraft`).
  // 승인 전이라 목록에는 아직 없다
  clear();
  expect(await h.run(["author", "install", "demo-ext", "--json"])).toBe(EXIT.ok);
  const draftId = draftIdOf(h.stdoutText());
  expect(JSON.parse(h.stdoutText())).toMatchObject({ draftId, itemId: expect.any(String) });
  expect(cli.sent("plugin.draft.create").map((request) => request.params)).toEqual([{ dir }]);
  expect(cli.sent("pluginReview.submitDraft").map((request) => request.params)).toEqual([
    { draftId },
  ]);
  // 사람용 출력은 같은 항목 번호를 한 줄로 알리고 승인 전에는 쓸 수 없다고 한다
  const itemId = itemIdOf(h.stdoutText());
  clear();
  expect(await h.run(["author", "install", "demo-ext"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(`검토함에 올렸다(${itemId}). 검토함에서 승인해야 쓸 수 있다.\n`);
  clear();
  expect(await h.run(["author", "ls", "--json"])).toBe(EXIT.ok);
  expect(namesOf(h.stdoutText())).not.toContain("demo-ext");

  // 저장 데이터 지우기(`--drop-data`)는 대체가 없어 보내지 않고 not_available이다
  clear();
  expect(await h.run(["author", "remove", "demo-ext", "--drop-data", "--yes", "--json"])).toBe(
    EXIT.error,
  );
  expect(JSON.parse(h.stdoutText())).toEqual({
    kind: "not_available",
    command: "author.remove.dropData",
  });

  // 지우기 요청은 `plugin.requestRemove { name }`을 보낸다. 이 시험의 기기에는 기본 플러그인 `helm`이 등록돼 있지 않아
  // 호스트가 `extension.notFound`로 거절하고, 종료 코드는 1이다(성공 경로 `{ name, itemId }`는 호스트 시험이 본다)
  clear();
  expect(await h.run(["author", "remove", "helm", "--yes", "--json"])).toBe(EXIT.error);
  expect(cli.sent("plugin.requestRemove").map((request) => request.params)).toEqual([
    { name: "helm" },
  ]);
  expect(h.stderr.join("")).toContain("extension.notFound");
}, 120_000);

test("install sends no review submission when the draft cannot be made", async () => {
  const cli = createRealCli({ loadExtensions: true });
  clis.push(cli);
  const h = cli.harness;
  const missing = join(cli.home.work, "missing-folder");

  expect(await h.run(["author", "install", "missing-folder", "--json"])).toBe(EXIT.error);
  expect(cli.sent("plugin.draft.create").map((request) => request.params)).toEqual([
    { dir: missing },
  ]);
  expect(cli.sent("pluginReview.submitDraft")).toEqual([]);
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
