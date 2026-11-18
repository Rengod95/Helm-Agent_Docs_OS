import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { pathInCard, samePathAsOuter } from "../src/inherit-target.ts";
import { realPathEnv } from "./support/real-path-env.ts";

// U-11 경로 대조: 쓰려는 경로와 카드가 보여 준 경로를 작업 폴더 기준 실제 경로로 풀어 같은 실제 파일인지 본다.
// 실제 임시 폴더에 파일과 링크를 만들어 푼다.

let root = "";
let work = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "inherit-target-"));
  work = join(root, "work");
  mkdirSync(join(work, "sub"), { recursive: true });
  mkdirSync(join(root, "outside"));
  writeFileSync(join(work, "real.ts"), "one\n");
  writeFileSync(join(work, "other.ts"), "two\n");
  writeFileSync(join(work, "plain.txt"), "x\n");
  writeFileSync(join(work, "sub", "nested.ts"), "n\n");
  writeFileSync(join(root, "outside", "target.ts"), "t\n");
  symlinkSync("real.ts", join(work, "alias.ts"));
  symlinkSync("other.ts", join(work, "to-other.ts"));
  symlinkSync("gone.ts", join(work, "dangling.ts"));
  symlinkSync("sub", join(work, "dirlink"));
  symlinkSync(join(root, "outside", "target.ts"), join(work, "escape.ts"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const env = (): ReturnType<typeof realPathEnv> => realPathEnv(work);
const at = (path: string): JsonObject => ({ path });
const listed = (...paths: string[]): { readonly path: string }[] => paths.map((path) => ({ path }));

test("a path that does not exist yet passes when the card names the same path (the nearest existing parent is resolved)", async () => {
  expect(await pathInCard(env(), at("fresh/dir/new.ts"), listed("fresh/dir/new.ts"))).toBe(true);
});

test("a link to a file the card lists by its real name passes (the same real file)", async () => {
  expect(await pathInCard(env(), at("alias.ts"), listed("real.ts"))).toBe(true);
});

test("the real file does not pass when the card lists only a link to it, and passes once the card lists the real name too", async () => {
  expect(await pathInCard(env(), at("real.ts"), listed("alias.ts"))).toBe(false);
  expect(await pathInCard(env(), at("real.ts"), listed("alias.ts", "real.ts"))).toBe(true);
});

test("a link to a file the card does not list does not pass", async () => {
  expect(await pathInCard(env(), at("to-other.ts"), listed("real.ts"))).toBe(false);
  expect(await pathInCard(env(), at("to-other.ts"), listed("real.ts", "other.ts"))).toBe(true);
});

test("a dangling link does not pass: its target cannot be known", async () => {
  expect(await pathInCard(env(), at("dangling.ts"), listed("dangling.ts"))).toBe(false);
});

test("a path under a regular file (no existing parent directory) does not pass", async () => {
  expect(await pathInCard(env(), at("plain.txt/x.ts"), listed("plain.txt/x.ts"))).toBe(false);
});

test("a path that leaves the work folder does not pass, even when the card names the same path", async () => {
  expect(await pathInCard(env(), at("../outside/target.ts"), listed("../outside/target.ts"))).toBe(
    false,
  );
  // 링크가 작업 폴더 밖을 가리키면 같은 이름이라도 아니다
  expect(await pathInCard(env(), at("escape.ts"), listed("escape.ts"))).toBe(false);
});

test("a dot-dot path that stays inside the work folder resolves and passes", async () => {
  expect(await pathInCard(env(), at("sub/../real.ts"), listed("real.ts"))).toBe(true);
});

test("a dot-dot after a missing directory does not pass: the OS would not resolve it the way the text reads", async () => {
  expect(await pathInCard(env(), at("missing/../real.ts"), listed("real.ts"))).toBe(false);
});

test("a dot-dot after a link does not pass: the OS climbs from the link's target, not from the link", async () => {
  expect(await pathInCard(env(), at("dirlink/../real.ts"), listed("real.ts"))).toBe(false);
});

test("a write through a directory link to the same file passes when the card lists the real name", async () => {
  expect(await pathInCard(env(), at("dirlink/nested.ts"), listed("sub/nested.ts"))).toBe(true);
  // 카드가 디렉터리 링크를 거쳐 보여 준 이름은 실제 이름이 아니므로 맞지 않는다
  expect(await pathInCard(env(), at("sub/nested.ts"), listed("dirlink/nested.ts"))).toBe(false);
});

test("an empty, missing, or non-string path never passes, and the work folder itself is not a target", async () => {
  expect(await pathInCard(env(), at(""), listed(""))).toBe(false);
  expect(await pathInCard(env(), {}, listed("real.ts"))).toBe(false);
  expect(await pathInCard(env(), { path: 3 }, listed("real.ts"))).toBe(false);
  expect(await pathInCard(env(), at("."), listed("."))).toBe(false);
});

test("the outer tool call's path decides the inner write the same way, and a link on the outer side does not pass", async () => {
  expect(await samePathAsOuter(env(), at("alias.ts"), at("real.ts"))).toBe(true);
  expect(await samePathAsOuter(env(), at("real.ts"), at("alias.ts"))).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), {})).toBe(false);
  expect(await samePathAsOuter(env(), {}, at("real.ts"))).toBe(false);
});

test("an outer call that shows a list of paths lets an inner write to any listed file pass, and a path outside the list does not (AGE-27)", async () => {
  const patch: JsonObject = { paths: ["real.ts", "sub/nested.ts"] };
  expect(await samePathAsOuter(env(), at("real.ts"), patch)).toBe(true);
  expect(await samePathAsOuter(env(), at("./sub/nested.ts"), patch)).toBe(true);
  expect(await samePathAsOuter(env(), at("other.ts"), patch)).toBe(false);
  expect(await samePathAsOuter(env(), at("new-file.ts"), patch)).toBe(false);
  // `files: [{ path }]` 모양과 `path`·`paths` 혼합도 같은 목록이다
  const files: JsonObject = { files: [{ path: "real.ts" }, { path: "other.ts", op: "update" }] };
  expect(await samePathAsOuter(env(), at("other.ts"), files)).toBe(true);
  expect(await samePathAsOuter(env(), at("plain.txt"), files)).toBe(false);
  const mixed: JsonObject = { path: "real.ts", paths: ["other.ts"] };
  expect(await samePathAsOuter(env(), at("other.ts"), mixed)).toBe(true);
});

test("a path set is normalized like a single path: links, dot-dot, and the work folder boundary behave the same", async () => {
  // 목록에 링크 이름만 있으면 실제 파일은 통과하지 않고, 링크 이름은 실제 파일을 가리켜 통과한다
  expect(await samePathAsOuter(env(), at("real.ts"), { paths: ["alias.ts", "other.ts"] })).toBe(
    false,
  );
  expect(await samePathAsOuter(env(), at("alias.ts"), { paths: ["real.ts", "other.ts"] })).toBe(
    true,
  );
  // 목록 밖 파일을 가리키는 링크, 끊긴 링크, 작업 폴더 밖, 안전하지 않은 `..`는 통과하지 않는다
  expect(await samePathAsOuter(env(), at("to-other.ts"), { paths: ["real.ts"] })).toBe(false);
  expect(await samePathAsOuter(env(), at("dangling.ts"), { paths: ["dangling.ts"] })).toBe(false);
  expect(await samePathAsOuter(env(), at("escape.ts"), { paths: ["escape.ts"] })).toBe(false);
  expect(await samePathAsOuter(env(), at("x/../real.ts"), { paths: ["real.ts"] })).toBe(false);
  expect(await samePathAsOuter(env(), at("sub/../real.ts"), { paths: ["real.ts"] })).toBe(true);
});

test("an outer call with no path, an empty list, or a malformed list shows nothing to inherit from (shell wrappers included)", async () => {
  expect(await samePathAsOuter(env(), at("real.ts"), { command: "echo real.ts" })).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), { paths: [] })).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), { paths: "real.ts" })).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), { paths: ["real.ts", 3] })).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), { files: [{ file: "real.ts" }] })).toBe(false);
  expect(await samePathAsOuter(env(), at("real.ts"), { files: "real.ts" })).toBe(false);
});
