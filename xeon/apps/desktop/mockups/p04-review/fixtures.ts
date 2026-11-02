// P-04 변경 검토 고정 데이터. review_request 도구가 낸 changeset 하나(라운드 1, 파일 3, hunk 7).
// hunk 본문은 지금 wire에 없다(gap W-02, L2 artifacts.reviews.get의 HunkView가 필요). 여기 값은 그 모양을 따른 가짜다.
import type { CodeDiffKind } from "@caustic/react";

export type HunkDecision = "pending" | "approved" | "rejected";

export interface Line {
  kind: CodeDiffKind;
  n: number;
  text: string;
}

export interface Hunk {
  id: string;
  header: string;
  lines: Line[];
  decision: HunkDecision;
}

export interface ReviewFile {
  path: string;
  change: "M" | "A" | "D";
  binary?: boolean;
  /** 본문을 읽지 못한 파일(S4) */
  unreadable?: boolean;
  added: number;
  removed: number;
  hunks: Hunk[];
}

export interface Comment {
  id: string;
  file: string;
  hunk: string;
  /** 이 줄 다음에 붙는다(줄 의견). 없으면 hunk 의견. */
  afterLine?: number;
  text: string;
  /** 지난 라운드에 모델에 전달된 의견 */
  delivered?: boolean;
}

export const meta = {
  title: "캐시 만료 수정",
  round: 1,
  thread: "캐시 무효화 조사",
  /** 이 리뷰를 낸 쪽: review 도구(L2 artifacts)를 기본 에이전트의 모델이 불렀다 */
  source: "review 도구 · L2 artifacts",
  caller: "기본 에이전트",
};

export const files: ReviewFile[] = [
  {
    path: "src/cache.ts",
    change: "M",
    added: 12,
    removed: 5,
    hunks: [
      {
        id: "f0h0",
        header: "@@ -10,6 +10,7 @@ export function isExpired",
        decision: "approved",
        lines: [
          {
            kind: "context",
            n: 10,
            text: "export function isExpired(entry: Entry, ttl: number) {",
          },
          { kind: "context", n: 11, text: "  const now = Date.now()" },
          { kind: "remove", n: 12, text: "  return entry.at + ttl < now" },
          { kind: "add", n: 12, text: "  const ttlMs = ttl * 1000" },
          { kind: "add", n: 13, text: "  return entry.atMs + ttlMs < now" },
          { kind: "context", n: 14, text: "}" },
        ],
      },
      {
        id: "f0h1",
        header: "@@ -40,4 +42,7 @@ export function set",
        decision: "pending",
        lines: [
          {
            kind: "context",
            n: 42,
            text: "export function set(key: string, value: unknown, ttl = 60) {",
          },
          { kind: "add", n: 43, text: "  // ttl은 초 단위, 저장할 때 ms로 바꾼다" },
          { kind: "add", n: 44, text: "  const atMs = Date.now()" },
          { kind: "remove", n: 41, text: "  store.set(key, { value, at: Date.now(), ttl })" },
          { kind: "add", n: 45, text: "  store.set(key, { value, atMs, ttl })" },
          { kind: "context", n: 46, text: "}" },
        ],
      },
      {
        id: "f0h2",
        header: "@@ -88,3 +95,3 @@ function evict",
        decision: "rejected",
        lines: [
          { kind: "context", n: 94, text: "function evict(entry: Entry) {" },
          { kind: "remove", n: 88, text: "  log(entry)" },
          { kind: "add", n: 95, text: "  debug(entry)" },
          { kind: "context", n: 96, text: "  store.delete(entry.key)" },
        ],
      },
      {
        id: "f0h3",
        header: "@@ -120,2 +127,6 @@",
        decision: "pending",
        lines: [
          { kind: "context", n: 127, text: "export const size = () => store.size" },
          { kind: "add", n: 128, text: "" },
          { kind: "add", n: 129, text: "export function clear() {" },
          { kind: "add", n: 130, text: "  store.clear()" },
          { kind: "add", n: 131, text: "}" },
        ],
      },
    ],
  },
  {
    path: "test/expiry.test.ts",
    change: "A",
    added: 28,
    removed: 0,
    hunks: [
      {
        id: "f1h0",
        header: "@@ -0,0 +1,12 @@",
        decision: "approved",
        lines: [
          { kind: "add", n: 1, text: 'import { expect, test } from "bun:test"' },
          { kind: "add", n: 2, text: 'import { isExpired } from "../src/cache"' },
          { kind: "add", n: 3, text: "" },
          { kind: "add", n: 4, text: 'test("expires exactly at ttl", () => {' },
          { kind: "add", n: 5, text: '  const entry = { atMs: 0, key: "k" }' },
          { kind: "add", n: 6, text: "  expect(isExpired(entry, 1)).toBe(true)" },
          { kind: "add", n: 7, text: "})" },
        ],
      },
      {
        id: "f1h1",
        header: "@@ -0,0 +13,16 @@",
        decision: "pending",
        lines: [
          { kind: "add", n: 13, text: 'test("keeps entries inside ttl", () => {' },
          { kind: "add", n: 14, text: '  const entry = { atMs: Date.now(), key: "k" }' },
          { kind: "add", n: 15, text: "  expect(isExpired(entry, 60)).toBe(false)" },
          { kind: "add", n: 16, text: "})" },
        ],
      },
    ],
  },
  {
    path: "docs/cache.md",
    change: "M",
    added: 2,
    removed: 1,
    hunks: [
      {
        id: "f2h0",
        header: "@@ -8,3 +8,4 @@ ## 만료",
        decision: "pending",
        lines: [
          { kind: "context", n: 8, text: "## 만료" },
          { kind: "remove", n: 9, text: "ttl은 밀리초입니다." },
          { kind: "add", n: 9, text: "ttl은 초 단위로 받고, 내부에서는 밀리초로 저장해요." },
          { kind: "add", n: 10, text: "경계 시각(at + ttl)은 만료로 봐요." },
        ],
      },
    ],
  },
];

/** S4: 바이너리 파일과 본문을 읽지 못한 파일을 더한 목록 */
export const extraFiles: ReviewFile[] = [
  { path: "assets/cache-flow.png", change: "A", binary: true, added: 0, removed: 0, hunks: [] },
  { path: "src/store.ts", change: "M", unreadable: true, added: 3, removed: 3, hunks: [] },
];

export const comments: Comment[] = [
  {
    id: "c1",
    file: "src/cache.ts",
    hunk: "f0h1",
    afterLine: 43,
    text: "주석은 영어로 맞춰 주세요. 다른 파일과 같게요.",
  },
];

/** 라운드 2에서 접혀 보이는 지난 라운드 의견 */
export const deliveredComments: Comment[] = [
  {
    id: "d1",
    file: "src/cache.ts",
    hunk: "f0h1",
    text: "주석은 영어로 맞춰 주세요. 다른 파일과 같게요.",
    delivered: true,
  },
  {
    id: "d2",
    file: "src/cache.ts",
    hunk: "f0h2",
    text: "log를 debug로 바꾸지 말아 주세요. 운영 로그에 필요해요.",
    delivered: true,
  },
];

export const submitResult = {
  requestId: "rv-01JC8Q4M2T",
  deliverAs: "followUp",
  rows: [
    {
      path: "src/cache.ts",
      hunk: "f0h2",
      outcome: "되돌림",
      detail: "workspace_files",
      tone: "neutral",
    },
    {
      path: "docs/cache.md",
      hunk: "f2h0",
      outcome: "충돌",
      detail: "새 줄이 맞지 않아요. 파일을 열어 직접 고쳐 주세요.",
      tone: "danger",
    },
  ],
} as const;
