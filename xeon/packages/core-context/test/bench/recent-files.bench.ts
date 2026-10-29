// M3-new-18 (M3b B5-PERF). 컴팩션 뒤 최근 파일 재주입(recentFileMessages)이 요약 뒤에 싣는 토큰 비용과 계산 시간을 잰다.
// 실행(xeon/에서): bash ../scripts/guard.sh run -- bun packages/core-context/test/bench/recent-files.bench.ts
// 출력은 scripts/bench-server.ts의 줄 프로토콜이다. stdout에는 JSON 한 줄씩만 쓴다. 판정은 bench-server.ts와 bench-gate.ts가 한다.
// 토큰 값은 추정치다. core-models의 createTokenEstimator가 위임하는 pi-ai 1.3.0 estimateMessageTokens의 사용자 메시지 식을 옮겼다:
// 본문 글자 수 / 3.5를 올림한 값(CHARS_PER_TOKEN). core-context는 core-models에 의존하지 않으므로 복제한다.
// 출처: packages/core-models/node_modules/@earendil-works/pi-ai/dist/utils/estimate.js. 모델 토크나이저의 값이 아니다.
// 재주입 본문은 글자만 있으므로 이미지 블록(4800자) 분기는 옮기지 않았다.
// compute 샘플 하나는 호출 COMPUTE_CALLS번의 평균 시간(ms)이다. 호출이 짧아 여러 번 부르고 나눈다.
import { Bug } from "@xeon/contracts";
import type {
  AssistantMessage,
  ItemRecord,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@xeon/contracts/conversation";
import { recentFileMessages } from "../../src/recent-files.ts";
import { DEFAULT_CONTEXT_SETTINGS } from "../../src/settings.ts";
import { assistantItem, userItem } from "../support/builders.ts";
import { memoryLog, type MemoryLog } from "../support/log.ts";

type Line =
  | { readonly metric: string; readonly unit: "ms"; readonly samples: readonly number[] }
  | {
      readonly metric: string;
      readonly unit: "tokens";
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

/** 시험이 쓰는 창 크기(test/support/builders.ts의 assembleOptions contextWindow)와 같다 */
const CONTEXT_WINDOW = 200_000;
const KEEP_RECENT = DEFAULT_CONTEXT_SETTINGS.keepRecentTokens;
/** 기본 재주입 개수. 메트릭 이름의 `5`가 여기서 온다 */
const COUNT = DEFAULT_CONTEXT_SETTINGS.reinjectRecentFiles;
const SIZES: readonly number[] = [2000, 8000, 16000, 40000];
const K_FILE_CHARS = 16_000;
const COUNTS: readonly number[] = [1, 3, 5, 10];
/** 한 실험에 쓰는 파일 수. 가장 큰 k(10)보다 많아서 기록된 마지막 k개를 고르게 한다 */
const FILES = 12;

/** 2000개 항목 분기: 읽기 50개를 40항목 간격으로 놓고 앞쪽 38개가 접힌 범위에 든다 */
const LONG_ITEMS = 2000;
const LONG_READS = 50;
const LONG_STRIDE = 40;
const LONG_FIRST_KEPT = 1500;

const COMPUTE_WARMUPS = 3;
const COMPUTE_RUNS = 30;
const COMPUTE_CALLS = 20;

// core-models 추정과 같은 식(CHARS_PER_TOKEN). 사용자 메시지 한 개를 본문 글자 수로 센다
const CHARS_PER_TOKEN = 3.5;

const USAGE: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface ReadSpec {
  readonly path: string;
  readonly chars: number;
}

interface Branch {
  readonly items: readonly ItemRecord[];
  readonly firstKeptIndex: number;
}

function textOf(message: UserMessage): string {
  const { content } = message;
  return typeof content === "string"
    ? content
    : content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function estimateUserTokens(message: UserMessage): number {
  return Math.ceil(textOf(message).length / CHARS_PER_TOKEN);
}

function share(part: number, whole: number): string {
  return ((part / whole) * 100).toFixed(2);
}

function sizeOf(index: number): number {
  const size = SIZES[index % SIZES.length];
  if (size === undefined) throw new Bug("recent-files bench: the size table is empty");
  return size;
}

/** 파일 `count`개를 서로 다른 경로로 만든다. 본문 크기는 `chars`가 정한다 */
function readsOf(count: number, chars: (index: number) => number): ReadSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/module-${String(index).padStart(2, "0")}.ts`,
    chars: chars(index),
  }));
}

/** 글자 수가 정확히 `chars`인 소스 같은 본문 */
function bodyOf(path: string, chars: number): string {
  const unit = `// ${path}: source line of the bench body\n`;
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

/** 읽기 호출 하나와 그 결과 하나. 결과는 `timestamp`에 기록된다 */
function readPair(log: MemoryLog, read: ReadSpec, timestamp: number): [ItemRecord, ItemRecord] {
  const callId = log.ids.next("itm");
  const call: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: read.path } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage: USAGE,
    stopReason: "toolUse",
    timestamp: 2,
  };
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: bodyOf(read.path, read.chars) }],
    isError: false,
    timestamp,
  };
  return [
    {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: call,
      partIds: [],
    },
    {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "toolResult",
      message: result,
      effectId: null,
    },
  ];
}

function filler(log: MemoryLog, index: number): ItemRecord {
  const text = `note ${String(index)}`;
  return index % 2 === 0 ? userItem(log, text).item : assistantItem(log, text).item;
}

/**
 * 읽기 쌍을 `stride`항목 간격으로 앞에서부터 놓고 나머지는 여백 항목으로 채운다. 총 `total`개,
 * `firstKeptIndex` 이후가 남는 범위다
 */
function branchOf(
  log: MemoryLog,
  reads: readonly ReadSpec[],
  stride: number,
  total: number,
  firstKeptIndex: number,
): Branch {
  const items: ItemRecord[] = [];
  for (const [index, read] of reads.entries()) {
    while (items.length < index * stride) items.push(filler(log, items.length));
    items.push(...readPair(log, read, 10 + index));
  }
  while (items.length < total) items.push(filler(log, items.length));
  if (items.length !== total) {
    throw new Bug(`recent-files bench: ${String(items.length)} items, ${String(total)} planned`);
  }
  return { items, firstKeptIndex };
}

/** 읽기 쌍 사이에 빈 항목이 없는 짧은 분기. 접힌 범위는 읽기 쌍 전부다 */
function shortBranch(log: MemoryLog, reads: readonly ReadSpec[]): Branch {
  return branchOf(log, reads, 2, 2 * reads.length + 2, 2 * reads.length);
}

/** 재주입된 메시지가 기록 순서대로 마지막 `count`개 파일인지 본다. 어긋나면 측정이 아니라 버그다 */
function checkReinjected(
  messages: readonly UserMessage[],
  reads: readonly ReadSpec[],
  count: number,
): void {
  const expected = reads.slice(reads.length - count);
  if (messages.length !== expected.length) {
    throw new Bug(
      `recent-files bench: ${String(messages.length)} messages for ${String(count)} files`,
    );
  }
  messages.forEach((message, index) => {
    const read = expected[index];
    if (
      read === undefined ||
      !textOf(message).startsWith(`[File re-injected after compaction: ${read.path}]\n`)
    ) {
      throw new Bug(`recent-files bench: message ${String(index)} is not the expected file`);
    }
  });
}

function emitReinject(metric: string, messages: readonly UserMessage[]): void {
  const tokens = messages.reduce((sum, message) => sum + estimateUserTokens(message), 0);
  const chars = messages.reduce((sum, message) => sum + textOf(message).length, 0);
  emit({
    metric,
    unit: "tokens",
    value: tokens,
    note: `chars=${String(chars)} share_of_200k_window=${share(tokens, CONTEXT_WINDOW)}% share_of_keepRecentTokens=${share(tokens, KEEP_RECENT)}%`,
  });
}

/** 호출 한 번의 시간. 샘플마다 호출 COMPUTE_CALLS번의 평균이다. 결과 개수를 세어 버려지지 않게 한다 */
function timeCompute(branch: Branch): number[] {
  const samples: number[] = [];
  for (let run = 0; run < COMPUTE_WARMUPS + COMPUTE_RUNS; run += 1) {
    let returned = 0;
    const started = performance.now();
    for (let call = 0; call < COMPUTE_CALLS; call += 1) {
      returned += recentFileMessages(branch.items, branch.firstKeptIndex, COUNT).length;
    }
    const elapsed = performance.now() - started;
    if (returned !== COUNT * COMPUTE_CALLS) {
      throw new Bug(
        "recent-files bench: the compute branch returned a different count between runs",
      );
    }
    if (run >= COMPUTE_WARMUPS) samples.push(elapsed / COMPUTE_CALLS);
  }
  return samples;
}

function main(): void {
  const log = memoryLog();

  // 1. 파일 본문 크기별로 기본 개수만큼 재주입하는 토큰 비용. 40000자 파일은 16000자에서 잘린다
  for (const chars of SIZES) {
    const reads = readsOf(FILES, () => chars);
    const branch = shortBranch(log, reads);
    const messages = recentFileMessages(branch.items, branch.firstKeptIndex, COUNT);
    checkReinjected(messages, reads, COUNT);
    emitReinject(`reinject_tokens_${String(COUNT)}_files_${String(chars)}`, messages);
  }

  // 2. 본문 16000자 파일을 개수 k개로 바꾼 토큰 비용
  const reads16 = readsOf(FILES, () => K_FILE_CHARS);
  const branch16 = shortBranch(log, reads16);
  for (const count of COUNTS) {
    const messages = recentFileMessages(branch16.items, branch16.firstKeptIndex, count);
    checkReinjected(messages, reads16, count);
    emitReinject(`reinject_tokens_${String(count)}_files_${String(K_FILE_CHARS)}`, messages);
  }

  // 3. 항목 2000개, 읽기 50개인 분기에서 기본 개수를 고르는 시간
  const longReads = readsOf(LONG_READS, sizeOf);
  const long = branchOf(log, longReads, LONG_STRIDE, LONG_ITEMS, LONG_FIRST_KEPT);
  const folded = longReads.slice(0, Math.ceil(LONG_FIRST_KEPT / LONG_STRIDE));
  checkReinjected(recentFileMessages(long.items, long.firstKeptIndex, COUNT), folded, COUNT);
  emit({
    metric: "recent_files_compute_2000_items",
    unit: "ms",
    samples: timeCompute(long).map(ms),
  });
}

main();
