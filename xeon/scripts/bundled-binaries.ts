#!/usr/bin/env bun
// 묶은 앱(Resources)에 넣을 외부 바이너리 sops와 age를 모은다(L0.os.spec §3.6 OS-11·OS-12, L4.desktop.spec §11.7).
//   bundled-binaries --out <dir>
// <dir>/binaries/{sops,age}, <dir>/binaries.lock.json, <dir>/licenses/ 를 만든다. 바이너리는 빌드하는 기계에 이미 있는 것을 복사한다
// (env FRESNEL_BINARIES_DIR, mise 설치 폴더, PATH 순). 새로 내려받지 않는다: 릴리스에서 공식 배포본을 내려받아 검증해 넣는 일은 사용자 승인 뒤의 일이다.
// 이 파일은 워크스페이스 패키지를 import하지 않는다(eng.dependency-rules.guide §1).
// 종료코드: 0 만듦, 2 빌드 기계에 도구가 없거나 버전을 읽을 수 없음(환경 문제).
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  BUNDLED_TOOLS,
  PINNED_VERSIONS,
  relockText,
  bundledPath,
  findOnBuildMachine,
  lockText,
  missingToolMessage,
  sha256Of,
  versionOfOutput,
  type LockRow,
} from "./bundled-binaries-lib.ts";

const { values } = parseArgs({
  options: { out: { type: "string" }, relock: { type: "string" } },
});

// --relock <Resources>: 서명(scripts/electron-sign.sh)이 Mach-O를 다시 쓰면 해시가 바뀌므로, 서명 뒤 lock의 sha256을 파일에 맞춰 다시 쓴다.
// 해석기는 실행 직전에 이 해시를 맞춰 보므로 이 단계가 없으면 서명한 앱의 번들이 integrity_mismatch가 된다.
if (values.relock !== undefined) {
  const lockFile = path.join(path.resolve(values.relock), "binaries.lock.json");
  const next = relockText(readFileSync(lockFile, "utf8"), (rel) =>
    sha256Of(readFileSync(path.join(path.resolve(values.relock ?? ""), rel))),
  );
  if (next === null) {
    process.stderr.write(`bundled-binaries: ${lockFile} is not a valid lock file\n`);
    process.exit(1);
  }
  writeFileSync(lockFile, next);
  process.stderr.write("bundled-binaries: lock hashes rewritten after signing\n");
  process.exit(0);
}

const out = values.out === undefined ? undefined : path.resolve(values.out);
if (out === undefined) {
  process.stderr.write("usage: bundled-binaries --out <dir>\n");
  process.exit(2);
}
const licenseSource = path.join(
  import.meta.dirname,
  "..",
  "apps",
  "desktop-shell",
  "resources",
  "licenses",
);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "binaries"), { recursive: true });
mkdirSync(path.join(out, "licenses"), { recursive: true });

const rows: LockRow[] = [];
for (const tool of BUNDLED_TOOLS) {
  const wanted = PINNED_VERSIONS[tool];
  const found = findOnBuildMachine({
    tool,
    binariesDir: process.env["FRESNEL_BINARIES_DIR"],
    home: process.env["HOME"],
    pathEnv: process.env["PATH"],
    wantVersion: wanted,
  });
  if (found === null) {
    process.stderr.write(`${missingToolMessage(tool, wanted)}\n`);
    process.exit(2);
  }
  const probe = Bun.spawnSync(
    [found.path, ...(tool === "sops" ? ["--disable-version-check"] : []), "--version"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const got = versionOfOutput(probe.stdout.toString());
  if (probe.exitCode !== 0 || got === null) {
    process.stderr.write(`bundled-binaries: cannot read the version of ${found.path}\n`);
    process.exit(2);
  }
  if (got !== wanted) {
    process.stderr.write(
      `bundled-binaries: warning: ${tool} ${got} (from ${found.via}) differs from the pinned ${wanted}; the lock records ${got}\n`,
    );
  }
  const target = path.join(out, "binaries", tool);
  copyFileSync(found.path, target);
  chmodSync(target, 0o755);
  rows.push({
    name: tool,
    platform: "darwin",
    arch: "arm64",
    path: bundledPath(tool),
    sha256: sha256Of(readFileSync(target)),
    version: got,
  });
  process.stderr.write(`bundled-binaries: ${tool} ${got} from ${found.via}\n`);
}
writeFileSync(path.join(out, "binaries.lock.json"), lockText(rows));

// 재배포 고지: age(BSD-3-Clause)는 저작권 고지와 조건을, sops(MPL-2.0)는 라이선스 전문과 소스 위치를 싣는다
for (const name of ["LICENSE.sops-MPL-2.0.txt", "LICENSE.age-BSD-3-Clause.txt"]) {
  copyFileSync(path.join(licenseSource, name), path.join(out, "licenses", name));
}
const versionOf = (tool: string): string => rows.find((r) => r.name === tool)?.version ?? "";
writeFileSync(
  path.join(out, "licenses", "BUNDLED-BINARIES.txt"),
  [
    "Fresnel bundles two unmodified third-party programs in Resources/binaries/ (binaries.lock.json lists versions and SHA-256).",
    "",
    `sops ${versionOf("sops")}  MPL-2.0  Source Code Form: https://github.com/getsops/sops (the tag of this version). License text: LICENSE.sops-MPL-2.0.txt`,
    `age ${versionOf("age")}  BSD-3-Clause  https://github.com/FiloSottile/age  License text: LICENSE.age-BSD-3-Clause.txt`,
    "",
    "The programs are not modified. The MPL-2.0 source of sops is available from the link above.",
    "",
  ].join("\n"),
);
