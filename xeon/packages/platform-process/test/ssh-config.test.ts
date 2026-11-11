import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSshConfig, readSshConfig } from "../src/index.ts";

// ssh config 읽기(ssh-config.ts). 정규 값을 값으로 비교한다. 파일 시험은 임시 홈 디렉터리에서 한다.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 홈을 만들고 `.ssh` 디렉터리를 준비한다 */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "xsshcfg-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".ssh"));
  return dir;
}

function sshFile(homeDir: string, name: string, text: string): void {
  const path = join(homeDir, ".ssh", name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("parseSshConfig", () => {
  test("a Host line with several names makes one entry per name, and wildcard names are dropped", () => {
    const entries = parseSshConfig(`
Host alpha beta
  HostName alpha.example
  User me
  Port 2222
Host *
  User everyone
Host gamma*
  HostName wrong
Host !delta
  HostName no
Host ?eps
  HostName no
`);
    const shared = {
      hostName: "alpha.example",
      user: "me",
      port: 2222,
      proxyJump: false,
    };
    expect(entries).toEqual([
      { name: "alpha", ...shared },
      { name: "beta", ...shared },
    ]);
  });

  test("keywords ignore case; Key value and Key=value both work; quoted values keep their spaces", () => {
    const entries = parseSshConfig(`
HOST upper
hostname UP.example
Host zeta
  Hostname=zeta.example
  port = 22
  proxyjump bastion
Host "quoted name"
  HostName "quoted.example"
`);
    expect(entries).toEqual([
      { name: "upper", hostName: "UP.example", user: null, port: null, proxyJump: false },
      { name: "zeta", hostName: "zeta.example", user: null, port: 22, proxyJump: true },
      { name: "quoted name", hostName: "quoted.example", user: null, port: null, proxyJump: false },
    ]);
  });

  test("full-line comments are ignored and do not start or end a block", () => {
    const entries = parseSshConfig(`# Host hidden
   # indented comment
Host shown
  # HostName not-this
  HostName shown.example
`);
    expect(entries).toEqual([
      { name: "shown", hostName: "shown.example", user: null, port: null, proxyJump: false },
    ]);
  });

  test("the first value of each keyword wins across blocks with the same name", () => {
    const entries = parseSshConfig(`
Host dup
  User first
Host dup
  User second
  HostName h2
`);
    expect(entries).toEqual([
      { name: "dup", hostName: "h2", user: "first", port: null, proxyJump: false },
    ]);
  });

  test("Match blocks are ignored, and a Host line after them starts a new context", () => {
    const entries = parseSshConfig(`
Host m1
  User one
Match host m1
  User ignored
  Port 1111
  HostName ignored.example
Host m2
  Port 2222
`);
    expect(entries).toEqual([
      { name: "m1", hostName: null, user: "one", port: null, proxyJump: false },
      { name: "m2", hostName: null, user: null, port: 2222, proxyJump: false },
    ]);
  });

  test("ProxyJump and ProxyCommand count as a jump host unless they say none", () => {
    const entries = parseSshConfig(`
Host by-jump
  ProxyJump bastion
Host by-command
  ProxyCommand ssh -W %h:%p bastion
Host none-jump
  ProxyJump none
Host none-command
  ProxyCommand none
`);
    expect(entries.map((entry) => [entry.name, entry.proxyJump])).toEqual([
      ["by-jump", true],
      ["by-command", true],
      ["none-jump", false],
      ["none-command", false],
    ]);
  });

  test("Port takes only integers from 1 to 65535; a bad value does not block a later good one", () => {
    const entries = parseSshConfig(`
Host ok-high
  Port 65535
Host ok-low
  Port 1
Host zero
  Port 0
Host too-big
  Port 70000
Host words
  Port abc
Host recovers
  Port 0
  Port 2200
`);
    expect(entries.map((entry) => [entry.name, entry.port])).toEqual([
      ["ok-high", 65535],
      ["ok-low", 1],
      ["zero", null],
      ["too-big", null],
      ["words", null],
      ["recovers", 2200],
    ]);
  });

  test("options before the first Host line apply to nothing and make no entry", () => {
    const entries = parseSshConfig(`User global
Host g
  HostName g.example
`);
    expect(entries).toEqual([
      { name: "g", hostName: "g.example", user: null, port: null, proxyJump: false },
    ]);
  });
});

describe("readSshConfig", () => {
  test("no config file is missing with no hosts", async () => {
    const dir = home();
    rmSync(join(dir, ".ssh"), { recursive: true });
    expect(await readSshConfig({ home: dir })).toEqual({ hosts: [], unreadable: "missing" });
  });

  test("a config that cannot be read (a directory here) is unreadable with no hosts", async () => {
    const dir = home();
    mkdirSync(join(dir, ".ssh", "config"));
    expect(await readSshConfig({ home: dir })).toEqual({ hosts: [], unreadable: "unreadable" });
  });

  test("Include merges the files in place, globs and ~ work, and relative paths are under ~/.ssh", async () => {
    const dir = home();
    sshFile(
      dir,
      "config",
      "Include ~/extra/*.conf\nInclude conf.d/*\nHost main\n  HostName main.example\n",
    );
    sshFile(dir, "../extra/a.conf", "Host a\n  User ua\n");
    sshFile(dir, "../extra/b.conf", "Host b\n");
    sshFile(dir, "conf.d/x", "Host x\n  Port 2001\n");
    sshFile(dir, "conf.d/.hidden", "Host hidden\n");
    const read = await readSshConfig({ home: dir });
    expect(read.unreadable).toBeNull();
    expect(read.hosts).toEqual([
      { name: "a", hostName: null, user: "ua", port: null, proxyJump: false },
      { name: "b", hostName: null, user: null, port: null, proxyJump: false },
      { name: "x", hostName: null, user: null, port: 2001, proxyJump: false },
      { name: "main", hostName: "main.example", user: null, port: null, proxyJump: false },
    ]);
  });

  test("an included file inside a Host block continues that block, as ssh does", async () => {
    const dir = home();
    sshFile(dir, "config", "Host main\n  HostName main.example\nInclude inner.conf\n");
    sshFile(dir, "inner.conf", "  User inner\n");
    const read = await readSshConfig({ home: dir });
    expect(read.hosts).toEqual([
      { name: "main", hostName: "main.example", user: "inner", port: null, proxyJump: false },
    ]);
  });

  test("an Include of a file that does not exist is skipped and reads as success", async () => {
    const dir = home();
    sshFile(dir, "config", "Include nope.conf\nHost k\n");
    expect(await readSshConfig({ home: dir })).toEqual({
      hosts: [{ name: "k", hostName: null, user: null, port: null, proxyJump: false }],
      unreadable: null,
    });
  });

  test("an Include that cannot be read makes the whole read unreadable with no hosts", async () => {
    const dir = home();
    sshFile(dir, "config", "Include bad.conf\nHost k\n");
    mkdirSync(join(dir, ".ssh", "bad.conf"));
    expect(await readSshConfig({ home: dir })).toEqual({ hosts: [], unreadable: "unreadable" });
  });

  test("a cyclic Include is read once per chain and terminates", async () => {
    const dir = home();
    sshFile(dir, "config", "Include a.conf\n");
    sshFile(dir, "a.conf", "Include b.conf\nHost a\n");
    sshFile(dir, "b.conf", "Include a.conf\nHost b\n");
    expect(await readSshConfig({ home: dir })).toEqual({
      hosts: [
        { name: "b", hostName: null, user: null, port: null, proxyJump: false },
        { name: "a", hostName: null, user: null, port: null, proxyJump: false },
      ],
      unreadable: null,
    });
  });

  test("Include nesting stops after depth 5: files 1 to 5 are read, file 6 is not", async () => {
    const dir = home();
    sshFile(dir, "config", "Include f1.conf\n");
    for (let level = 1; level <= 7; level += 1) {
      const next = level < 7 ? `Include f${String(level + 1)}.conf\n` : "";
      sshFile(dir, `f${String(level)}.conf`, `Host h${String(level)}\n${next}`);
    }
    const read = await readSshConfig({ home: dir });
    expect(read.hosts.map((host) => host.name)).toEqual(["h1", "h2", "h3", "h4", "h5"]);
  });
});
