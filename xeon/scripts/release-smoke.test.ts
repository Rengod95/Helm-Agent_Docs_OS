import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { hostTriple } from "./build-sidecar.ts";

function hostTripleOrThrow(): string {
  const triple = hostTriple(process.platform, process.arch);
  if (!triple.ok) throw new Error(`unsupported host ${process.platform}/${process.arch}`);
  return triple.value;
}

// X11 (exit condition, B5-REL): the release smoke builds this machine's release archive and checks it. Linux x86_64 CI and the
// GitHub macOS arm64 job run the same script. The build compiles the sidecar, so it takes a while.
test("X11 the release archive of this machine builds and passes the smoke checks", async () => {
  const script = join(import.meta.dir, "release-smoke.sh");
  // The development sidecar (e2e tests and ensure-sidecar reuse it) must come out of the release build byte for byte as it went in.
  const dev = join(
    import.meta.dir,
    "..",
    "apps",
    "desktop",
    "src-tauri",
    "binaries",
    `xeon-${hostTripleOrThrow()}`,
  );
  const before = existsSync(dev) ? readFileSync(dev) : null;
  const child = Bun.spawn([script], {
    env: {
      ...process.env,
      XEON_RELEASE_OUT: join(import.meta.dir, "..", "dist", "release-smoke-x11"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exitCode, err: err.includes("FAIL") ? err : "" }).toEqual({ exitCode: 0, err: "" });
  expect(out).toContain("release-smoke: ok");
  const after = existsSync(dev) ? readFileSync(dev) : null;
  expect(after === null || before === null ? after === before : after.equals(before)).toBe(true);
}, 240_000);
