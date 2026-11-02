// P-02 고유 고정 데이터(트랜스크립트). 공용 데이터는 ../_shell/fixtures.ts. 스펙 §8.2 값을 그대로 쓴다.
export * from "../_shell/fixtures";

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | {
      kind: "tool";
      name: string;
      detail: string;
      status: "failed" | "done";
      duration: string;
      output?: string;
    }
  | { kind: "thinking"; text: string }
  | { kind: "approval"; id: string; approval: "tool" | "question" }
  | { kind: "streaming"; text: string };

export const transcript: TranscriptItem[] = [
  { kind: "user", text: "무효화 테스트가 계속 실패해. 원인 찾아줘" },
  { kind: "agent", text: "먼저 실패하는 테스트를 돌려 볼게요." },
  {
    kind: "tool",
    name: "bash",
    detail: "bun test cache",
    status: "failed",
    duration: "1.2s",
    output: "FAIL test/cache.test.ts > expires after ttl\n  expected true, received false",
  },
  { kind: "tool", name: "read", detail: "src/cache.ts", status: "done", duration: "40ms" },
  {
    kind: "thinking",
    text: "만료 시각 비교에 초와 밀리초가 섞여 있어요. set은 초, isExpired는 밀리초로 비교해요.",
  },
  {
    kind: "agent",
    text: "원인을 찾았어요. `ttl`은 초 단위인데 `isExpired`가 밀리초로 비교해요. 캐시를 지우고 테스트를 다시 돌려 확인할게요.",
  },
  { kind: "approval", id: "a1", approval: "tool" },
  { kind: "streaming", text: "승인을 기다리는 동안 수정안을 정리하고 있어요" },
];
