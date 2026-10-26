import { arch, platform } from "node:os";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type EngineProcess, HELLO, type Message, processesWithHome } from "./harness.ts";

// 모델 없이 돌릴 수 있는 요청열(G4-03). 컴파일 바이너리에는 테이프 모델을 넣을 길이 없어서(모델은 조립 때 정해진다) turn은 돌리지 않고,
// wire의 나머지 표면(hello, 구독, thread, 설정, 비밀 목록, 승인 목록, 신뢰, 명령 목록)이 같은 바이트열을 내는지를 본다.
// turn의 CLI 대 사이드카 같은 메시지열은 in-process와 stdio(같은 프로세스 쌍)를 견주는 apps/host의 transport-parity 시험이 맡는다.

const DESKTOP = join(import.meta.dir, "..", "..");
export const CLI_MAIN: string = join(DESKTOP, "..", "cli", "src", "main.ts");

const TRIPLES: Readonly<Record<string, string>> = {
  "linux/x64": "x86_64-unknown-linux-gnu",
  "linux/arm64": "aarch64-unknown-linux-gnu",
  "darwin/x64": "x86_64-apple-darwin",
  "darwin/arm64": "aarch64-apple-darwin",
};

/** 이 기기의 사이드카 바이너리 경로. 빌드하지 않았으면 null이다(`just desktop-sidecar host`) */
export function sidecarPath(): string | null {
  const triple = TRIPLES[`${platform()}/${arch()}`];
  if (triple === undefined) return null;
  const path = join(DESKTOP, "src-tauri", "binaries", `xeon-${triple}`);
  return existsSync(path) ? path : null;
}

// ── 정규화 ───────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z]{3,4}_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * 식별자를 처음 나온 순서의 번호로, 시각과 프로세스 값을 고정 문자열로 바꾼다. `roots`(엔진 홈과 그 정규 경로)로 시작하는 경로는
 * 앞부분을 `<home>`으로 바꾼다: `trust.get`의 `projectRoot`와 `thread.list`의 `workspace`는 실행마다 다른 임시 폴더를 담는다.
 */
export function normalizer(roots: readonly string[] = []): (value: unknown) => unknown {
  const seen = new Map<string, string>();
  function walk(value: unknown, key: string | undefined): unknown {
    if (typeof value === "string") {
      for (const root of roots) {
        if (value === root) return "<home>";
        if (value.startsWith(`${root}/`)) return `<home>${value.slice(root.length)}`;
      }
    }
    if (typeof value === "string" && ID_PATTERN.test(value)) {
      const known = seen.get(value);
      if (known !== undefined) return known;
      const next = `${value.slice(0, value.indexOf("_"))}#${String(seen.size + 1)}`;
      seen.set(value, next);
      return next;
    }
    if (key !== undefined && /(At|Since)$/.test(key) && typeof value === "string") return "time";
    if (key !== undefined && /(At|Ms|^pid)$/.test(key) && typeof value === "number") return 0;
    if (Array.isArray(value)) return value.map((item: unknown) => walk(item, undefined));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name)]),
      );
    }
    return value;
  }
  return (value) => walk(value, undefined);
}

// ── 순서 경합을 시간이 아닌 조건으로 닫는다 ──────────────────────────────

function eventsOf(message: Message): readonly Message[] {
  const params = message["params"];
  if (typeof params !== "object" || params === null) return [];
  const events: unknown = Reflect.get(params, "events");
  return Array.isArray(events)
    ? events.filter((e: unknown): e is Message => typeof e === "object" && e !== null)
    : [];
}

export function allEvents(engine: EngineProcess): readonly Message[] {
  return engine.notifications
    .filter((n) => n["method"] === "events.batch")
    .flatMap(eventsOf)
    .toSorted((a, b) => Number(a["seq"]) - Number(b["seq"]));
}

/**
 * thread를 열면 기본 켜짐 scope의 켜기는 다음 유휴 경계에서 한 번의 커밋(`scope.changed` 묶음)으로 남는다(X.primitives boundary.ts
 * `applyIdleOnce`). 그 커밋이 뒤따르는 입력(`input.queued`)보다 먼저 들어가는지는 시간에 달려 있다(G4-03: 60ms 대기가 이 경합을 가렸다).
 * 시간을 기다리는 대신 이 커밋의 첫 `scope.changed`가 구독으로 도착하기를 기다린다. 커밋은 원자적이라 첫 이벤트가 오면 묶음 전체가 와 있고,
 * 같은 seq 구간의 `scope.changed`가 이어지는지(끊김이 없는지) 확인한 개수를 돌려준다.
 */
export async function untilScopesCommitted(engine: EngineProcess, threads = 1): Promise<number> {
  const threadsWithScopes = (): Set<unknown> =>
    new Set(
      allEvents(engine)
        .filter((event) => event["kind"] === "scope.changed")
        .map((event) => event["threadId"]),
    );
  await engine.waitFor(`the scope.changed commit of ${String(threads)} thread(s)`, () => {
    return threadsWithScopes().size >= threads;
  });
  const scopes = allEvents(engine).filter((event) => event["kind"] === "scope.changed");
  // 한 thread의 켜기는 한 커밋이라 그 thread의 scope.changed는 seq가 끊기지 않는다
  for (const thread of threadsWithScopes()) {
    const seqs = scopes
      .filter((event) => event["threadId"] === thread)
      .map((event) => Number(event["seq"]));
    const first = seqs[0] ?? 0;
    if (!seqs.every((seq, index) => seq === first + index)) {
      throw new Error(`scope.changed events are not one contiguous commit: ${seqs.join(",")}`);
    }
  }
  return scopes.length;
}

// ── 요청열 ───────────────────────────────────────────────────────────────

const MODEL_KEY = "l1.models.default";

export type ScenarioRun = {
  readonly responses: readonly unknown[];
  readonly events: readonly unknown[];
  readonly scopeCount: number;
  /** 받은 `settings.invalidated` 알림의 params */
  readonly invalidated: readonly unknown[];
  readonly strayStdout: readonly string[];
  readonly home: string;
};

/** 응답 메시지의 result 필드 하나. 오류 응답이면 undefined */
export function resultField(reply: Message, field: string): unknown {
  const result = reply["result"];
  return typeof result === "object" && result !== null ? Reflect.get(result, field) : undefined;
}

/** 신뢰 판정의 선택지 중 "이 폴더 신뢰"(저장하는 허용). 데스크톱 신뢰 카드의 주 버튼과 같은 선택이다 */
function trustFolderChoice(trust: Message): unknown {
  const options = resultField(trust, "options");
  if (!Array.isArray(options)) return undefined;
  const picked: unknown = options.find(
    (option: unknown) =>
      typeof option === "object" &&
      option !== null &&
      Reflect.get(option, "label") === "trust-folder",
  );
  return typeof picked === "object" && picked !== null ? Reflect.get(picked, "choice") : undefined;
}

function keysOf(notification: Message): readonly unknown[] {
  const params = notification["params"];
  const keys: unknown =
    typeof params === "object" && params !== null ? Reflect.get(params, "keys") : undefined;
  return Array.isArray(keys) ? keys : [];
}

function threadIdOf(reply: Message): string {
  const threadId = resultField(reply, "threadId");
  if (typeof threadId !== "string") throw new Error("thread.create did not return a threadId");
  return threadId;
}

/**
 * 같은 요청열을 보내고 정규화한 응답과 이벤트열을 모은다. 종료는 호출자가 한다.
 * 데스크톱이 보내는 값을 그대로 쓴다: `thread.create { workspace }`(작업 폴더), `trust.get`/`trust.decide`(신뢰 카드),
 * `command.list { threadId }`. 작업 폴더는 홈 아래의 프로젝트 폴더이고 신뢰가 필요한 자원(`.xeon/skills`)을 하나 갖는다.
 */
export async function runScenario(engine: EngineProcess): Promise<ScenarioRun> {
  const project = join(engine.home, "project");
  mkdirSync(join(project, ".xeon", "skills"), { recursive: true });
  const normalize = normalizer([engine.home, realpathSync(engine.home)]);
  const responses: unknown[] = [];
  const ask = async (method: string, params: unknown): Promise<Message> => {
    const reply = await engine.request(method, params);
    responses.push(normalize({ method, reply }));
    return reply;
  };
  await ask("host.hello", HELLO);
  await ask("events.subscribe", { from: "head" });
  const threadId = threadIdOf(await ask("thread.create", { title: "e2e" }));
  await untilScopesCommitted(engine, 1);
  await ask("thread.list", {});
  await ask("thread.read", { threadId });
  await ask("settings.get", { keys: ["l1.models.default", "l4.cli.theme"] });
  await ask("approval.list", { threadId });
  await ask("secret.list", {});
  await ask("trust.get", { workspace: engine.home });
  await ask("command.list", {});
  await ask("host.status", {});

  // 작업 폴더를 고른 새 대화(G2-02): 상대 경로와 없는 폴더는 대화를 만들지 않는다
  await ask("thread.create", { workspace: "relative/dir" });
  await ask("thread.create", { workspace: join(engine.home, "no-such-folder") });
  const inProject = threadIdOf(await ask("thread.create", { workspace: project }));
  const scopeCount = await untilScopesCommitted(engine, 2);
  await ask("thread.list", {});
  // 신뢰 카드(G1-03): 결정이 없는 프로젝트를 읽고, 선택지 중 "이 폴더 신뢰"를 보내고, 저장된 판정을 다시 읽는다
  const before = await ask("trust.get", { workspace: project });
  const choice = trustFolderChoice(before);
  if (choice === undefined) throw new Error("trust.get gave no trust-folder option");
  await ask("trust.decide", { workspace: project, choice });
  await ask("trust.get", { workspace: project });
  await ask("command.list", { threadId: inProject });

  // 설정 화면(G2-08): 기본 모델을 저장하면 연결 전체가 settings.invalidated를 받고, 다시 읽으면 저장한 값이 나온다.
  // 사이드카에는 키 값을 받을 수단이 없어 secret.beginEntry는 시작하지 않는다(started: false, HS-44)
  await ask("settings.set", {
    key: MODEL_KEY,
    value: "anthropic/claude-sonnet-5-5",
    scope: "user",
  });
  await engine.waitFor("settings.invalidated for the model key", (all) =>
    all.some((n) => n["method"] === "settings.invalidated" && keysOf(n).includes(MODEL_KEY)),
  );
  await ask("settings.get", { keys: [MODEL_KEY] });
  await ask("secret.beginEntry", { name: "anthropic-api-key", action: "add" });
  return {
    responses,
    events: allEvents(engine).map((event) => normalize(event)),
    scopeCount,
    invalidated: engine.notifications
      .filter((n) => n["method"] === "settings.invalidated")
      .map((n) => normalize(n["params"])),
    strayStdout: engine.strayStdout,
    home: engine.home,
  };
}

/** 데스크톱 설정 화면이 보내는 `host.status { includeBinaries: true }`의 `binaries`. hello 뒤에 부른다 */
export async function binaryReportOf(engine: EngineProcess): Promise<unknown> {
  await engine.request("host.hello", HELLO);
  return resultField(await engine.request("host.status", { includeBinaries: true }), "binaries");
}

/** 정규화한 응답열에서 메서드의 n번째 응답 프레임(`reply`)을 꺼낸다 */
export function nthReply(responses: readonly unknown[], method: string, n: number): unknown {
  const matching = responses.filter(
    (entry) =>
      typeof entry === "object" && entry !== null && Reflect.get(entry, "method") === method,
  );
  const entry: unknown = matching[n];
  return typeof entry === "object" && entry !== null ? Reflect.get(entry, "reply") : undefined;
}

export { processesWithHome };
