import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// G2-07, H1: 실제 호스트 위의 `xeon doctor`. test/doctor.test.ts의 가짜 host.status·settings.get 대신 실제 처리기가 외부 바이너리를 점검하고
// 실제 설정 카탈로그가 검색 설정을 알려 준다. 이 기기에 어떤 바이너리가 있는지에 상관없이 성립하는 관계만 확인한다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

function start(probed: string[], settings: Readonly<Record<string, unknown>> = {}): RealCli {
  const cli = createRealCli({
    settings,
    harness: {
      probes: { probeSearxng: (url) => (probed.push(url), Promise.resolve("unreachable")) },
    },
  });
  clis.push(cli);
  return cli;
}

test("doctor --json carries the host's binary report, and the exit code follows its ready flag", async () => {
  const cli = start([]);
  const code = await cli.harness.run(["doctor", "--json"]);
  expect(cli.sent("host.status")).toEqual([
    { method: "host.status", params: { includeBinaries: true } },
  ]);
  const doc: unknown = JSON.parse(cli.harness.stdoutText());
  const binaries = typeof doc === "object" && doc !== null ? Reflect.get(doc, "binaries") : null;
  const ready: unknown =
    typeof binaries === "object" && binaries !== null ? Reflect.get(binaries, "ready") : null;
  expect(typeof ready).toBe("boolean");
  expect(binaries).toMatchObject({
    platform: process.platform,
    items: expect.arrayContaining([expect.objectContaining({ name: "sops", need: "required" })]),
  });
  // 필수 바이너리를 쓸 수 없으면 환경 문제(3), 아니면 0이다
  expect(code).toBe(ready === true ? EXIT.ok : EXIT.environment);
  // 검색 설정은 실제 카탈로그에서 읽었다: 기본 설정으로 판정했다는 말이 없다
  expect(doc).toMatchObject({ search: { assumedDefaults: false } });
}, 60_000);

test("the text report has one line per binary the host checked", async () => {
  const cli = start([]);
  await cli.harness.run(["doctor"]);
  const lines = cli.harness.stdoutText().split("\n");
  for (const name of ["sops", "age", "rg", "git"]) {
    expect(lines.some((line) => line.includes(`외부 바이너리 ${name}:`))).toBe(true);
  }
  expect(cli.harness.stdoutText()).not.toContain("감지됨");
}, 60_000);

test("no SearXNG address means no probe at all; a configured address is the only one probed", async () => {
  const none: string[] = [];
  const unset = start(none);
  await unset.harness.run(["doctor"]);
  expect(none).toEqual([]);
  expect(unset.harness.stdoutText()).toContain(
    "SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다)",
  );

  const probed: string[] = [];
  const set = start(probed, { "l2.web.search.searxng.url": "http://search.local:9000" });
  await set.harness.run(["doctor"]);
  expect(probed).toEqual(["http://search.local:9000"]);
  expect(set.harness.stdoutText()).toContain("SearXNG: http://search.local:9000에 응답이 없다");
}, 90_000);

test("the removed detection key is unknown to the real catalog", async () => {
  const cli = start([]);
  expect(await cli.harness.run(["config", "get", "l2.web.search.searxng.detect"])).toBe(EXIT.usage);
  expect(cli.harness.stderrText()).toContain("등록되지 않은 설정 키: l2.web.search.searxng.detect");
}, 60_000);
