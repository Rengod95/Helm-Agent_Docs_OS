// M3-REQ-98 (M3b B5-PERF). 스킬 인덱스 블록을 만드는 시간, 예산 안에 싣는 스킬 수, 2글자 질의의 세션 LIKE 탐색 시간을 잰다.
// 실행(xeon/에서): bash ../scripts/guard.sh run -- bun packages/cap-knowledge/test/bench/index-budget.bench.ts
// 출력은 scripts/bench-server.ts의 줄 프로토콜이다. stdout에는 JSON 한 줄씩만 쓴다. 판정은 bench-server.ts와 bench-gate.ts가 한다.
// index_build 샘플은 호출 한 번의 평균 시간(ms)이다. 호출이 짧아 BUILD_CALLS번 부르고 나눈다. LIKE 샘플은 질의 한 번이다.
import { Bug } from "@xeon/contracts";
import type { SkillIndexEntry } from "@xeon/contracts/capabilities";
import { DEFAULT_KNOWLEDGE_SETTINGS } from "../../src/settings.ts";
import {
  buildSkillIndexBlock,
  truncateDescription,
  type SkillIndexOptions,
} from "../../src/skills/prompt-block.ts";
import { closeWorlds, createWorld, type World } from "../support/world.ts";

type Line =
  | { readonly metric: string; readonly unit: "ms"; readonly samples: readonly number[] }
  | {
      readonly metric: string;
      readonly unit: "count" | "chars";
      readonly value: number;
      readonly note: string;
    };

function emit(line: Line): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** 마이크로초 자리까지 남긴다. JSON이 부동소수 긴 꼬리를 싣지 않게 한다 */
function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const BUDGET_CHARS = DEFAULT_KNOWLEDGE_SETTINGS.skills.indexBudgetChars;
const DESCRIPTION_CHARS = DEFAULT_KNOWLEDGE_SETTINGS.skills.indexDescriptionChars;
const SHORT_DESCRIPTION_CHARS = 60;
// 빠진 스킬이 있을 때의 안내 문구는 knowledge_search를 가리키는 쪽으로 잰다. 광고 여부에 따라 usedChars가 수십 자 달라진다
const INDEX_OPTIONS: SkillIndexOptions = { searchTool: true };

const VERBS = [
  "review",
  "deploy",
  "write",
  "refactor",
  "debug",
  "migrate",
  "test",
  "lint",
  "document",
  "release",
  "monitor",
  "backup",
  "profile",
  "triage",
  "rebase",
  "scaffold",
  "audit",
  "onboard",
  "summarize",
  "translate",
];
const NOUNS = [
  "pull-requests",
  "api-client",
  "database",
  "changelog",
  "release-notes",
  "fixtures",
  "schema",
  "dependencies",
  "logs",
  "config",
  "docker-images",
  "migrations",
  "error-handling",
  "cli-output",
  "web-search",
  "ci-pipeline",
  "mcp-servers",
  "session-memory",
  "code-style",
  "security-scan",
];
const NAME_MIN = 12;
const NAME_MAX = 24;

/** 동사-명사 조합 가운데 12~24자인 이름을 앞에서부터 `count`개 쓴다. 조합이 모자라면 Bug다 */
function skillNames(count: number): string[] {
  const names = VERBS.flatMap((verb) => NOUNS.map((noun) => `${verb}-${noun}`)).filter(
    (name) => name.length >= NAME_MIN && name.length <= NAME_MAX,
  );
  if (names.length < count) {
    throw new Bug(
      `index-budget: ${String(names.length)} names fit the length rule, ${String(count)} asked`,
    );
  }
  return names.slice(0, count);
}

/** 호출자가 자르기 전의 원문 설명. 실제 스킬 설명처럼 예산보다 길다 */
function sourceDescription(name: string): string {
  const topic = name.replaceAll("-", " ");
  return `Use when a task needs the ${topic} procedure. Follow the checklist one step at a time, record each change in the thread, verify the result against the repository, and report what changed. Read the full body with skill_view before acting on any step.`;
}

/** 인덱스 항목. 설명은 호출자가 하듯 `truncateDescription`으로 자른다. 싣는 순서는 범위 순, 같은 범위에서는 이름 바이트 순이다 */
function indexEntries(count: number, descriptionChars: number): SkillIndexEntry[] {
  const entries = skillNames(count).map((name, index): SkillIndexEntry => {
    const description = truncateDescription(sourceDescription(name), descriptionChars);
    if (description.length !== descriptionChars) {
      throw new Bug(
        `index-budget: description of ${name} is ${String(description.length)} chars, not ${String(descriptionChars)}`,
      );
    }
    return {
      name,
      description,
      scope: "user",
      createdBy: "user",
      treeHash: index.toString(16).padStart(64, "0"),
      modelInvocable: true,
    };
  });
  return entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const BUILD_WARMUPS = 3;
const BUILD_RUNS = 30;
const BUILD_CALLS = 20;

/** 200개 항목으로 인덱스 블록을 만드는 호출 한 번의 시간. 샘플마다 호출 BUILD_CALLS번의 평균이다 */
function timeBuild(entries: readonly SkillIndexEntry[]): number[] {
  const expected = buildSkillIndexBlock(entries, BUDGET_CHARS, INDEX_OPTIONS).included.length;
  const samples: number[] = [];
  for (let run = 0; run < BUILD_WARMUPS + BUILD_RUNS; run += 1) {
    let fitted = 0;
    const started = performance.now();
    for (let call = 0; call < BUILD_CALLS; call += 1) {
      fitted += buildSkillIndexBlock(entries, BUDGET_CHARS, INDEX_OPTIONS).included.length;
    }
    const elapsed = performance.now() - started;
    // 결과를 버리지 않게 싣은 수를 확인한다. 측정 중 결과가 달라지면 측정이 아니다
    if (fitted !== expected * BUILD_CALLS) {
      throw new Bug("index-budget: the index block changed between runs");
    }
    if (run >= BUILD_WARMUPS) samples.push(elapsed / BUILD_CALLS);
  }
  return samples;
}

const FIT_COUNTS: readonly number[] = [10, 20, 40, 80, 200];
const FIT_VARIANTS: readonly { readonly chars: number; readonly suffix: string }[] = [
  { chars: DESCRIPTION_CHARS, suffix: "" },
  { chars: SHORT_DESCRIPTION_CHARS, suffix: "_desc60" },
];

/** 예산 안에 싣는 스킬 수. 값은 싣은 수, note에 쓴 글자 수와 빠진 수를 넣는다 */
function emitFit(): void {
  for (const variant of FIT_VARIANTS) {
    for (const count of FIT_COUNTS) {
      const block = buildSkillIndexBlock(
        indexEntries(count, variant.chars),
        BUDGET_CHARS,
        INDEX_OPTIONS,
      );
      emit({
        metric: `index_fit_${String(count)}_skills${variant.suffix}`,
        unit: "count",
        value: block.included.length,
        note: `usedChars=${String(block.usedChars)} omitted=${String(block.omitted)} limit=${String(BUDGET_CHARS)}`,
      });
    }
  }
}

const LIKE_DOCS = 20_000;
const LIKE_THREADS = 200;
const LIKE_QUERY = "검색";
// 질의 낱말은 가장 오래된 문서 다섯 개에만 있다. 최신순으로 훑다 한도를 채워 일찍 끝나지 못하게 해서 20000개를 전부 보는 경우를 잰다
const LIKE_MATCH_DOCS = 5;
const LIKE_WARMUPS = 2;
const LIKE_RUNS = 10;
const BASE_AT = Date.UTC(2026, 0, 1);
const MINUTE_MS = 60_000;

const WORDS = [
  "build",
  "config",
  "session",
  "message",
  "tool",
  "result",
  "error",
  "retry",
  "cache",
  "queue",
  "thread",
  "turn",
  "patch",
  "review",
  "fixture",
  "trace",
  "deploy",
  "logs",
  "merge",
  "branch",
  "빌드",
  "설정",
  "세션",
  "메시지",
  "도구",
  "결과",
  "오류",
  "재시도",
  "캐시",
  "대기열",
  "스레드",
  "패치",
  "리뷰",
  "추적",
  "배포",
  "로그",
  "병합",
  "브랜치",
];

function word(n: number): string {
  return WORDS[n % WORDS.length] ?? "";
}

/** 세션 문서 본문. 앞쪽 `LIKE_MATCH_DOCS`개 문서에만 질의 낱말을 넣는다 */
function docText(index: number): string {
  const count = 12 + (index % 13);
  const words = Array.from({ length: count }, (_, w) => word(index * 7 + w * 13));
  if (index < LIKE_MATCH_DOCS) words.push(LIKE_QUERY);
  return words.join(" ");
}

function threadId(n: number): string {
  return `thr-${String(n).padStart(3, "0")}`;
}

/**
 * 세션 문서를 색인 표에 직접 넣는다(setup, 측정 밖). 열은 `search/indexer.ts`의 `writeRows`가 쓰는 것과 같다.
 * 이벤트 저장소를 거치지 않으므로 20000번의 세션 커밋 대신 한 트랜잭션으로 끝난다.
 */
function seedSessions(world: World): void {
  const written = world.deps.db.write((tx) => {
    for (let t = 0; t < LIKE_THREADS; t += 1) {
      tx.run(
        "INSERT INTO cap_knowledge_sessions (thread_id, kind, project, title, created_at, last_at, messages) VALUES (?, 'main', 'xeon', ?, ?, ?, ?)",
        [
          threadId(t),
          `세션 ${String(t)}`,
          BASE_AT,
          BASE_AT + LIKE_DOCS * MINUTE_MS,
          LIKE_DOCS / LIKE_THREADS,
        ],
      );
    }
    for (let i = 0; i < LIKE_DOCS; i += 1) {
      const docId = i + 1;
      const thread = threadId(i % LIKE_THREADS);
      const text = docText(i);
      tx.run(
        "INSERT INTO cap_knowledge_sessiondocs (doc_id, event_id, thread_id, seq, event_seq, role, recorded_at, chars) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          docId,
          `evt-${String(docId)}`,
          thread,
          Math.floor(i / LIKE_THREADS) + 1,
          docId,
          i % 2 === 0 ? "user" : "assistant",
          BASE_AT + i * MINUTE_MS,
          Array.from(text).length,
        ],
      );
      tx.run("INSERT INTO cap_knowledge_sessionfts (rowid, thread_id, text) VALUES (?, ?, ?)", [
        docId,
        thread,
        text,
      ]);
    }
  });
  if (!written.ok)
    throw new Error(`index-budget: seeding the session tables failed: ${written.error.kind}`);
}

/** 실제 검색 서비스(`runtime.search.query`)의 세션 2글자 질의. 샘플 하나가 호출 하나다 */
async function timeLikeScan(world: World): Promise<number[]> {
  const runs = Array.from({ length: LIKE_WARMUPS + LIKE_RUNS }, (_, run) => run);
  return runs.reduce<Promise<number[]>>(async (previous, run) => {
    const done = await previous;
    const started = performance.now();
    const found = await world.runtime.search.query({ query: LIKE_QUERY, kinds: ["session"] });
    const elapsed = performance.now() - started;
    if (!found.ok) throw new Error(`index-budget: session query failed: ${found.error.kind}`);
    if (found.value.path !== "like" || found.value.hits.length === 0) {
      throw new Error(
        `index-budget: expected a non-empty like-path result, got ${found.value.path} with ${String(found.value.hits.length)} hits`,
      );
    }
    return run < LIKE_WARMUPS ? done : [...done, elapsed];
  }, Promise.resolve([]));
}

async function main(): Promise<void> {
  emit({
    metric: "index_build_200_skills",
    unit: "ms",
    samples: timeBuild(indexEntries(200, DESCRIPTION_CHARS)).map(ms),
  });
  emitFit();

  const world = await createWorld({ sessions: true });
  try {
    seedSessions(world);
    const samples = await timeLikeScan(world);
    emit({ metric: "like_scan_2char_20000_docs", unit: "ms", samples: samples.map(ms) });
  } finally {
    world.runtime.dispose();
    await closeWorlds();
  }
}

await main();
