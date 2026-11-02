// P-06 제안 고정 데이터(ProposalRowVM 모양). 제안은 L3 learning 그룹과 L2 knowledge 기능이 낸다.
// 행마다 낸 쪽(그룹·기능 이름과 id)과, knowledge 제안이면 그 근거가 된 Helm 발견을 함께 둔다.
import type { CodeDiffKind } from "@caustic/react";

export type ProposalStatus = "pending" | "applied" | "rejected";

export interface Proposal {
  id: string;
  kind: string;
  target: string;
  source: { name: string; id: string; via?: string };
  status: ProposalStatus;
  evidence: number;
  at: string;
  revision: number;
  afterUntrusted?: boolean;
  conflictsWith?: { name: string; owner: string };
  scopeChoice?: boolean;
  rationale: string;
  file: string;
  diff: { kind: CodeDiffKind; n: number; text: string }[];
}

export const proposals: Proposal[] = [
  {
    id: "p1",
    kind: "스킬 생성",
    target: "cache-debug",
    source: { name: "learning 그룹", id: "grp:learning" },
    status: "pending",
    evidence: 4,
    at: "1일 전",
    revision: 2,
    afterUntrusted: true,
    scopeChoice: true,
    rationale: "세 대화에서 캐시 만료 디버깅을 같은 순서로 반복했어요.",
    file: "skills/cache-debug/SKILL.md",
    diff: [
      { kind: "add", n: 1, text: "---" },
      { kind: "add", n: 2, text: "name: cache-debug" },
      { kind: "add", n: 3, text: "description: 캐시 만료가 어긋날 때 원인을 좁힌다" },
      { kind: "add", n: 4, text: "---" },
      { kind: "add", n: 5, text: "" },
      { kind: "add", n: 6, text: "1. ttl과 저장 시각의 단위를 먼저 확인한다 (초/ms)." },
      { kind: "add", n: 7, text: "2. 경계 시각(at + ttl)에서 만료되는지 테스트를 쓴다." },
      { kind: "add", n: 8, text: "3. 캐시를 비우고 테스트를 다시 돌린다." },
      { kind: "add", n: 9, text: "4. 고친 뒤 docs의 단위 표기를 맞춘다." },
    ],
  },
  {
    id: "p2",
    kind: "메모리 추가",
    target: "user",
    source: { name: "learning 그룹", id: "grp:learning" },
    status: "pending",
    evidence: 2,
    at: "1일 전",
    revision: 1,
    rationale: "커밋 메시지는 한국어 해요체로 써 달라고 두 번 고쳐 주셨어요.",
    file: "memory/user.md",
    diff: [
      { kind: "context", n: 11, text: "- 테스트는 bun test로 돌린다." },
      { kind: "add", n: 12, text: "- 커밋 메시지는 한국어 해요체로 쓴다." },
    ],
  },
  {
    id: "p3",
    kind: "스킬 수정",
    target: "bun-test",
    source: { name: "knowledge 기능", id: "L2 knowledge", via: "Helm 발견 #2" },
    status: "pending",
    evidence: 3,
    at: "2일 전",
    revision: 1,
    conflictsWith: { name: "test-runner", owner: "ext:bun-kit" },
    rationale:
      "Helm 탐구에서 bun test가 캐시를 지우지 않으면 오래된 결과를 낸다는 발견이 나왔어요.",
    file: "skills/bun-test/SKILL.md",
    diff: [
      { kind: "context", n: 4, text: "## 실행" },
      { kind: "remove", n: 5, text: "bun test 로 전체를 돌린다." },
      { kind: "add", n: 5, text: "rm -rf .cache 후 bun test 로 전체를 돌린다." },
      { kind: "add", n: 6, text: "실패가 이상하면 --rerun-each 3 으로 흔들림을 본다." },
    ],
  },
  {
    id: "p4",
    kind: "피드백",
    target: "style",
    source: { name: "learning 그룹", id: "grp:learning" },
    status: "applied",
    evidence: 5,
    at: "3일 전",
    revision: 1,
    rationale: "답이 길다는 피드백이 다섯 번 있었어요.",
    file: "feedback/style.md",
    diff: [{ kind: "add", n: 3, text: "- 답은 짧게, 표보다 목록을 먼저 쓴다." }],
  },
  {
    id: "p5",
    kind: "스킬 생성",
    target: "release-notes",
    source: { name: "learning 그룹", id: "grp:learning" },
    status: "rejected",
    evidence: 1,
    at: "5일 전",
    revision: 1,
    rationale: "릴리스 노트를 한 번 정리했어요.",
    file: "skills/release-notes/SKILL.md",
    diff: [{ kind: "add", n: 1, text: "name: release-notes" }],
  },
];

export const STATUS_WORD: Record<ProposalStatus, string> = {
  pending: "대기",
  applied: "적용됨",
  rejected: "거절함",
};
