import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, err } from "@fresnel/contracts";
import { probePython, type RunCommandSync } from "../../src/assembly/python-runtime.ts";

// `python3` 실행기의 읽기 경로 해석(AGE-58 마무리). 인터프리터가 답하는 네 줄(실행 파일, base_prefix, base_exec_prefix, prefix)로 정한다.

const root = realpathSync(mkdtempSync(join(tmpdir(), "python-runtime-")));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function answering(lines: readonly string[]): RunCommandSync {
  return () => ok({ exitCode: 0, stdout: `${lines.join("\n")}\n` });
}

test("a shim resolves to the real interpreter and its install prefix, nothing wider", () => {
  const prefix = join(root, "installs", "3.13");
  mkdirSync(join(prefix, "bin"), { recursive: true });
  const exe = join(prefix, "bin", "python3");
  writeFileSync(exe, "");
  const asked: (readonly string[])[] = [];
  const run: RunCommandSync = (argv) => {
    asked.push(argv);
    return answering([exe, prefix, prefix, prefix])(argv);
  };
  expect(probePython("/shims/python3", run)).toEqual({ command: exe, readRoots: [prefix] });
  // 고정 인자로 한 번 묻는다: 격리 모드(`-I`), site 없음(`-S`)
  expect(asked).toEqual([["/shims/python3", "-I", "-S", "-c", expect.any(String)]]);
});

test("a virtual environment keeps its own interpreter path and opens only pyvenv.cfg beyond the base install", () => {
  const base = join(root, "base");
  const venv = join(root, "venv");
  mkdirSync(base, { recursive: true });
  mkdirSync(join(venv, "bin"), { recursive: true });
  writeFileSync(join(venv, "pyvenv.cfg"), "home = x\n");
  const exe = join(venv, "bin", "python3");
  writeFileSync(exe, "");
  expect(probePython("/p", answering([exe, base, base, venv]))).toEqual({
    command: exe,
    readRoots: [base, join(venv, "pyvenv.cfg")],
  });
});

test("an interpreter that fails, answers nothing usable, or names a shallow or missing prefix is unavailable", () => {
  expect(probePython("/p", () => err({ kind: "timeout" }))).toBeUndefined();
  expect(probePython("/p", () => ok({ exitCode: 1, stdout: "" }))).toBeUndefined();
  expect(probePython("/p", answering(["python3", "/x", "/x", "/x"]))).toBeUndefined();
  expect(probePython("/p", answering(["/bin/python3", "/", "/", "/"]))).toBeUndefined();
  expect(
    probePython("/p", answering(["/bin/python3", join(root, "nope"), join(root, "nope"), "/"])),
  ).toBeUndefined();
});

test("a prefix that is the home folder or contains it is refused, a folder under home is fine", () => {
  const home = join(root, "home", "me");
  const install = join(home, ".local", "python");
  mkdirSync(join(install, "bin"), { recursive: true });
  const exe = join(install, "bin", "python3");
  writeFileSync(exe, "");
  // 홈 자체가 접두 폴더(`--prefix=$HOME`)면 홈 전체가 읽기로 열리므로 거절한다
  expect(probePython("/p", answering([exe, home, home, home]), home)).toBeUndefined();
  // 홈을 품는 폴더도 거절한다
  expect(
    probePython(
      "/p",
      answering([exe, join(root, "home"), join(root, "home"), join(root, "home")]),
      home,
    ),
  ).toBeUndefined();
  // 홈 아래의 설치 폴더는 그 폴더만 연다
  expect(probePython("/p", answering([exe, install, install, install]), home)).toEqual({
    command: exe,
    readRoots: [install],
  });
});
