import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 지표(`metrics.*`), 측정 일별 값(`measure.daily`), 살펴볼 것(`findings.*`)을 실제 엔진에서 시험한다(M5d, `turn-record-metrics.md` §3.5, §6).
// 턴 세 개를 테이프로 돌려 기록을 만든 뒤, 읽기 값을 기록에서 따로 본 값과 맞춰 본다.
// 발견은 기본 표본 기준(20턴) 아래에서는 나오지 않으므로, 시험마다 표본 기준과 규칙 임계를 설정으로 낮춘다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 테이프의 입력 토큰 수. 턴 순서대로 쓰인다 */
const INPUT_TOKENS = [1234, 1300, 1400] as const;
/** 지표 기본 창 하루 */
const ONE_DAY_MS = 86_400_000;

interface Rig {
  readonly connection: HostConnection;
  readonly threadId: string;
  /** 턴 id를 시작한 순서대로 */
  readonly turnIds: readonly string[];
  close(): Promise<void>;
}

/** 엔진을 세우고 대화에서 턴 세 개를 끝까지 돌린다. `close`가 호스트를 닫는다 */
async function rigWith(home: EngineHome, settings: Readonly<Record<string, unknown>>) {
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  const models = recordingModels(
    "metrics-findings",
    INPUT_TOKENS.map((inputTokens) => ({ text: "답", inputTokens })),
    { contextWindow: 100_000 },
  );
  const host: InProcessHost = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: models.buildModels,
  });
  const connection = createHostConnection(host.client);
  const collector = collectEvents(connection);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });
  const created = await connection.request("thread.create", {});
  const turnIds: string[] = [];
  for (const input of ["one", "two", "three"]) {
    // oxlint-disable-next-line no-await-in-loop -- 턴은 앞 턴이 끝난 뒤에 시작한다 (eng.testing.guide TS-05)
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input,
    });
    // oxlint-disable-next-line no-await-in-loop -- 턴은 앞 턴이 끝난 뒤에 시작한다 (eng.testing.guide TS-05)
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      20_000,
    );
    turnIds.push(started.turnId);
  }
  const rig: Rig = {
    connection,
    threadId: created.threadId,
    turnIds,
    close: async () => {
      await host.close();
    },
  };
  return rig;
}

/** wire 오류를 꺼낸다. 다른 오류면 그대로 던진다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

/** 기록의 시작 시각을 UTC 날짜(`YYYY-MM-DD`)로 바꾼다. 지표와 일별 값이 쓰는 날짜다 */
function utcDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

realTest(
  "metrics.catalog lists each metric once, and the hook-run metric has its unit, kind and feasibility from the spec table",
  async () => {
    const home = useEngineHome();
    const rig = await rigWith(home, {});
    try {
      const catalog = await rig.connection.request("metrics.catalog", {});
      const ids = catalog.metrics.map((metric) => metric.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(catalog.metrics.find((metric) => metric.id === "hook.runs")).toEqual({
        id: "hook.runs",
        label: { ko: "훅 실행 수", en: "Hook runs" },
        unit: "runs",
        kind: "count",
        appliesTo: ["hook"],
        feasible: "exact",
        definitionNote: null,
      });
      expect(catalog.metrics.find((metric) => metric.id === "inst.loaded_turns")).toMatchObject({
        unit: "turns",
        kind: "count",
        appliesTo: ["instruction"],
        feasible: "exact",
      });
      expect(catalog.metrics.find((metric) => metric.id === "no.such.metric")).toBeUndefined();
    } finally {
      await rig.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "metrics.query counts the three turns' hook runs and instruction turns, groups them by model and day, and refuses unknown metrics and bad filters",
  async () => {
    const home = useEngineHome();
    const rig = await rigWith(home, {});
    try {
      const { connection, turnIds, threadId } = rig;
      const list = await connection.request("turnRecord.list", { threadId });
      expect(list.items.map((item) => item.turnId)).toEqual([...turnIds].toReversed());

      // 창은 요청한 기간이고, 값은 세 턴이 쓴 훅 실행 수다. 턴마다 단계 0 훅과 늦은 훅이 나뉘어 쓰인다
      const plain = await connection.request("metrics.query", {
        metrics: ["hook.runs", "tool.calls"],
        filter: { period: { days: 1 } },
        groupBy: [],
      });
      expect(plain.window.to - plain.window.from).toBe(ONE_DAY_MS);
      expect(plain.rows).toEqual([
        {
          key: {},
          values: {
            "hook.runs": { value: 26, n: 26, state: "exact" },
            "tool.calls": { value: 0, n: 0, state: "exact" },
          },
        },
      ]);
      expect(plain.notes).toEqual([]);

      // 지침은 기본 프로필 core 플러그인이 세 턴 모두에 싣는다
      const core = await connection.request("metrics.query", {
        metrics: ["inst.loaded_turns"],
        filter: { plugin: "core", period: { days: 1 } },
      });
      expect(core.rows[0]?.values).toEqual({
        "inst.loaded_turns": { value: 3, n: 3, state: "exact" },
      });

      // 플러그인 거르기 값은 그 플러그인의 검색 결과와 같다: cap-web은 턴마다 한 번 돈다
      const webRuns = await connection.request("metrics.query", {
        metrics: ["hook.runs"],
        filter: { plugin: "cap-web", period: { days: 1 } },
      });
      expect(webRuns.rows[0]?.values["hook.runs"]).toEqual({ value: 3, n: 3, state: "exact" });
      const webSearch = await connection.request("turnRecord.search", {
        plugin: "cap-web",
        period: { days: 1 },
      });
      expect(webSearch.items.map((item) => item.turnId).toSorted()).toEqual(
        [...turnIds].toSorted(),
      );

      // 모델별과 날짜별로 나누면 한 줄씩 남고, 날짜 줄은 턴이 시작한 UTC 날짜다
      const byModel = await connection.request("metrics.query", {
        metrics: ["hook.runs"],
        filter: { period: { days: 1 } },
        groupBy: ["model"],
      });
      expect(byModel.rows).toEqual([
        { key: { model: "tape-1" }, values: { "hook.runs": { value: 26, n: 26, state: "exact" } } },
      ]);
      const byDay = await connection.request("metrics.query", {
        metrics: ["hook.runs"],
        filter: { period: { days: 1 } },
        groupBy: ["day"],
      });
      const first = list.items[0];
      if (first === undefined) throw new Bug("the turns must be listed");
      const day = utcDayOf(first.startedAt);
      expect(list.items.map((item) => utcDayOf(item.startedAt))).toEqual(list.items.map(() => day));
      expect(byDay.rows.map((row) => row.key)).toEqual([{ day }]);

      // 모델 비교는 두 쪽을 나란히 낸다. 없는 모델 쪽은 값 0의 정확한 표본이다
      const compared = await connection.request("metrics.query", {
        metrics: ["hook.runs"],
        filter: { period: { days: 1 } },
        compare: { by: "model", a: "tape-1", b: "other-model" },
      });
      expect(compared.rows).toEqual([
        { key: { model: "tape-1" }, values: { "hook.runs": { value: 26, n: 26, state: "exact" } } },
        {
          key: { model: "other-model" },
          values: { "hook.runs": { value: 0, n: 0, state: "exact" } },
        },
      ]);

      // 오류: 없는 지표는 3511(id가 메시지), 기록 기준 밖의 거르기는 3512
      const unknown = await wireErrorOf(
        connection.request("metrics.query", {
          metrics: ["nope.metric"],
          filter: { period: { days: 1 } },
        }),
      );
      expect([unknown.code, unknown.data.kind, unknown.message]).toEqual([
        3511,
        "metrics.unknownMetric",
        "nope.metric",
      ]);
      const byVersion = await wireErrorOf(
        connection.request("metrics.query", {
          metrics: ["hook.runs"],
          filter: { period: { days: 1 } },
          groupBy: ["pluginVersion"],
        }),
      );
      expect([byVersion.code, byVersion.message]).toEqual([
        3512,
        "grouping by pluginVersion is not computed yet",
      ]);
      const versionNeedsPlugin = await wireErrorOf(
        connection.request("metrics.query", {
          metrics: ["hook.runs"],
          filter: { period: { days: 1 } },
          compare: { by: "pluginVersion", a: "x", b: "y" },
        }),
      );
      expect([versionNeedsPlugin.code, versionNeedsPlugin.message]).toEqual([
        3512,
        "compare by pluginVersion needs filter.plugin",
      ]);
      const backwards = await wireErrorOf(
        connection.request("metrics.query", {
          metrics: ["hook.runs"],
          filter: { period: { from: 9, to: 1 } },
        }),
      );
      expect([backwards.code, backwards.message]).toEqual([
        3512,
        "period.from must be less than period.to",
      ]);
    } finally {
      await rig.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "measure.daily gives each day's count, sum, min and max of the call inputs and turn steps, on the turns' UTC day",
  async () => {
    const home = useEngineHome();
    const rig = await rigWith(home, {});
    try {
      const { connection, threadId } = rig;
      const list = await connection.request("turnRecord.list", { threadId });
      const day = utcDayOf(list.items[0]?.startedAt ?? 0);

      // 호출 입력 토큰은 테이프가 답한 값 셋의 합과 최소·최대와 같다
      const inputs = await connection.request("measure.daily", { kind: "call", metric: "input" });
      expect(inputs).toEqual({
        enabled: true,
        days: [
          {
            day,
            count: 3,
            sum: INPUT_TOKENS.reduce((total, tokens) => total + tokens, 0),
            min: 1234,
            max: 1400,
          },
        ],
      });
      // 턴 단계는 턴마다 하나다
      const steps = await connection.request("measure.daily", { kind: "turn", metric: "steps" });
      expect(steps).toEqual({
        enabled: true,
        days: [{ day, count: 3, sum: 3, min: 1, max: 1 }],
      });
      // 모르는 지표는 빈 일 목록이다(오류가 아니다)
      expect(await connection.request("measure.daily", { kind: "call", metric: "nope" })).toEqual({
        enabled: true,
        days: [],
      });
    } finally {
      await rig.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "findings.list is empty below the default minimum sample, and with the sample lowered the unused-tools finding matches the record's advertised tokens",
  async () => {
    // 기본 표본 기준 20턴: 세 턴으로는 발견이 없다. 데이터 개정은 턴 행 번호의 최댓값(3)이다
    const quietHome = useEngineHome();
    const quiet = await rigWith(quietHome, {});
    try {
      const none = await quiet.connection.request("findings.list", {});
      expect(none.findings).toEqual([]);
      expect(none.dataRevision).toBe(3);
      expect(typeof none.asOf).toBe("number");
    } finally {
      await quiet.close();
      quietHome.dispose();
    }

    const home = useEngineHome();
    const rig = await rigWith(home, {
      "x.operations.metrics.minSample": 1,
      "x.operations.findings.overrides": { unused_tools: { minTurns: 1 } },
    });
    try {
      const { connection, threadId, turnIds } = rig;
      const found = await connection.request("findings.list", {});
      expect(found.dataRevision).toBe(3);
      const finding = found.findings.find((item) => item.subject.plugin === "workspace.files");
      if (finding === undefined) throw new Bug("the workspace.files tools must be unused");
      expect({
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        kind: finding.subject.kind,
        ref: finding.subject.ref,
        unit: finding.impact.unit,
        state: finding.state,
        evidenceTotal: finding.evidenceTotal,
      }).toEqual({
        ruleId: "unused_tools",
        ruleVersion: 1,
        kind: "tool",
        ref: null,
        unit: "tokens_per_turn",
        state: "open",
        evidenceTotal: 3,
      });

      // 값은 기록의 광고 목록과 맞는다: 이 플러그인의 도구는 모두 안 불렸고, 광고 토큰이 한 턴의 낭비다
      const record = await connection.request("turnRecord.get", {
        threadId,
        turnId: turnIds[0] ?? "",
      });
      const advertised = record.record?.steps[0]?.advertised.byPlugin.find(
        (entry) => entry.plugin === "workspace.files",
      );
      if (advertised === undefined) throw new Bug("the record must advertise the plugin's tools");
      expect(finding.impact.value).toBe(advertised.tokens);
      expect(finding.metrics["tool.never_called"]?.value).toBe(advertised.count);

      // 없는 프로필로 거르면 발견이 없다
      const otherProfile = await connection.request("findings.list", { profileId: "nope" });
      expect(otherProfile.findings).toEqual([]);
    } finally {
      await rig.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "findings.evidence lists the turns newest first, findings.bundle repeats the finding, and a dismissal hides it from the open list until its until passes",
  async () => {
    const home = useEngineHome();
    const rig = await rigWith(home, {
      "x.operations.metrics.minSample": 1,
      "x.operations.findings.overrides": { unused_tools: { minTurns: 1 } },
    });
    try {
      const { connection, threadId } = rig;
      const found = await connection.request("findings.list", {});
      const finding = found.findings.find((item) => item.subject.plugin === "workspace.files");
      if (finding === undefined) throw new Bug("the workspace.files finding must be listed");
      const id = finding.id;
      const allIds = found.findings.map((item) => item.id).toSorted();

      // 증거는 턴 세 개이고 최신 순이다. 턴 목록과 같은 순서다
      const list = await connection.request("turnRecord.list", { threadId });
      const evidence = await connection.request("findings.evidence", { findingId: id });
      expect(evidence.next).toBeNull();
      expect(evidence.items).toEqual(
        list.items.map((item) => ({ kind: "turn", threadId, turnId: item.turnId })),
      );

      // 묶음은 발견을 id와 해시와 숫자로 되풀이한다. 16 KiB 이하다
      const bundle = await connection.request("findings.bundle", { findingId: id });
      expect(bundle.bundle).toEqual({
        findingId: id,
        ruleId: finding.ruleId,
        subject: finding.subject,
        impact: finding.impact,
        metrics: finding.metrics,
        evidence: finding.evidence,
        evidenceTotal: finding.evidenceTotal,
      });
      expect(bundle.bytes).toBeGreaterThan(0);
      expect(bundle.bytes).toBeLessThanOrEqual(16_384);

      // 해제: 열린 목록에서 빠지고, 해제 목록과 전체 목록에는 해제 상태로 남는다
      expect(await connection.request("findings.dismiss", { findingId: id })).toEqual({});
      const openAfter = await connection.request("findings.list", { state: "open" });
      expect(openAfter.findings.map((item) => item.id).toSorted()).toEqual(
        allIds.filter((item) => item !== id),
      );
      const dismissed = await connection.request("findings.list", { state: "dismissed" });
      expect(dismissed.findings.map((item) => [item.id, item.state])).toEqual([[id, "dismissed"]]);
      const everything = await connection.request("findings.list", {});
      expect(everything.findings.find((item) => item.id === id)?.state).toBe("dismissed");

      // 다시 열리는 시점이 이미 지났으면 열린 목록에 되돌아온다
      await connection.request("findings.dismiss", { findingId: id, until: 1 });
      const reopened = await connection.request("findings.list", { state: "open" });
      expect(reopened.findings.map((item) => item.id).toSorted()).toEqual(allIds);

      // 다시 열릴 시점이 아직 멀었으면 해제 상태를 유지한다
      await connection.request("findings.dismiss", {
        findingId: id,
        until: Date.now() + 3_600_000,
      });
      const snoozed = await connection.request("findings.list", { state: "dismissed" });
      expect(snoozed.findings.map((item) => item.id)).toEqual([id]);

      // 없는 발견의 증거와 묶음, 해제는 findings.notFound(3531)다
      const missingEvidence = await wireErrorOf(
        connection.request("findings.evidence", { findingId: "unused_tools-none" }),
      );
      expect([missingEvidence.code, missingEvidence.data.kind]).toEqual([
        3531,
        "findings.notFound",
      ]);
      const missingBundle = await wireErrorOf(
        connection.request("findings.bundle", { findingId: "unused_tools-none" }),
      );
      expect([missingBundle.code, missingBundle.data.kind]).toEqual([3531, "findings.notFound"]);
      const missingDismiss = await wireErrorOf(
        connection.request("findings.dismiss", { findingId: "unused_tools-none" }),
      );
      expect([missingDismiss.code, missingDismiss.data.kind]).toEqual([3531, "findings.notFound"]);
    } finally {
      await rig.close();
      home.dispose();
    }
  },
  60_000,
);
