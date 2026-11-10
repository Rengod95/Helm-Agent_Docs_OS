import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { CommandIo, HostCommand } from "@fresnel/host";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// `service install [--yes]`, `service uninstall`(L4.cli.spec §3.1, §3.6). 호스트는 가짜다.
// 동의 없는 install은 호스트를 부르지 않고 종료 코드 3으로 끝난다. 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

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

function harnessFor(seen: HostCommand[], code: 0 | 1 = 0): Harness {
  const h = createHarness({ runHostCommand: recordingHost(seen, code) });
  harnesses.push(h);
  return h;
}

test("install without --yes exits 3 with the consent text and never calls the host", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen);
  expect(await h.run(["service", "install"])).toBe(EXIT.environment);
  expect(seen).toEqual([]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe(
    "fresnel: 로그인 자동 시작은 아직 등록되지 않았다. 등록하면 홈 폴더에 등록 파일을 쓰고 불러와서, 로그인할 때 서비스가 켜진다\n  해결: `fresnel service install --yes`로 다시 실행해 동의한다\n",
  );
});

test("the English consent text says the same thing", async () => {
  setActiveLocale("en");
  const seen: HostCommand[] = [];
  const h = harnessFor(seen);
  expect(await h.run(["service", "install", "--json"])).toBe(EXIT.environment);
  expect(seen).toEqual([]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe(
    "fresnel: Login auto-start is not registered. Registering it writes a launch file in your home folder and loads it, so the service starts at login\n  Fix: Run it again with --yes to confirm: fresnel service install --yes\n",
  );
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

test("a host failure on install is exit 1 and its text stays on stderr", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen, 1);
  expect(await h.run(["service", "install", "--yes"])).toBe(EXIT.error);
  expect(seen).toEqual([{ kind: "service-install" }]);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("autostart could not be installed (write)\n");
});

test("uninstall needs no --yes and asks the host for service-uninstall", async () => {
  const seen: HostCommand[] = [];
  const h = harnessFor(seen);
  expect(await h.run(["service", "uninstall"])).toBe(EXIT.ok);
  expect(seen).toEqual([{ kind: "service-uninstall" }]);
  expect(h.methods()).toEqual([]);
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
  const h = harnessFor(seen, 1);
  expect(await h.run(["service", "install", "--yes", "--json"])).toBe(EXIT.error);
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
