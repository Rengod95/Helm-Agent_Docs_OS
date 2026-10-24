import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { describeSearch, SEARXNG_CANDIDATES } from "../src/commands/doctor.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { def, fakeSettings } from "./support/m2.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const SEARCH_DEFS = [
  def("l2.web.search.provider", { default: "auto", layer: "L2" }),
  def("l2.web.search.searxng.url", { default: "", layer: "L2" }),
  def("l2.web.search.searxng.detect", { type: { type: "boolean" }, default: true, layer: "L2" }),
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
    "  SearXNG: 없음 — 해결: xeon config set l2.web.search.searxng.url <주소> (감지 후보 http://127.0.0.1:8888 등)",
    "  권장 키 플러그인: Exa, Brave — 키 등록: xeon secret add exa-api-key, xeon secret add brave-api-key",
  ]);
  expect(h.closed()).toBe(true);
});

test("a detected SearXNG becomes the auto provider and the detection tries the loopback candidates in order", async () => {
  const probed: string[] = [];
  const h = harness(
    {},
    {
      probes: {
        probeSearxng: (url) => {
          probed.push(url);
          return Promise.resolve(url === "http://127.0.0.1:8080" ? "ok" : "unreachable");
        },
      },
    },
  );
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(probed.toSorted()).toEqual(SEARXNG_CANDIDATES.toSorted());
  expect(h.stdoutText()).toContain("검색 provider: auto → searxng (http://127.0.0.1:8080)");
  expect(h.stdoutText()).toContain("SearXNG: 감지됨 http://127.0.0.1:8080");
});

test("a configured SearXNG address is the only one probed; a JSON-disabled answer gets its own hint", async () => {
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

test("detection off and no address probes nothing", async () => {
  const probed: string[] = [];
  const h = harness(
    { "l2.web.search.searxng.detect": false },
    { probes: { probeSearxng: (url) => (probed.push(url), Promise.resolve("ok")) } },
  );
  await h.run(["doctor"]);
  expect(probed).toEqual([]);
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
  expect(h.stdoutText()).toContain("검색 provider: searxng (l2.web.search.provider로 고정)");
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
    { provider: "auto", searxngUrl: "", detect: true, pluginOrder: [] },
    { probeSearxng: () => Promise.resolve("unreachable") },
    false,
  );
  expect(status.provider).toBe("검색 provider: auto → 내장 검색 래퍼 (builtin-wrapper)");
  expect(status.recommended).toContain("Exa, Brave");
});
