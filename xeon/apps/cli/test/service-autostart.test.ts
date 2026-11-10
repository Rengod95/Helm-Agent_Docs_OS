import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { CommandIo, HostCommand } from "@fresnel/host";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// `service install [--yes]`, `service uninstall`(L4.cli.spec §3.1, §3.6). 호스트는 가짜다.
// install은 `--yes`가 있거나 터미널에서 y로 답했을 때만 호스트를 부른다. 터미널이 아니면 2, y가 아니면 1이다.
// 호스트가 등록·해제에 실패하면(launchctl·systemctl 없음 또는 실패, 입출력) 환경 문제 3이다.
// 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

const harnesses: Harness[] = [];
let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
});

afterEach(() => {
  setActiveLocale(before);
  for (const harness of harnesses.splice(0)) harness.dispose();
});

async function say(stream: WritableStream<Uint8Array>, text: string): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(new TextEncoder().encode(text));
  writer.releaseLock();
}

/** 호스트 가짜. 성공하면 stdout에 한 줄, 실패하면 stderr에 한 줄을 쓴다(호스트의 실제 모양) */
function recordingHost(seen: HostCommand[], code: 0 | 1 = 0) {
  return async (command: HostCommand, io: CommandIo): Promise<0 | 1> => {
    seen.push(command);
    if (code === 0) {
      await say(
        io.stdout,
        "autostart installed (/Users/u/Library/LaunchAgents/com.fresnel.service.plist)\n",
      );
    } else {
      await say(io.stderr, "autostart could not be installed (write)\n");
    }
    return code;
  };
}

interface Setup {
  /** 호스트가 돌려줄 종료 코드(실패 시험은 1) */
  readonly code?: 0 | 1;
  /** 참이면 터미널이다(확인 질문을 묻는다) */
  readonly tty?: boolean;
  /** 확인 질문에 준 답. null이면 입력이 끝났다 */
  readonly answer?: string | null;
  /** 확인 질문이 나온 기록 */
  readonly prompts?: string[];
}

function harnessFor(seen: HostCommand[], setup: Setup = {}): Harness {
  const prompts = setup.prompts ?? [];
  const h = createHarness({
    runHostCommand: recordingHost(seen, setup.code ?? 0),
    terminal: { stdinIsTty: setup.tty ?? false },
    readLine: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(setup.answer ?? null);
    },
  });
  harnesses.push(h);
  return h;
}

test("install without --yes and without a terminal is a usage error (2): no prompt, no host call, nothing written", async () => {
  const seen: HostCommand[] = [];
  const prompts: string[] = [];
  const h = harnessFor(seen, { prompts });
  expect(await h.run(["service", "install"])).toBe(EXIT.usage);
  expect(seen).toEqual([]);
  expect(prompts).toEqual([]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe(
    "fresnel: 터미널이 아니라서 등록을 확인할 수 없다\n  해결: `fresnel service install --yes`로 다시 실행해 동의한다\n",
  );
});

test("the English usage error says the same thing", async () => {
  setActiveLocale("en");
  const seen: HostCommand[] = [];
  const h = harnessFor(seen);
  expect(await h.run(["service", "install", "--json"])).toBe(EXIT.usage);
  expect(seen).toEqual([]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe(
    "fresnel: Registration cannot be confirmed because this is not a terminal\n  Fix: Run it again with --yes to confirm: fresnel service install --yes\n",
  );
});

test("in a terminal, install asks [y/N] and registers on y", async () => {
  const seen: HostCommand[] = [];
  const prompts: string[] = [];
  const h = harnessFor(seen, { tty: true, answer: "y", prompts });
  expect(await h.run(["service", "install"])).toBe(EXIT.ok);
  expect(prompts).toEqual([
    "로그인 자동 시작을 등록할까요? 홈 폴더에 등록 파일을 쓰고 불러와서, 로그인할 때 서비스가 켜진다 [y/N] ",
  ]);
  expect(seen).toEqual([{ kind: "service-install" }]);
  expect(h.stdoutText()).toBe(
    "autostart installed (/Users/u/Library/LaunchAgents/com.fresnel.service.plist)\n",
  );
  expect(h.stderrText()).toBe("");
});

test("in a terminal, any answer other than y writes nothing and exits 1", async () => {
  const answers: readonly (string | null)[] = ["n", "", "no", null];
  const results = await Promise.all(
    answers.map(async (answer) => {
      const seen: HostCommand[] = [];
      const h = harnessFor(seen, { tty: true, answer });
      const code = await h.run(["service", "install"]);
      return { code, seen, stdout: h.stdoutText(), stderr: h.stderrText() };
    }),
  );
  expect(results).toEqual(
    answers.map(() => ({
      code: EXIT.error,
      seen: [],
      stdout: "",
      stderr: "등록하지 않았다 (아무것도 바꾸지 않았다)\n",
    })),
  );
});

test("the English decline says the same thing", async () => {
  setActiveLocale("en");
  const seen: HostCommand[] = [];
  const h = harnessFor(seen, { tty: true, answer: "n" });
  expect(await h.run(["service", "install"])).toBe(EXIT.error);
  expect(seen).toEqual([]);
  expect(h.stderrText()).toBe("Not registered (nothing was changed)\n");
});

test("install --yes asks the host for service-install and passes its text through", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen);
  expect(await h.run(["service", "install", "--yes"])).toBe(EXIT.ok);
  expect(seen).toEqual([{ kind: "service-install" }]);
  expect(h.stdoutText()).toBe(
    "autostart installed (/Users/u/Library/LaunchAgents/com.fresnel.service.plist)\n",
  );
  expect(h.stderrText()).toBe("");
  expect(h.methods()).toEqual([]);
});

test("install --yes skips the question even in a terminal", async () => {
  const seen: HostCommand[] = [];
  const prompts: string[] = [];
  const h = harnessFor(seen, { tty: true, answer: "n", prompts });
  expect(await h.run(["service", "install", "--yes"])).toBe(EXIT.ok);
  expect(prompts).toEqual([]);
  expect(seen).toEqual([{ kind: "service-install" }]);
});

test("a host failure on install is an environment problem (3) and its text stays on stderr", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen, { code: 1 });
  expect(await h.run(["service", "install", "--yes"])).toBe(EXIT.environment);
  expect(seen).toEqual([{ kind: "service-install" }]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("autostart could not be installed (write)\n");
});

test("uninstall needs no --yes, never asks, and asks the host for service-uninstall", async () => {
  const seen: HostCommand[] = [];
  const prompts: string[] = [];
  const h = harnessFor(seen, { tty: true, answer: "n", prompts });
  expect(await h.run(["service", "uninstall"])).toBe(EXIT.ok);
  expect(prompts).toEqual([]);
  expect(seen).toEqual([{ kind: "service-uninstall" }]);
  expect(h.methods()).toEqual([]);
});

test("a host failure on uninstall is an environment problem (3)", async () => {
  const seen: HostCommand[] = [];
  const broken = createHarness({
    runHostCommand: async (command: HostCommand, io: CommandIo): Promise<1> => {
      seen.push(command);
      await say(io.stderr, "autostart could not be removed (remove_failed)\n");
      return 1;
    },
  });
  harnesses.push(broken);
  expect(await broken.run(["service", "uninstall"])).toBe(EXIT.environment);
  expect(seen).toEqual([{ kind: "service-uninstall" }]);
  expect(broken.stderrText()).toBe("autostart could not be removed (remove_failed)\n");
});

test("--json on install or uninstall writes one JSON line and drops the host text", async () => {
  const installed: HostCommand[] = [];
  const install = harnessFor(installed);
  expect(await install.run(["service", "install", "--yes", "--json"])).toBe(EXIT.ok);
  expect(install.stdoutText()).toBe('{"ok":true,"action":"install"}\n');
  expect(installed).toEqual([{ kind: "service-install" }]);

  const removed: HostCommand[] = [];
  const uninstall = harnessFor(removed);
  expect(await uninstall.run(["service", "uninstall", "--json"])).toBe(EXIT.ok);
  expect(uninstall.stdoutText()).toBe('{"ok":true,"action":"uninstall"}\n');
  expect(removed).toEqual([{ kind: "service-uninstall" }]);
});

test("--json with a failed install writes no JSON and keeps the host's stderr", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen, { code: 1 });
  expect(await h.run(["service", "install", "--yes", "--json"])).toBe(EXIT.environment);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("autostart could not be installed (write)\n");
});

test("--yes is a usage error for every other service action, and the host is not called", async () => {
  const cases: readonly (readonly string[])[] = [
    ["service", "start", "--yes"],
    ["service", "stop", "--yes"],
    ["service", "status", "--yes"],
    ["service", "ensure", "--yes"],
    ["service", "pair", "--yes"],
    ["service", "uninstall", "--yes"],
  ];
  const seen: HostCommand[] = [];
  const codes = await Promise.all(cases.map((argv) => harnessFor(seen).run(argv)));
  expect(codes).toEqual(cases.map(() => EXIT.usage));
  expect(seen).toEqual([]);
});

test("install and uninstall reject the flags that start a service and extra arguments", async () => {
  const cases: readonly (readonly string[])[] = [
    ["service", "install", "--safe-mode", "--yes"],
    ["service", "install", "--listen-tcp", "127.0.0.1:7777", "--yes"],
    ["service", "install", "--allow-non-loopback", "--yes"],
    ["service", "uninstall", "--safe-mode"],
    ["service", "uninstall", "extra"],
  ];
  const seen: HostCommand[] = [];
  const codes = await Promise.all(cases.map((argv) => harnessFor(seen).run(argv)));
  expect(codes).toEqual(cases.map(() => EXIT.usage));
  expect(seen).toEqual([]);
});

test("the help lists install with --yes and uninstall", async () => {
  const h = createHarness();
  harnesses.push(h);
  expect(await h.run(["--help"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("service install [--yes]");
  expect(h.stdoutText()).toContain("service uninstall");
  expect(h.methods()).toEqual([]);
});
