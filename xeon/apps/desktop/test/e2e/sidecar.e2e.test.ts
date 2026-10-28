import { afterEach, describe, expect, test } from "bun:test";
import { type EngineProcess, processesWithHome, startEngine } from "./harness.ts";
import { binaryViewOf } from "@xeon/client/settings";
import { HostBinaryReportSchema, type HostBinaryReport } from "@xeon/contracts/wire";
import { parse } from "@xeon/contracts";
import { binaryReportOf, CLI_MAIN, nthReply, runScenario, sidecarPath } from "./scenario.ts";

// G4-03 (E2, E3): 컴파일한 사이드카 바이너리를 stdio로 몰아 소스 진입과 같은 응답·이벤트열이 나오는지, 정상 종료 뒤 프로세스가 남지 않는지 본다.
// 사이드카가 없으면(빌드하지 않았으면) 바이너리 시험은 건너뛴다: `just desktop-sidecar host` 뒤에 돈다. 소스 진입 시험은 항상 돈다.
// "needs the binary" 시험의 건너뜀은 종료 조건 증거가 되지 못한다(review.fake-only). `just exit-tests`(scripts/exit-tests.txt의 E2,E3 줄)는
// 사이드카가 없으면 먼저 빌드하고 건너뜀이 하나라도 있으면 실패한다.

const SOURCE = [process.execPath, CLI_MAIN, "host", "--stdio"] as const;
const binary = sidecarPath();
const withBinary = binary === null ? test.skip : test;
const engines: EngineProcess[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.dispose()));
});

async function start(command: readonly string[]): Promise<EngineProcess> {
  const engine = await startEngine(command);
  engines.push(engine);
  return engine;
}

describe("source entry (harness regression)", () => {
  test("the scenario runs, stdout carries only JSON-RPC and stdin EOF after host.shutdown exits 0", async () => {
    const engine = await start(SOURCE);
    const run = await runScenario(engine);
    expect(run.strayStdout).toEqual([]);
    // 기본 켜짐 scope가 하나 이상 있고 한 묶음으로 커밋된다
    expect(run.scopeCount).toBeGreaterThan(0);
    const kinds = run.events.map((event): unknown => (isRecord(event) ? event["kind"] : undefined));
    expect(kinds[0]).toBe("thread.started");
    expect(kinds.filter((k) => k === "scope.changed")).toHaveLength(run.scopeCount);
    const exit = await engine.shutdown({ message: true });
    expect(exit.code, engine.stderr()).toBe(0);
  }, 60_000);

  test("two runs of the source entry give identical normalized responses and events", async () => {
    const first = await start(SOURCE);
    const a = await runScenario(first);
    await first.shutdown({ message: true });
    const second = await start(SOURCE);
    const b = await runScenario(second);
    await second.shutdown({ message: true });
    // 정규화가 홈마다 다른 값(저장소 id, 시각)을 지운다는 근거: 같은 엔진을 두 번 돌려도 같다
    expect(b.responses).toEqual(a.responses);
    expect(b.events).toEqual(a.events);
  }, 90_000);
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** 응답 프레임의 result 또는 error에서 필드를 꺼낸다 */
function pick(reply: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), reply);
}

function shape(report: HostBinaryReport): unknown {
  return report.items.map((i) => [i.name, i.need, i.usedBy, i.impact]);
}

function reportOf(raw: unknown): HostBinaryReport {
  const parsed = parse(HostBinaryReportSchema, raw);
  if (!parsed.ok)
    throw new Error(`host.status binaries is not a HostBinaryReport: ${JSON.stringify(raw)}`);
  return parsed.value;
}

describe("what the desktop asks, answered by the real host (T7)", () => {
  test("the chosen folder, the trust card and the command list get real values", async () => {
    const engine = await start(SOURCE);
    const run = await runScenario(engine);

    // thread.create { workspace }: 상대 경로와 없는 폴더는 -32602이고 대화를 만들지 않는다. 폴더가 있으면 정규 경로가 대화에 남는다
    expect(pick(nthReply(run.responses, "thread.create", 1), "error", "code")).toBe(-32602);
    expect(pick(nthReply(run.responses, "thread.create", 2), "error", "code")).toBe(-32602);
    const listed = nthReply(run.responses, "thread.list", 1);
    const threads = pick(listed, "result", "threads");
    if (!Array.isArray(threads)) throw new Error("thread.list gave no threads");
    expect(threads.map((t: unknown) => String(pick(t, "workspace"))).toSorted()).toEqual([
      "<home>/project",
      "null",
    ]);

    // trust.get: 홈은 신뢰할 자원이 없고, 프로젝트는 자원이 있어 결정을 기다린다. 선택지의 저장 폴더가 대화의 폴더와 같은 문자열이다
    const home = nthReply(run.responses, "trust.get", 0);
    expect(pick(home, "result", "required")).toBe(false);
    expect(pick(home, "result", "verdict")).toBe("allow");
    expect(pick(home, "result", "via")).toBe("notRequired");
    const project = nthReply(run.responses, "trust.get", 1);
    expect(pick(project, "result", "projectRoot")).toBe("<home>/project");
    expect(pick(project, "result", "required")).toBe(true);
    expect(pick(project, "result", "verdict")).toBe("undecided");
    expect(pick(project, "result", "resources")).toEqual([".xeon/skills"]);
    const options = pick(project, "result", "options");
    if (!Array.isArray(options)) throw new Error("trust.get gave no options");
    const folder = options.find((o: unknown) => pick(o, "label") === "trust-folder");
    expect(pick(folder, "savedPath")).toBe("<home>/project");
    // 결정을 보내면 저장된 판정이 돌아오고 다시 읽어도 같다
    const decided = nthReply(run.responses, "trust.decide", 0);
    expect(pick(decided, "result", "verdict")).toBe("allow");
    expect(pick(decided, "result", "via")).toBe("store");
    const after = nthReply(run.responses, "trust.get", 2);
    expect(pick(after, "result", "verdict")).toBe("allow");
    expect(pick(after, "result", "via")).toBe("store");

    // command.list: 엔진에 등록된 /learning(학습 그룹), /plan, /tasks. thread를 주어도 같은 목록이다. /helm은 없다:
    // 기본 플러그인 번들이 이 실행 환경(실행 파일 옆 default-plugins/)에 없어 Helm이 설치·적재되지 않는다
    const names = (reply: unknown): unknown[] => {
      const commands = pick(reply, "result", "commands");
      return Array.isArray(commands) ? commands.map((c: unknown) => pick(c, "name")) : [];
    };
    expect(names(nthReply(run.responses, "command.list", 0))).toEqual([
      "learning",
      "plan",
      "tasks",
    ]);
    expect(names(nthReply(run.responses, "command.list", 1))).toEqual([
      "learning",
      "plan",
      "tasks",
    ]);

    // 설정 화면: 저장한 기본 모델이 다시 읽으면 나오고, 저장은 연결 전체에 settings.invalidated를 낸다. 화면의 필터(l1.models.)에 걸린다
    expect(pick(nthReply(run.responses, "settings.set", 0), "result")).toBeDefined();
    const reread = pick(nthReply(run.responses, "settings.get", 1), "result", "settings");
    if (!Array.isArray(reread)) throw new Error("settings.get gave no settings");
    expect(pick(reread[0], "value")).toBe("anthropic/claude-sonnet-5-5");
    // 신뢰 결정은 프로젝트·로컬 범위 전체를 다시 읽게 하는 알림(keys가 빔)을, 기본 모델 저장은 그 키의 알림을 낸다.
    // 화면은 둘 다 다시 읽는다(keys가 비었거나 l1.models.로 시작하는 키가 있을 때)
    expect(run.invalidated).toEqual([
      { keys: [], scopes: ["project", "local"], threadId: null },
      { keys: ["l1.models.default"], scopes: ["user"], threadId: null },
    ]);
    // 키 값을 받을 수단이 없는 stdio 호스트: 화면은 터미널 명령 안내로 넘어간다
    const begun = nthReply(run.responses, "secret.beginEntry", 0);
    expect(pick(begun, "result", "started")).toBe(false);
    await engine.shutdown({ message: true });
  }, 90_000);

  test("host.status with includeBinaries carries a report the settings screen turns into rows (G2-07)", async () => {
    const engine = await start(SOURCE);
    const report = reportOf(await binaryReportOf(engine));
    expect<string>(report.platform).toBe(process.platform);
    expect(report.items.length).toBeGreaterThan(0);
    // 실행 파일 경로는 wire에 나가지 않는다
    expect(JSON.stringify(report)).not.toContain('"path"');
    // ready는 필수 바이너리가 모두 쓸 수 있다는 뜻이고 blocking은 쓸 수 없는 필수의 이름이다
    const unusableRequired = report.items
      .filter((item) => item.need === "required" && item.status.kind !== "ok")
      .map((item) => item.name);
    expect(report.blocking.toSorted()).toEqual(unusableRequired.toSorted());
    expect(report.ready).toBe(unusableRequired.length === 0);
    const view = binaryViewOf(report);
    expect(view?.rows.map((row) => row.name).toSorted()).toEqual(
      report.items.map((item) => item.name).toSorted(),
    );
    expect(view?.ready).toBe(report.ready);
    // includeBinaries 없이는 점검하지 않는다
    const plain = await engine.request("host.status", {});
    expect(pick(plain, "result", "binaries")).toBeUndefined();
    await engine.shutdown({ message: true });
  }, 60_000);
});

describe("compiled sidecar binary", () => {
  withBinary(
    "gives the same normalized responses and events as the source entry (E2)",
    async () => {
      if (binary === null) return;
      const source = await start(SOURCE);
      const fromSource = await runScenario(source);
      await source.shutdown({ message: true });
      const compiled = await start([binary, "host", "--stdio"]);
      const fromBinary = await runScenario(compiled);
      expect(fromBinary.strayStdout).toEqual([]);
      expect(fromBinary.scopeCount).toBe(fromSource.scopeCount);
      expect(fromBinary.invalidated).toEqual(fromSource.invalidated);
      expect(fromBinary.responses).toEqual(fromSource.responses);
      expect(fromBinary.events).toEqual(fromSource.events);
      const exit = await compiled.shutdown({ message: true });
      expect(exit.code, compiled.stderr()).toBe(0);
    },
    120_000,
  );

  withBinary(
    "reports the same external tools as the source entry, without paths",
    async () => {
      if (binary === null) return;
      const source = reportOf(await binaryReportOf(await start(SOURCE)));
      const compiled = reportOf(await binaryReportOf(await start([binary, "host", "--stdio"])));
      // 상태(버전, bundled/system)는 기기와 번들에 달려 있으니 정적인 면만 견준다
      expect(compiled.platform).toBe(source.platform);
      expect(shape(compiled)).toEqual(shape(source));
      expect(JSON.stringify(compiled)).not.toContain('"path"');
    },
    120_000,
  );

  withBinary(
    "exits 0 on stdin EOF alone and leaves no process holding its home (E3)",
    async () => {
      if (binary === null) return;
      const compiled = await start([binary, "host", "--stdio"]);
      await runScenario(compiled);
      // host.shutdown 없이 EOF만: 셸이 비정상으로 사라졌을 때의 방어(E5)와 같은 경로다
      const exit = await compiled.shutdown({ message: false });
      expect(exit.code, compiled.stderr()).toBe(0);
      const left = processesWithHome(compiled.home);
      if (left !== null) expect(left).toEqual([]);
    },
    120_000,
  );

  withBinary(
    "answers host.shutdown, then exits 0 within the grace period (E3)",
    async () => {
      if (binary === null) return;
      const compiled = await start([binary, "host", "--stdio"]);
      await runScenario(compiled);
      const exit = await compiled.shutdown({ message: true });
      expect(exit.code, compiled.stderr()).toBe(0);
      // l0.process.shutdown.timeoutMs 기본 3000 ms 안이다
      expect(exit.ms).toBeLessThan(3000);
      const left = processesWithHome(compiled.home);
      if (left !== null) expect(left).toEqual([]);
    },
    120_000,
  );
});
