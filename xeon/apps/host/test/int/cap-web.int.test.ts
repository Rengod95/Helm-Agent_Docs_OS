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
