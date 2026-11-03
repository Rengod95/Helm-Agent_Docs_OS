import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// G2-07, H1: 실제 호스트 위의 `fresnel doctor`. test/doctor.test.ts의 가짜 host.status·settings.get 대신 실제 처리기가 외부 바이너리를 점검하고
// 실제 설정 카탈로그가 검색 설정을 알려 준다. 이 기기에 어떤 바이너리가 있는지에 상관없이 성립하는 관계만 확인한다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

function start(): RealCli {
  const cli = createRealCli();
  clis.push(cli);
  return cli;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

test("doctor --json carries the host's binary report, and the exit code follows its ready flag", async () => {
  const cli = start();
  const code = await cli.harness.run(["doctor", "--json"]);
  expect(cli.sent("host.status")).toEqual([
    { method: "host.status", params: { includeBinaries: true } },
  ]);
  const doc: unknown = JSON.parse(cli.harness.stdoutText());
  const binaries = isRecord(doc) ? doc["binaries"] : null;
  const ready: unknown = isRecord(binaries) ? binaries["ready"] : null;
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
  const cli = start();
  await cli.harness.run(["doctor"]);
  const lines = cli.harness.stdoutText().split("\n");
  for (const name of ["sops", "age", "rg", "git"]) {
    expect(lines.some((line) => line.includes(`외부 바이너리 ${name}:`))).toBe(true);
  }
  expect(cli.harness.stdoutText()).not.toContain("감지됨");
}, 60_000);
