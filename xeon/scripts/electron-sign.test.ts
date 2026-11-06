import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// electron-sign.sh (L4.release.spec §4.2) without the Apple secrets: UNSIGNED with exit 0 outside a release tag, exit 1 on a
// v* tag, no value printed. The signing path itself needs the user's secrets and runs on the Mac (`just desktop-sign-electron`).

const SIGN = join(import.meta.dir, "electron-sign.sh");
const SECRETS = [
  "APPLE_CERTIFICATE_P12_BASE64",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "APPLE_APP_PASSWORD",
];
const CI_VARS = new Set(["GITHUB_ACTIONS", "GITHUB_REF", "GITHUB_STEP_SUMMARY"]);

const work = mkdtempSync(join(tmpdir(), "fresnel-electron-sign-"));
const app = join(work, "Fresnel.app");
mkdirSync(join(app, "Contents"), { recursive: true });
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function envOf(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !SECRETS.includes(name) && !CI_VARS.has(name)) env[name] = value;
  }
  return { ...env, ...extra };
}

async function run(args: readonly string[], env: Record<string, string>) {
  const child = Bun.spawn(["bash", SIGN, ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, out, err };
}

test("without the secrets it says UNSIGNED, names every missing secret and exits 0", async () => {
  expect(await run([app], envOf())).toEqual({
    exitCode: 0,
    out: `electron-sign: UNSIGNED, secrets not set: ${SECRETS.join(" ")}\n`,
    err: "",
  });
});

test("with one secret set it never prints the value", async () => {
  const sentinel = "sentinel-team-id-5b1e";
  const result = await run([app], envOf({ APPLE_TEAM_ID: sentinel }));
  expect(result.exitCode).toBe(0);
  expect(result.out).toBe(
    `electron-sign: UNSIGNED, secrets not set: ${SECRETS.filter((name) => name !== "APPLE_TEAM_ID").join(" ")}\n`,
  );
  expect(result.out.includes(sentinel) || result.err.includes(sentinel)).toBe(false);
});

test("on a v* tag UNSIGNED fails with exit 1", async () => {
  const result = await run([app], envOf({ GITHUB_REF: "refs/tags/v1.2.3" }));
  expect(result.exitCode).toBe(1);
  expect(result.err).toBe(
    "electron-sign: a release tag must be signed; register the secrets and run the release again\n",
  );
});

test("in CI it adds a warning annotation", async () => {
  const result = await run([app], envOf({ GITHUB_ACTIONS: "true" }));
  expect(result.exitCode).toBe(0);
  expect(result.out).toContain("::warning title=UNSIGNED macOS app::electron-sign: UNSIGNED");
});

test("--adhoc is refused on a v* tag, and a missing app is an environment error", async () => {
  const tagged = await run(["--adhoc", app], envOf({ GITHUB_REF: "refs/tags/v1.2.3" }));
  expect(tagged.exitCode).toBe(1);
  expect(tagged.err).toContain("--adhoc is not a release");
  const missing = await run([join(work, "none.app")], envOf());
  expect(missing.exitCode).toBe(2);
});
