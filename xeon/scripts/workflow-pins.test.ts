import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// M3-30 regression (review.m3-plan M3-30): every action a Xeon workflow uses is pinned to a 40-hex commit SHA with its version
// in a comment (`uses: owner/repo@<sha> # v<version>`). Also the signing step's skip path (L4.release.spec §4): without the six
// Apple secrets release-sign.sh exits 0, says it skipped and never prints a value.

const REPO = join(import.meta.dir, "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const SIGN = join(import.meta.dir, "release-sign.sh");
const SECRETS = [
  "APPLE_CERTIFICATE_P12_BASE64",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "APPLE_APP_PASSWORD",
];

const USES = /^\s*-?\s*uses:\s*(\S+)(?:\s+#\s*(.*))?$/;

/** The `uses:` lines that are not pinned: a tag or a branch instead of a 40-hex SHA, or no `# v<version>` comment. */
function unpinnedUses(text: string): string[] {
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    const found = USES.exec(line);
    if (found === null) continue;
    const ref = found[1] ?? "";
    if (ref.startsWith("./")) continue;
    const pinned = /@[0-9a-f]{40}$/.test(ref);
    const comment = (found[2] ?? "").trim();
    if (!pinned || !/^v\d/.test(comment)) bad.push(line.trim());
  }
  return bad;
}

const read = (name: string): string => readFileSync(join(WORKFLOWS, name), "utf8");

test("every uses of every xeon-*.yml workflow is pinned to a 40-hex SHA with a version comment", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /^xeon-.*\.yml$/.test(name));
  const total = files.reduce(
    (count, name) =>
      count +
      read(name)
        .split("\n")
        .filter((line) => USES.test(line)).length,
    0,
  );
  expect(total > 0).toBe(true);
  const offenders = files.flatMap((name) =>
    unpinnedUses(read(name)).map((line) => `${name}: ${line}`),
  );
  expect(offenders).toEqual([]);
});

test("the pin check flags a tag, a branch and a missing comment, and skips a local action", () => {
  const sha = "11d5960a326750d5838078e36cf38b85af677262";
  const text = [
    "      - uses: actions/checkout@v4",
    "      - uses: jdx/mise-action@main # v2",
    `      - uses: actions/checkout@${sha}`,
    "      - uses: ./.github/actions/local",
    `      - uses: actions/checkout@${sha} # v4.4.0`,
  ].join("\n");
  expect(unpinnedUses(text)).toEqual([
    "- uses: actions/checkout@v4",
    "- uses: jdx/mise-action@main # v2",
    `- uses: actions/checkout@${sha}`,
  ]);
});

const signEnv = (extra: Readonly<Record<string, string>> = {}): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !SECRETS.includes(name)) env[name] = value;
  }
  return { ...env, ...extra };
};

const work = mkdtempSync(join(tmpdir(), "xeon-sign-skip-"));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

async function runSign(env: Record<string, string>): Promise<{
  readonly exitCode: number;
  readonly out: string;
  readonly err: string;
}> {
  const child = Bun.spawn(["bash", SIGN, work], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, out, err };
}

test("release-sign.sh with none of the six secrets exits 0 and says it skipped", async () => {
  const run = await runSign(signEnv());
  expect(run).toEqual({
    exitCode: 0,
    out: `release-sign: skipped, secrets not set: ${SECRETS.join(" ")}\n`,
    err: "",
  });
});

test("release-sign.sh with only APPLE_ID set still skips with exit 0 and never prints the value", async () => {
  const sentinel = "sentinel-apple-id-7f3a9c";
  const run = await runSign(signEnv({ APPLE_ID: sentinel }));
  const missing = SECRETS.filter((name) => name !== "APPLE_ID");
  expect({
    exitCode: run.exitCode,
    out: run.out,
    err: run.err,
    leaked: run.out.includes(sentinel) || run.err.includes(sentinel),
  }).toEqual({
    exitCode: 0,
    out: `release-sign: skipped, secrets not set: ${missing.join(" ")}\n`,
    err: "",
    leaked: false,
  });
});
