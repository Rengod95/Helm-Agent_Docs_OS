import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@xeon/client/i18n";
import { ok } from "@xeon/contracts";
import { describeSearch } from "../src/commands/doctor.ts";
import { EXIT } from "../src/exit-codes.ts";
import type { DoctorProbes } from "../src/io.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// secret, trust, db, doctor의 문장을 영어 로케일에서 전체 문자열로 비교한다. 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

const harnesses: Harness[] = [];
let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
  for (const harness of harnesses.splice(0)) harness.dispose();
});

test("secret ls with nothing registered says so and names the add command", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { handlers: { "secret.list": () => ({ secrets: [] }) } },
  });
  harnesses.push(h);
  expect(await h.run(["secret", "ls"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("No secrets are registered (xeon secret add <name>)\n");
});

test("trust against a host without trust methods gives the two-line failure in English", async () => {
  const h = createHarness({ env: { NO_COLOR: "1" }, server: { handlers: {} } });
  harnesses.push(h);
  expect(await h.run(["trust"])).toBe(EXIT.environment);
  expect(h.stderrText()).toBe(
    "xeon: The connected host does not support project trust decisions yet\n  Fix: Update the host, or edit the trust file (trust.json) by hand\n",
  );
});

test("db export without a data directory names the environment fix", async () => {
  const h = createHarness({ env: { NO_COLOR: "1" }, dataDir: null });
  harnesses.push(h);
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.environment);
  expect(h.stderrText()).toBe(
    "xeon: Could not determine the data directory location\n  Fix: Check HOME (USERPROFILE on Windows) and the XEON_HOME setting\n",
  );
});

test("db export warns about a skipped blob in English and still succeeds", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    exportDatabase: () =>
      Promise.resolve(
        ok({
          blobCount: 2,
          destDir: "/work/out",
          exportedAt: 1_767_571_200_000,
          missingBlobs: ["abc"],
        }),
      ),
  });
  harnesses.push(h);
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("Warning: a blob file is missing and was left out: abc\n");
});

test("doctor's search lines name the missing engine answer in English", async () => {
  const probes: DoctorProbes = { probeSearxng: () => Promise.resolve("ok") };
  expect(await describeSearch({ searxngUrl: "" }, probes, undefined, true)).toEqual({
    provider: "Search provider: unknown (the engine did not return the provider list)",
    searxng:
      "SearXNG: no address is set (it is not detected automatically) — to set one: xeon config set l2.web.search.searxng.url <address>",
    recommended: "Key plugins: unknown (the engine did not return the provider list)",
    assumedDefaults: true,
  });
});
