import { expect, test } from "bun:test";
import { join } from "node:path";

// X11 (exit condition, B5-REL): the release smoke builds this machine's release archive and checks it. Linux x86_64 CI and the
// GitHub macOS arm64 job run the same script. The build compiles the sidecar, so it takes a while.
test("X11 the release archive of this machine builds and passes the smoke checks", async () => {
  const script = join(import.meta.dir, "release-smoke.sh");
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
}, 240_000);
