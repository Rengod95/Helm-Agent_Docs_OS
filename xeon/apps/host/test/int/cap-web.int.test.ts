import { expect, test } from "bun:test";
import { ok, repeatAsync } from "@xeon/contracts";
import type { DnsResolver, HttpTransport } from "@xeon/cap-web";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { fetchingModels } from "../fixtures/web-tape.ts";
import {
  fakeHostedSearch,
  publicResolver,
  searchingModels,
  searxngSwitch,
} from "../fixtures/web-search.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 cap-web (int): web_fetch가 도구로 광고되고, 정책이 묻는 도메인은 승인을 거치며, 허용하면 본문을 읽는다.
// 이름 해석과 전송은 가짜다(루프백은 정책이 항상 거부한다). 네트워크에 나가지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 시험 이름을 공개 주소로 푼다(전송이 가짜라 실제로 접속하지 않는다) */
const fixtureResolver: DnsResolver = {
  resolve: () => Promise.resolve(ok(["93.184.216.34"])),
};

/** robots.txt는 없고 그 밖의 경로는 고정 페이지를 준다 */
const fixtureTransport: HttpTransport = {
  send(request) {
    const found = !request.url.endsWith("/robots.txt");
    return Promise.resolve(
      ok({
        status: found ? 200 : 404,
        url: request.url,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: new TextEncoder().encode(found ? PAGE : "not found"),
      }),
    );
  },
};

const PAGE =
  "<html><head><title>Fixture</title></head><body><p>hello from the fixture page</p></body></html>";

realTest(
  "web_fetch asks about an unknown domain, then reads the page after the user allows it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const url = "http://fixture.example/page";
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: fetchingModels("web", url),
      webPorts: { resolver: fixtureResolver, transport: fixtureTransport },
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    // 사용자가 입력에 쓴 URL은 "대화에 나온 URL"이라 unseen_url 질문을 피한다. 도메인 정책(기본 ask)의 질문은 남는다
    await connection.request("turn.start", { threadId: created.threadId, input: `read ${url}` });

    // 질문이 올 때마다 허용한다(도메인 질문 하나, 도구 승인 하나가 올 수 있다)
    const answered = new Set<string>();
    await repeatAsync<void>(async () => {
      const next = await collector.waitFor(
        (event) =>
          (event.kind === "approval.requested" && !answered.has(event.id)) ||
          event.kind === "turn.completed",
      );
      if (next.kind === "turn.completed") return { value: undefined };
      answered.add(next.id);
      await connection.request("approval.respond", { approvalId: next.id, decision: "allow" });
      return undefined;
    });
    const done = await collector.waitFor((event) => event.kind === "turn.completed");
    expect(done.payload).toMatchObject({ status: "completed" });
    expect(toolResultTexts(collector.events).join("\n")).toContain("hello from the fixture page");
    // 승인 요청은 웹 능력의 도구 승인 body다
    const asked = collector.events.filter((event) => event.kind === "approval.requested");
    expect(asked.length).toBeGreaterThan(0);
    expect(JSON.stringify(asked)).toContain("web.fetch");
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);

// E4(M2 종료 조건, ADR-0005 개정, H1): `web.search`의 기본 provider는 내장 검색 래퍼이고, SearXNG는 사용자가 주소를 설정했을 때만 쓴다.
// 조립 루트가 `xeon.models`의 hosted 검색을 cap-web에 넘기지 않으면 래퍼가 후보에 들지 않는다.

const SEARXNG_URL = "http://127.0.0.1:8888";

interface SearchRig {
  readonly hosted: ReturnType<typeof fakeHostedSearch>;
  readonly searxng: ReturnType<typeof searxngSwitch>;
  readonly connection: Awaited<ReturnType<typeof openSearchHost>>["connection"];
  readonly collector: ReturnType<typeof collectEvents>;
  readonly threadId: string;
  runTurn(input: string): Promise<void>;
  close(): Promise<void>;
}

async function openSearchHost(
  settings: Readonly<Record<string, unknown>>,
  searxngUp: boolean,
  queries: readonly string[],
  injectHosted: boolean,
) {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  const hosted = fakeHostedSearch();
  const searxng = searxngSwitch(searxngUp);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: searchingModels("web-search", queries),
    webPorts: {
      resolver: publicResolver,
      transport: searxng.transport,
      ...(injectHosted ? { hostedSearch: hosted.port } : {}),
    },
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { home, host, hosted, searxng, connection };
}

async function searchRig(
  settings: Readonly<Record<string, unknown>>,
  searxngUp: boolean,
  queries: readonly string[],
  injectHosted = true,
): Promise<SearchRig> {
  const { home, host, hosted, searxng, connection } = await openSearchHost(
    settings,
    searxngUp,
    queries,
    injectHosted,
  );
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const created = await connection.request("thread.create", {});
  return {
    hosted,
    searxng,
    connection,
    collector,
    threadId: created.threadId,
    async runTurn(input) {
      const before = collector.events.filter((event) => event.kind === "turn.completed").length;
      await connection.request("turn.start", { threadId: created.threadId, input });
      const answered = new Set<string>();
      await repeatAsync<void>(async () => {
        const next = await collector.waitFor(
          (event) =>
            (event.kind === "approval.requested" && !answered.has(event.id)) ||
            (event.kind === "turn.completed" &&
              collector.events.filter((entry) => entry.kind === "turn.completed").length > before),
        );
        if (next.kind === "turn.completed") return { value: undefined };
        answered.add(next.id);
        await connection.request("approval.respond", { approvalId: next.id, decision: "allow" });
        return undefined;
      });
    },
    async close() {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

realTest(
  "with no SearXNG address set, web_search uses the built-in wrapper and never calls a SearXNG that happens to run",
  async () => {
    // detect=false는 감지가 아직 있는 빌드에서도 같은 결과를 내려는 설정이다(감지를 없앤 빌드에서는 영향이 없다)
    const rig = await searchRig({ "l2.web.search.searxng.detect": false }, true, ["only query"]);
    await rig.runTurn("search it");
    expect(rig.hosted.requests).toHaveLength(1);
    expect(rig.hosted.requests[0]?.query).toBe("only query");
    expect(rig.searxng.hits).toBe(0);
    expect(toolResultTexts(rig.collector.events, 6000).join("\n")).toContain(
      "docs.example.org/wrapper",
    );
    await rig.close();
  },
  30_000,
);

realTest(
  "with a SearXNG address set, web_search uses SearXNG, and a settings change drops the remembered failed probe",
  async () => {
    const rig = await searchRig({ "l2.web.search.searxng.url": SEARXNG_URL }, false, [
      "first query",
      "second query",
    ]);
    // 설정한 SearXNG가 아직 떠 있지 않으면 내장 래퍼로 내려간다
    await rig.runTurn("search first");
    expect(rig.hosted.requests).toHaveLength(1);
    expect(toolResultTexts(rig.collector.events, 6000).join("\n")).toContain(
      "docs.example.org/wrapper",
    );

    // SearXNG를 띄워도 실패 탐침을 30초 기억하므로 아직 래퍼가 답한다. 설정을 바꾸면 기억을 지운다(HS-75)
    rig.searxng.up = true;
    await rig.connection.request("settings.set", {
      key: "l1.loop.maxSteps",
      value: 25,
      scope: "user",
    });
    await rig.runTurn("search second");
    expect(rig.hosted.requests).toHaveLength(1);
    expect(rig.searxng.hits).toBeGreaterThan(0);
    expect(toolResultTexts(rig.collector.events, 6000).join("\n")).toContain(
      "docs.example.org/searxng",
    );
    await rig.close();
  },
  30_000,
);

realTest(
  "the assembly root hands the engine's own hosted search to cap-web, so the built-in wrapper is in the provider chain",
  async () => {
    // 시험이 hosted 검색 대역을 주지 않으면 xeon.models의 포트가 쓰인다. 테이프 provider는 hosted 검색이 없어 래퍼가 모델 미지원으로 내려가지만,
    // 래퍼가 후보에 올라 있다는 것이 연결의 증거다(연결하지 않으면 후보에 없다)
    const rig = await searchRig({ "l2.web.search.searxng.detect": false }, false, ["any"], false);
    await rig.runTurn("search it");
    expect(toolResultTexts(rig.collector.events, 6000).join("\n")).toContain(
      "builtin-wrapper probe:unsupported-model",
    );
    expect(rig.hosted.requests).toHaveLength(0);
    await rig.close();
  },
  30_000,
);
