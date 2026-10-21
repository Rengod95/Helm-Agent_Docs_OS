import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import {
  classifyFs,
  createMountProvider,
  createNoopFsKindProvider,
  createStatfsProvider,
  parseMountOutput,
  resolveFsKind,
  type FsKindProvider,
  type FsProbe,
} from "../src/fs-kind.ts";
import type { CommandOutput, RunCommand } from "../src/proc.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "" };
const WSL: OsInfo = { platform: "linux", arch: "x64", isWsl: true, release: "" };
const DARWIN: OsInfo = { platform: "darwin", arch: "arm64", isWsl: false, release: "" };
const WIN: OsInfo = { platform: "win32", arch: "x64", isWsl: false, release: "" };

const magic = (typeMagic: number, path?: string): FsProbe => ({
  typeMagic,
  typeName: undefined,
  ...(path === undefined ? {} : { path }),
});
const named = (typeName: string): FsProbe => ({ typeMagic: undefined, typeName });

describe("classifyFs", () => {
  test("Linux f_type 표", () => {
    expect(classifyFs(LINUX, magic(0xef53))).toBe("local"); // ext4
    expect(classifyFs(LINUX, magic(0x01021994))).toBe("local"); // tmpfs
    expect(classifyFs(LINUX, magic(0x9123683e))).toBe("local"); // btrfs
    expect(classifyFs(LINUX, magic(0x6969))).toBe("network"); // NFS
    expect(classifyFs(LINUX, magic(0xff534d42))).toBe("network"); // CIFS
    expect(classifyFs(LINUX, magic(0xfe534d42))).toBe("network"); // SMB2
    expect(classifyFs(LINUX, magic(0x517b))).toBe("network"); // SMB
    expect(classifyFs(LINUX, magic(0x65735546))).toBe("unknown"); // FUSE
    expect(classifyFs(LINUX, magic(0x12345678))).toBe("unknown");
    expect(classifyFs(LINUX, { typeMagic: undefined, typeName: undefined })).toBe("unknown");
  });

  test("WSL: 9p와 /mnt/<문자>/ 는 drvfs", () => {
    expect(classifyFs(WSL, magic(0x01021997))).toBe("drvfs");
    expect(classifyFs(WSL, magic(0xef53, "/mnt/c/Users/u"))).toBe("drvfs");
    expect(classifyFs(WSL, magic(0xef53, "/mnt/c"))).toBe("drvfs");
    expect(classifyFs(WSL, magic(0xef53, "/mnt/wsl/shared"))).toBe("local");
    expect(classifyFs(WSL, magic(0xef53, "/home/u"))).toBe("local");
  });

  test("WSL이 아니면 9p는 drvfs가 아니라 unknown", () => {
    expect(classifyFs(LINUX, magic(0x01021997))).toBe("unknown");
    expect(classifyFs(LINUX, magic(0xef53, "/mnt/c/x"))).toBe("local");
  });

  test("macOS fstypename 표", () => {
    expect(classifyFs(DARWIN, named("apfs"))).toBe("local");
    expect(classifyFs(DARWIN, named("hfs"))).toBe("local");
    expect(classifyFs(DARWIN, named("smbfs"))).toBe("network");
    expect(classifyFs(DARWIN, named("nfs"))).toBe("network");
    expect(classifyFs(DARWIN, named("afpfs"))).toBe("network");
    expect(classifyFs(DARWIN, named("webdav"))).toBe("network");
    expect(classifyFs(DARWIN, named("msdos"))).toBe("unknown");
    expect(classifyFs(DARWIN, { typeMagic: undefined, typeName: undefined })).toBe("unknown");
  });

  test("Windows는 2차라 unknown", () => {
    expect(classifyFs(WIN, named("ntfs"))).toBe("unknown");
  });
});

function tableProvider(table: Record<string, FsProbe>): FsKindProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    probe(path) {
      calls.push(path);
      const found = table[path];
      return Promise.resolve(found === undefined ? err({ kind: "not_found", path }) : ok(found));
    },
  };
}

describe("resolveFsKind", () => {
  const signal = new AbortController().signal;

  test("있는 경로는 바로 판정한다", async () => {
    const provider = tableProvider({ "/data/db": magic(0xef53) });
    expect(await resolveFsKind(LINUX, provider, "/data/db", signal)).toEqual(ok("local"));
    expect(provider.calls).toEqual(["/data/db"]);
  });

  test("없는 경로는 가장 가까운 상위 디렉터리로 판정한다", async () => {
    const provider = tableProvider({ "/data": magic(0x6969) });
    expect(await resolveFsKind(LINUX, provider, "/data/a/b/c.db", signal)).toEqual(ok("network"));
    expect(provider.calls).toEqual(["/data/a/b/c.db", "/data/a/b", "/data/a", "/data"]);
  });

  test("원래 경로로 drvfs 판정을 한다", async () => {
    const provider = tableProvider({ "/mnt/c": magic(0xef53) });
    expect(await resolveFsKind(WSL, provider, "/mnt/c/new/dir", signal)).toEqual(ok("drvfs"));
  });

  test("루트까지 없으면 not_found(원래 경로)", async () => {
    const provider = tableProvider({});
    expect(await resolveFsKind(LINUX, provider, "/no/such", signal)).toEqual(
      err({ kind: "not_found", path: "/no/such" }),
    );
  });

  test("io 오류는 그대로 돌려준다", async () => {
    const provider: FsKindProvider = {
      probe: (path) => Promise.resolve(err({ kind: "io", path, code: "EIO" })),
    };
    expect(await resolveFsKind(LINUX, provider, "/x", signal)).toEqual(
      err({ kind: "io", path: "/x", code: "EIO" }),
    );
  });

  test("중단 신호는 cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = tableProvider({ "/x": magic(0xef53) });
    expect(await resolveFsKind(LINUX, provider, "/x", controller.signal)).toEqual(
      err({ kind: "cancelled" }),
    );
    expect(provider.calls).toEqual([]);
  });
});

describe("statfs provider (실제 파일 시스템)", () => {
  test("이 기계의 루트는 값을 돌려주고 없는 경로는 not_found", async () => {
    const provider = createStatfsProvider();
    const signal = new AbortController().signal;
    const root = await provider.probe("/", signal);
    expect(root.ok).toBe(true);
    expect(await provider.probe("/no/such/path/xeon-test", signal)).toEqual(
      err({ kind: "not_found", path: "/no/such/path/xeon-test" }),
    );
  });
});

const MOUNT_OUTPUT = [
  "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
  "devfs on /dev (devfs, local, nobrowse)",
  "/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)",
  "//user@nas.local/share on /Volumes/share (smbfs, nodev, nosuid, mounted by user)",
  "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)",
  "nas:/export on /Volumes/My Disk (nfs, nodev, nosuid)",
  "this line is garbage",
  "",
].join("\n");

describe("macOS mount 출력", () => {
  test("parseMountOutput: 모르는 줄은 건너뛴다", () => {
    const entries = parseMountOutput(MOUNT_OUTPUT);
    expect(entries.map((e) => [e.mountPoint, e.typeName])).toEqual([
      ["/", "apfs"],
      ["/dev", "devfs"],
      ["/System/Volumes/Data", "apfs"],
      ["/Volumes/share", "smbfs"],
      ["/System/Volumes/Data/home", "autofs"],
      ["/Volumes/My Disk", "nfs"],
    ]);
  });

  test("createMountProvider: 가장 긴 접두사 마운트 지점으로 고르고 출력은 한 번만 읽는다", async () => {
    let runs = 0;
    const run: RunCommand = () => {
      runs += 1;
      const out: CommandOutput = { exitCode: 0, stdout: MOUNT_OUTPUT };
      return Promise.resolve(ok(out));
    };
    const provider = createMountProvider(run);
    const signal = new AbortController().signal;
    const kind = async (path: string): Promise<string> =>
      resolveFsKind(DARWIN, provider, path, signal).then((r) => (r.ok ? r.value : r.error.kind));
    expect(await kind("/Users/u/work")).toBe("local"); // "/" apfs
    expect(await kind("/Volumes/share/docs")).toBe("network"); // smbfs
    expect(await kind("/Volumes/My Disk/a")).toBe("network"); // nfs
    expect(await kind("/Volumes/shared-other")).toBe("local"); // 접두사가 같아도 경계가 다르면 "/"
    expect(await kind("/dev/null")).toBe("unknown"); // devfs
    expect(runs).toBe(1);
  });

  test("createMountProvider: mount 실행 실패는 io이고 캐시하지 않는다", async () => {
    let runs = 0;
    const run: RunCommand = () => {
      runs += 1;
      return Promise.resolve(
        runs === 1
          ? err({ kind: "spawn_failed", code: "ENOENT" })
          : ok({ exitCode: 0, stdout: MOUNT_OUTPUT }),
      );
    };
    const provider = createMountProvider(run);
    const signal = new AbortController().signal;
    const first = await provider.probe("/x", signal);
    expect(first).toEqual(err({ kind: "io", path: "/x", code: "spawn_failed" }));
    const second = await provider.probe("/x", signal);
    expect(second.ok).toBe(true);
  });
});

test("판정 수단이 없는 환경은 unknown", async () => {
  const provider = createNoopFsKindProvider();
  expect(await resolveFsKind(WIN, provider, "C:\\x", new AbortController().signal)).toEqual(
    ok("unknown"),
  );
});
