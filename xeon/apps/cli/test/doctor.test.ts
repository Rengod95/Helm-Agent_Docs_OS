import { afterEach, expect, test } from "bun:test";
import { wireError, type HostBinaryReport } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { describeSearch } from "../src/commands/doctor.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { def, fakeSettings } from "./support/m2.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const SEARCH_DEFS = [
  def("l2.web.search.provider", { default: "auto", layer: "L2" }),
  def("l2.web.search.searxng.url", { default: "", layer: "L2" }),
  def("l2.web.search.pluginOrder", { type: { type: "array" }, default: [], layer: "L2" }),
  def("l0.process.service.enabled", { type: { type: "boolean" }, default: false, layer: "L0" }),
];

function harness(
  initial: Record<string, unknown> = {},
  options: Parameters<typeof createHarness>[0] = {},
  extraHandlers: NonNullable<
    NonNullable<Parameters<typeof createHarness>[0]>["server"]
  >["handlers"] = {},
): Harness {
  const settings = fakeSettings(SEARCH_DEFS, initial);
  const h = createHarness({
    env: { NO_COLOR: "1", LANG: "ko_KR.UTF-8" },
    ...options,
    server: {
      ...options.server,
      handlers: {
        ...settings.handlers,
        "secret.list": () => ({ secrets: [] }),
        ...extraHandlers,
      },
    },
  });
  harnesses.push(h);
  return h;
}

test("doctor prints the engine checks and the three search provider lines (AC14)", async () => {
  const h = harness();
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  const text = h.stdoutText();
  expect(text).toContain("[ok]   엔진을 열었다 (in-process). 세션 저장소와 FTS5를 쓸 수 있다");
  expect(text).toContain("[ok]   비밀 저장소: 사용할 수 있다 (등록 0개)");
  expect(text).toContain("[참고] 서비스 모드: 사용 안 함 (in-process)");
  const search = text.slice(text.indexOf("검색 provider\n"));
  expect(search.trimEnd().split("\n")).toEqual([
    "검색 provider",
    "  검색 provider: auto → 내장 검색 래퍼 (builtin-wrapper)",
    "  SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다) — 쓰려면: xeon config set l2.web.search.searxng.url <주소>",
    "  권장 키 플러그인: Exa, Brave — 키 등록: xeon secret add exa-api-key, xeon secret add brave-api-key",
  ]);
  expect(h.closed()).toBe(true);
});

test("without a configured address nothing is probed, even when the old candidate addresses would answer (H1)", async () => {
  const probed: string[] = [];
  const h = harness(
    {},
    {
      probes: {
        probeSearxng: (url) => (probed.push(url), Promise.resolve("ok")),
      },
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(probed).toEqual([]);
  expect(h.stdoutText()).toContain("검색 provider: auto → 내장 검색 래퍼 (builtin-wrapper)");
  expect(h.stdoutText()).toContain("SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다)");
  expect(h.stdoutText()).not.toContain("감지됨");
});

test("a configured SearXNG address is the only one probed and becomes the auto provider when it answers", async () => {
  const probed: string[] = [];
  const h = harness(
    { "l2.web.search.searxng.url": "http://search.local:9000" },
    { probes: { probeSearxng: (url) => (probed.push(url), Promise.resolve("ok")) } },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(probed).toEqual(["http://search.local:9000"]);
  expect(h.stdoutText()).toContain("검색 provider: auto → searxng (http://search.local:9000)");
  expect(h.stdoutText()).toContain("SearXNG: 설정한 주소가 응답한다 http://search.local:9000");
});

test("a configured address that does not answer falls back to the wrapper and says so; JSON-disabled gets its own hint", async () => {
  const down = harness(
    { "l2.web.search.searxng.url": "http://search.local:9000" },
    { probes: { probeSearxng: () => Promise.resolve("unreachable") } },
  );
  expect(await down.run(["doctor"])).toBe(EXIT.ok);
  expect(down.stdoutText()).toContain(
    "SearXNG: http://search.local:9000에 응답이 없다 — 해결: 주소와 서버 상태를 확인한다. 그동안 검색은 내장 검색 래퍼로 내려간다",
  );
  expect(down.stdoutText()).toContain("auto → 내장 검색 래퍼");

  const probed: string[] = [];
  const h = harness(
    { "l2.web.search.searxng.url": "http://search.local:9000" },
    {
      probes: {
        probeSearxng: (url) => (probed.push(url), Promise.resolve("json-disabled")),
      },
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(probed).toEqual(["http://search.local:9000"]);
  expect(h.stdoutText()).toContain("JSON 형식이 꺼져 있다");
  expect(h.stdoutText()).toContain("search.formats에 json");
  expect(h.stdoutText()).toContain("auto → 내장 검색 래퍼");
});

test("registered key plugins are listed as registered and lead the auto choice", async () => {
  const h = harness({ "l2.web.search.pluginOrder": ["plugin:web-exa", "web-brave"] });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("검색 provider: auto → plugin:web-exa (키 플러그인)");
  expect(h.stdoutText()).toContain("키 플러그인: Exa, Brave 모두 등록됨");
});

test("an explicit provider is shown as pinned", async () => {
  const h = harness({ "l2.web.search.provider": "searxng" });
  await h.run(["doctor"]);
  // 주소가 없으면 고정해도 후보에 들지 못한다(L2.web.spec §4.8.2)
  expect(h.stdoutText()).toContain(
    "검색 provider: searxng (l2.web.search.provider로 고정) — 주소가 없어 쓸 수 없다",
  );
});

test("search settings the engine does not know yet fall back to the defaults and say so", async () => {
  const settings = fakeSettings([]);
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { handlers: { ...settings.handlers, "secret.list": () => ({ secrets: [] }) } },
  });
  harnesses.push(h);
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("엔진에서 검색 설정을 읽지 못해 기본 설정으로 판정했다");
  expect(h.stdoutText()).toContain("auto → 내장 검색 래퍼");
});

test("an engine that cannot start is reported as a failed check and the environment exit code", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    connect: () =>
      Promise.resolve({
        ok: false as const,
        error: {
          kind: "fts5Missing" as const,
          message: "SQLite에 FTS5가 없다",
          fix: "FTS5가 들어 있는 SQLite를 설치한다",
        },
      }),
  });
  harnesses.push(h);
  expect(await h.run(["doctor"])).toBe(EXIT.environment);
  expect(h.stdoutText()).toContain("[실패] 엔진을 열 수 없다: SQLite에 FTS5가 없다");
  expect(h.stdoutText()).toContain("해결: FTS5가 들어 있는 SQLite를 설치한다");
  // 엔진이 없어도 터미널과 검색 줄은 낸다
  expect(h.stdoutText()).toContain("터미널:");
  expect(h.stdoutText()).toContain("검색 provider: auto");
});

test("a secret store that cannot be used is a warning with the fix, not a failure", async () => {
  const h = harness(
    {},
    {},
    {
      "secret.list": () => {
        throw wireError("internal", {
          details: {
            secret: { kind: "provider_unavailable", provider: "sops", reason: "not_found" },
          },
        });
      },
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain(
    "[경고] 비밀 저장소: 비밀 제공자(sops)를 쓸 수 없다 (not_found)",
  );
  expect(h.stdoutText()).toContain("해결: sops와 age를 설치하고 xeon doctor로 확인한다");
});

test("terminal facts: pipes, columns, color and a non-UTF-8 locale warning", async () => {
  const tty = harness({}, { terminal: { stdinIsTty: true, stdoutIsTty: true, columns: 100 } });
  await tty.run(["doctor"]);
  expect(tty.stdoutText()).toContain("터미널: stdin TTY, stdout TTY, 100열, 색 끔");

  const piped = harness({}, { env: { LANG: "C" } });
  await piped.run(["doctor"]);
  expect(piped.stdoutText()).toContain("stdin 파이프, stdout 파이프");
  expect(piped.stdoutText()).toContain("[경고] 터미널:");
  expect(piped.stdoutText()).toContain("로케일이 UTF-8이 아니다");
});

test("doctor --json has the same content as one document", async () => {
  const h = harness();
  expect(await h.run(["doctor", "--json"])).toBe(EXIT.ok);
  const doc: unknown = JSON.parse(h.stdoutText());
  expect(doc).toMatchObject({
    checks: expect.arrayContaining([{ id: "engine", status: "ok", message: expect.any(String) }]),
    search: { assumedDefaults: false },
  });
});

test("describeSearch is pure over its settings and probe", async () => {
  const status = await describeSearch(
    { provider: "auto", searxngUrl: "", pluginOrder: [] },
    { probeSearxng: () => Promise.resolve("unreachable") },
    false,
  );
  expect(status.provider).toBe("검색 provider: auto → 내장 검색 래퍼 (builtin-wrapper)");
  expect(status.recommended).toContain("Exa, Brave");
});

const READY_REPORT: HostBinaryReport = {
  platform: "linux",
  ready: true,
  blocking: [],
  degraded: ["bwrap"],
  items: [
    {
      name: "sops",
      need: "required",
      usedBy: "비밀 저장소",
      impact: "비밀을 읽고 쓸 수 없다",
      status: { kind: "ok", version: "3.9.0", source: "system" },
    },
    {
      name: "rg",
      need: "optional",
      usedBy: "파일 검색",
      impact: "내장 검색으로 내려가 느려진다",
      status: { kind: "ok", version: "14.1.0", source: "bundled" },
    },
    {
      name: "bwrap",
      need: "optional",
      usedBy: "샌드박스",
      impact: "명령을 샌드박스 없이 실행하지 못한다",
      status: { kind: "missing", hint: "bubblewrap 패키지를 설치한다" },
    },
  ],
};

test("doctor asks host.status for the binary report and prints one line per binary (G2-07)", async () => {
  const asked: Record<string, unknown>[] = [];
  const h = harness(
    {},
    {},
    {
      "host.status": (params) => {
        asked.push(Object.fromEntries(Object.entries(params)));
        return {
          mode: "in-process",
          pid: 1,
          startedAt: "2026-10-26T00:00:00.000Z",
          connections: 1,
          liveTurns: 0,
          idleShutdownAt: null,
          binaries: READY_REPORT,
        };
      },
    },
  );
  // 선택 바이너리만 빠졌으므로 종료 코드는 0이다
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(asked).toEqual([{ includeBinaries: true }]);
  const lines = h.stdoutText().split("\n");
  expect(lines).toContain("  [ok]   외부 바이너리 sops: 3.9.0 (시스템) — 비밀 저장소");
  expect(lines).toContain("  [ok]   외부 바이너리 rg: 14.1.0 (번들) — 파일 검색");
  expect(lines).toContain(
    "  [경고] 외부 바이너리 bwrap: 없다 (선택) — 명령을 샌드박스 없이 실행하지 못한다",
  );
  expect(lines).toContain("         해결: bubblewrap 패키지를 설치한다");
});

test("a required binary that cannot be used is a failed check and the environment exit code", async () => {
  const h = harness(
    {},
    {},
    {
      "host.status": () => ({
        mode: "in-process",
        pid: 1,
        startedAt: "2026-10-26T00:00:00.000Z",
        connections: 1,
        liveTurns: 0,
        idleShutdownAt: null,
        binaries: {
          platform: "linux",
          ready: false,
          blocking: ["age", "git"],
          degraded: [],
          items: [
            {
              name: "age",
              need: "required",
              usedBy: "비밀 저장소",
              impact: "비밀을 복호화할 수 없다",
              status: { kind: "too_old", found: "1.0.0", required: "1.1.0" },
            },
            {
              name: "git",
              need: "required",
              usedBy: "작업 공간",
              impact: "변경 내역을 읽지 못한다",
              status: { kind: "unusable", reason: "permission_denied" },
            },
          ],
        },
      }),
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.environment);
  const lines = h.stdoutText().split("\n");
  expect(lines).toContain(
    "  [실패] 외부 바이너리 age: 버전이 낮다 (1.0.0, 필요 1.1.0) — 비밀을 복호화할 수 없다",
  );
  expect(lines).toContain("         해결: age을(를) 1.1.0 이상으로 올린다");
  expect(lines).toContain(
    "  [실패] 외부 바이너리 git: 쓸 수 없다 (permission_denied) — 변경 내역을 읽지 못한다",
  );
});

test("doctor --json carries the raw binary report, or null when the engine has none", async () => {
  const withReport = harness(
    {},
    {},
    {
      "host.status": () => ({
        mode: "in-process",
        pid: 1,
        startedAt: "2026-10-26T00:00:00.000Z",
        connections: 1,
        liveTurns: 0,
        idleShutdownAt: null,
        binaries: READY_REPORT,
      }),
    },
  );
  expect(await withReport.run(["doctor", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(withReport.stdoutText())).toMatchObject({ binaries: READY_REPORT });

  const without = harness();
  expect(await without.run(["doctor", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(without.stdoutText())).toMatchObject({ binaries: null });
  expect(without.stdoutText()).toContain("이 엔진은 점검 결과를 알리지 않는다");
  expect(without.methods()).not.toContain("host.status");
});

test("a binary check that fails is a warning and doctor goes on", async () => {
  const h = harness(
    {},
    {},
    {
      "host.status": () => {
        throw wireError("request.cancelled");
      },
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("[경고] 외부 바이너리: 점검하지 못했다 — 요청이 취소되었다");
  expect(h.stdoutText()).toContain("검색 provider:");
});
