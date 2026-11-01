// 블록 구성기 고정 데이터. Helm 값은 L3.helm.spec(§3.1 매니페스트, §3.5 신호, §3.6 렌즈, §4.2 전이표, §4.6 쓰기 거부,
// §3.8 지식 소비, §3.4 레코드, §6 설정)을 그대로 옮겼다. lens-review는 사용자가 Helm을 복제해 고치는 새 그룹(wb2 시안과 같은 이름).
// 블록 = 그룹 안 코드 한 덩어리(지점 핸들러, drive, 레코드 쓰기)를 확장 지점과 연산(on·post·drive·scope)으로 묶은 설계 단위다.
// 런타임에는 블록이 없다: 매니페스트(points, optional, recordKinds)와 setup 코드로 풀린다(SPEC.md "런타임 표현 간극").
import sampleImports from "./sample-imports.txt?raw";

export type Op = "on" | "post" | "drive" | "scope" | "record";
export type SlotKind =
  | "scope"
  | "signal"
  | "lens"
  | "drive"
  | "guard"
  | "consume"
  | "record"
  | "restore";
export type Fold = "tap" | "first" | "chain" | "collect";

export interface PointUse {
  point: string;
  fold: Fold;
  /** 실패 규칙(F.extensions §3.4 실패 열) */
  failure: "open" | "closed" | "skip";
}

export interface CapPort {
  /** 능력 id(L2 spec 이름) */
  cap: string;
  mode: "optional" | "requires";
  /** 이 맥락에서 provider. null이면 없음 */
  provider: string | null;
  /** 저하 동작 등 짧은 메모 */
  note?: string;
}

export interface OutPort {
  id: string;
  label: string;
  /** 오른쪽 열 대상 포트 */
  to: string;
}

export interface Block {
  id: string;
  slot: SlotKind;
  title: string;
  op: Op;
  points: PointUse[];
  consumes: CapPort[];
  produces: OutPort[];
  /** 한두 줄 요약(tertiary) */
  lines: string[];
  /** 검사 결과(인라인) */
  issue?: { level: "error" | "warning"; code: string; text: string };
  /** 생성 코드 위치(코드 보기 강조) */
  code: { file: string; from: number; to: number };
}

export const SLOT_LABEL: Record<SlotKind, string> = {
  scope: "그룹(scope)",
  signal: "신호 감지",
  lens: "주입·렌즈",
  drive: "단계 머신(drive)",
  guard: "가드",
  consume: "능력 소비",
  record: "기록",
  restore: "상태 복원",
};

// ── Helm: 참고 구성(설치된 그룹에서 읽음, 읽기 전용) ─────────────────────────────

export const helmScope = {
  name: "helm",
  meta: "L3 · group · user · 0.1.0",
  state: "HelmState v1 · 60 KiB 예산",
  settings: "ext.helm.autoStart suggest · maxLenses 3 · writeGuard 켬",
  limits: { maxTurns: 4, maxSpawns: 8, maxTokens: 400000 },
};

export const helmBlocks: Block[] = [
  {
    id: "signal",
    slot: "signal",
    title: "신호 감지",
    op: "on",
    points: [
      { point: "tool.execution.after", fold: "tap", failure: "open" },
      { point: "boundary.settle.after", fold: "tap", failure: "open" },
    ],
    consumes: [],
    produces: [
      { id: "signal-rec", label: "signal.detected", to: "rec-signal" },
      { id: "signal-post", label: "제안 post", to: "q-post" },
    ],
    lines: ["stuck 오류 3번 · repeat 같은 호출 3번 · newDomain 빈 검색 2번 → pending"],
    code: { file: "src/index.ts", from: 9, to: 11 },
  },
  {
    id: "lens",
    slot: "lens",
    title: "렌즈 주입",
    op: "on",
    points: [{ point: "input.agent.before", fold: "collect", failure: "open" }],
    consumes: [],
    produces: [],
    lines: ["렌즈 6개 중 신호 순서로 3개 · 단계 블록은 한 번에 하나"],
    code: { file: "src/index.ts", from: 12, to: 12 },
  },
  {
    id: "drive",
    slot: "drive",
    title: "단계 머신",
    op: "drive",
    points: [],
    consumes: [{ cap: "loop.spawn explorer", mode: "requires", provider: "agents" }],
    produces: [{ id: "drive-state", label: "commit", to: "st-doc" }],
    lines: [
      "diverge → explore → converge → apply",
      "턴 4 · spawn 8 · 토큰 400k · 경계마다 다시 호출",
    ],
    code: { file: "src/index.ts", from: 15, to: 25 },
  },
  {
    id: "guard",
    slot: "guard",
    title: "쓰기 거부",
    op: "on",
    points: [{ point: "tool.call.before", fold: "first", failure: "closed" }],
    consumes: [],
    produces: [],
    lines: ["diverge·explore에서 main, subagent:explorer의 write·exec를 막아요"],
    code: { file: "src/index.ts", from: 13, to: 14 },
  },
  {
    id: "consume",
    slot: "consume",
    title: "지식 소비",
    op: "drive",
    points: [],
    consumes: [
      { cap: "web.search", mode: "optional", provider: "web-exa", note: "없으면 건너뜀" },
      { cap: "knowledge.search", mode: "optional", provider: "knowledge" },
      { cap: "knowledge.skills", mode: "optional", provider: "knowledge" },
      { cap: "knowledge.memory", mode: "optional", provider: "knowledge" },
    ],
    produces: [],
    lines: ["converge에서 읽기만 · 출처별 저하"],
    code: { file: "src/index.ts", from: 19, to: 20 },
  },
  {
    id: "record",
    slot: "record",
    title: "발견 기록",
    op: "record",
    points: [],
    consumes: [{ cap: "work.tasks", mode: "optional", provider: "work", note: "멱등 쓰기" }],
    produces: [
      { id: "rec-disc-out", label: "discovery.recorded", to: "rec-disc" },
      { id: "rec-fin-out", label: "inquiry.finished", to: "rec-fin" },
    ],
    lines: ["apply 끝에 발견 1건씩 · findingId로 중복 제거"],
    code: { file: "src/index.ts", from: 21, to: 23 },
  },
  {
    id: "restore",
    slot: "restore",
    title: "상태 복원",
    op: "on",
    points: [{ point: "session.start", fold: "tap", failure: "open" }],
    consumes: [],
    produces: [],
    lines: [],
    code: { file: "src/index.ts", from: 26, to: 26 },
  },
];

/** 왼쪽 열: 이 맥락(캐시 무효화 조사)에서 능력을 주는 확장 */
export interface Provider {
  id: string;
  name: string;
  layer: "L1" | "L2";
  meta: string;
  caps: { cap: string; off?: boolean }[];
}
export const providers: Provider[] = [
  {
    id: "agents",
    name: "agents",
    layer: "L1",
    meta: "builtin",
    caps: [{ cap: "loop.spawn explorer" }],
  },
  {
    id: "web-exa",
    name: "web-exa",
    layer: "L2",
    meta: "user · 1.0.3",
    caps: [{ cap: "web.search" }],
  },
  {
    id: "knowledge",
    name: "knowledge",
    layer: "L2",
    meta: "builtin",
    caps: [{ cap: "knowledge.search" }, { cap: "knowledge.skills" }, { cap: "knowledge.memory" }],
  },
  { id: "work", name: "work", layer: "L2", meta: "builtin · 0.4.0", caps: [{ cap: "work.tasks" }] },
];

/** 오른쪽 열: 블록이 내는 것(F 기록, 입력 큐, 상태 문서) */
export const outputsFor = (g: string) => [
  {
    id: "records",
    title: "공개 기록",
    meta: "F records",
    ports: [
      { id: "rec-signal", label: `grp.${g}.signal.detected` },
      { id: "rec-disc", label: `grp.${g}.discovery.recorded` },
      { id: "rec-fin", label: `grp.${g}.inquiry.finished` },
    ],
    foot: "읽는 쪽 L4 상태 표시 · 다른 그룹은 readsRecordKinds로",
  },
  {
    id: "queue",
    title: "입력 큐",
    meta: "post",
    ports: [{ id: "q-post", label: "제안 · 종료 알림" }],
    foot: "requestId 멱등",
  },
  {
    id: "state",
    title: "상태 문서",
    meta: "비공개",
    ports: [{ id: "st-doc", label: `x_${g.replace(/-/g, "_")}_state` }],
    foot: "다른 그룹은 읽지 않아요",
  },
];

// ── lens-review: 작성 중(검사 실패 상태) ─────────────────────────────────────────

export const draftScope = {
  name: "lens-review",
  meta: "L3 · group · user · 0.1.0 · 작성 중",
  state: "State v1",
  settings: "ext.lens-review.maxLenses 6",
  limits: { maxTurns: 4, maxSpawns: 4, maxTokens: 200000 },
};

export const invalidBlocks: Block[] = [
  helmBlocks[0]!,
  helmBlocks[1]!,
  {
    ...helmBlocks[2]!,
    lines: ["diverge → explore → converge → apply", "턴 4 · spawn 4 · 토큰 200k"],
    issue: {
      level: "warning",
      code: "maxLenses > maxSpawns",
      text: "렌즈 6개인데 spawn 상한이 4라 렌즈 2개는 skipped가 돼요",
    },
  },
  {
    id: "drive2",
    slot: "drive",
    title: "검토 루프",
    op: "drive",
    points: [],
    consumes: [],
    produces: [],
    lines: ["review에서 끌어온 블록"],
    issue: {
      level: "error",
      code: "drive_duplicate",
      text: "drive는 그룹마다 하나예요. 단계 머신에 상태로 합쳐요",
    },
    code: { file: "src/index.ts", from: 0, to: 0 },
  },
  {
    ...helmBlocks[3]!,
    consumes: [{ cap: "knowledge.search", mode: "optional", provider: "knowledge" }],
    issue: {
      level: "error",
      code: "on_capability_call",
      text: "on 핸들러에서는 능력을 부르지 않아요. first 지점이라 예외는 거부가 돼요",
    },
  },
  {
    ...helmBlocks[4]!,
    consumes: [
      { cap: "web.search", mode: "requires", provider: null, note: "provider 없음" },
      { cap: "knowledge.search", mode: "optional", provider: "knowledge" },
    ],
    issue: {
      level: "error",
      code: "capability_missing",
      text: "web.search가 requires인데 이 맥락에 provider가 없어 그룹이 켜지지 않아요",
    },
  },
  helmBlocks[5]!,
];

export const draftProviders: Provider[] = [
  providers[0]!,
  {
    id: "web-exa",
    name: "web-exa",
    layer: "L2",
    meta: "꺼짐 · 프로필 조용히",
    caps: [{ cap: "web.search", off: true }],
  },
  providers[2]!,
  providers[3]!,
];

// ── 블록 종류(well 팔레트) ───────────────────────────────────────────────────────

export const palette = {
  group: [
    {
      slot: "signal" as SlotKind,
      title: "신호 감지",
      hint: "tap 지점에서 세고 경계에서 커밋",
      op: "on",
    },
    { slot: "lens" as SlotKind, title: "주입·렌즈", hint: "input.agent.before collect", op: "on" },
    {
      slot: "drive" as SlotKind,
      title: "단계 머신",
      hint: "임대를 받아 턴·자식을 구동",
      op: "drive",
    },
    { slot: "guard" as SlotKind, title: "가드", hint: "first 지점에서 막기", op: "on" },
    {
      slot: "consume" as SlotKind,
      title: "능력 소비",
      hint: "drive 안에서 L2 능력 읽기",
      op: "drive",
    },
    { slot: "record" as SlotKind, title: "기록", hint: "grp.<그룹>.* 공개 기록", op: "record" },
    { slot: "restore" as SlotKind, title: "상태 복원", hint: "session.start tap", op: "on" },
  ],
  flow: [
    { id: "phase", title: "단계", hint: "상태 하나 · 커밋 뒤 반환" },
    { id: "turn", title: "모델 턴", hint: "loop.turn · 턴 상한 1 소모" },
    { id: "spawn", title: "자식 펼치기", hint: "loop.spawn 여러 개 병렬" },
    { id: "join", title: "모으기", hint: "모두 끝나면 다음으로" },
    { id: "read", title: "능력 읽기", hint: "모델 턴 없이 L2 읽기" },
    { id: "gate", title: "사람 확인", hint: "받은 요청으로 묻고 기다림" },
    { id: "record", title: "기록·post", hint: "record · post" },
    { id: "end", title: "끝", hint: "idle로 · 임대 반납" },
  ],
};

// ── 흐름: Helm 단계 머신(§4.2 전이표) ─────────────────────────────────────────────

export interface Lens {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  findings?: number;
  tool?: string;
}
export const lenses: Lens[] = [
  {
    id: "failure-modes",
    title: "실패 사례",
    status: "running",
    tool: "web_search ttl cache boundary bug",
  },
  {
    id: "first-principles",
    title: "기본 원리",
    status: "done",
    findings: 2,
    tool: "read src/cache.ts",
  },
  { id: "analogy", title: "다른 분야 유사", status: "failed", tool: "web_fetch 시간 초과" },
];

/** 시험 실행 타임라인: 단계 경계마다 커밋(§4.5) */
export const trialSteps = [
  { at: "14:02:01", label: "lease.acquired", note: "턴 4 · spawn 8 · 토큰 400k", done: true },
  { at: "14:02:01", label: "commit diverge", note: "렌즈 3 고름", done: true },
  { at: "14:02:19", label: "loop.turn diverge", note: "턴 1/4", done: true },
  { at: "14:02:20", label: "commit explore", note: "lensesStarted", done: true },
  {
    at: "14:02:31",
    label: "tool.call.before 거부",
    note: "bash · exec · main",
    done: true,
    guard: true,
  },
  { at: "14:02:44", label: "spawn 3/8", note: "explorer × 3", done: true },
  { at: "지금", label: "explored 대기", note: "1 done · 1 failed · 1 running", done: false },
];

// ── 프로필 쌓기 ───────────────────────────────────────────────────────────────────

export type Pick = "on" | "off" | "keep";
export interface StackItem {
  name: string;
  kind: "group" | "plugin" | "hook" | "core";
  tier: "guard" | "user" | "project" | "builtin" | "core";
  now: "enabled" | "disabled" | "auto_disabled";
  pick: Pick;
  drive?: boolean;
  points?: string;
  locked?: string;
}
export const stackBands: { layer: string; title: string; items: StackItem[] }[] = [
  {
    layer: "X",
    title: "외부 훅",
    items: [
      {
        name: "pre-commit-lint",
        kind: "hook",
        tier: "user",
        now: "enabled",
        pick: "keep",
        points: "tool.call.before",
      },
    ],
  },
  {
    layer: "L3",
    title: "의도 그룹",
    items: [
      {
        name: "helm",
        kind: "group",
        tier: "user",
        now: "enabled",
        pick: "on",
        drive: true,
        points: "on 5 · drive",
      },
      {
        name: "learning",
        kind: "group",
        tier: "builtin",
        now: "enabled",
        pick: "on",
        points: "on 3 · post",
      },
      {
        name: "review",
        kind: "group",
        tier: "user",
        now: "auto_disabled",
        pick: "off",
        drive: true,
        points: "on 2 · drive",
      },
    ],
  },
  {
    layer: "plugin",
    title: "플러그인",
    items: [
      {
        name: "acme-notes",
        kind: "plugin",
        tier: "project",
        now: "enabled",
        pick: "off",
        points: "tool.call.before · tool.result",
      },
      { name: "provider-oauth", kind: "plugin", tier: "user", now: "disabled", pick: "keep" },
    ],
  },
  {
    layer: "L2",
    title: "능력",
    items: [
      {
        name: "web-exa",
        kind: "plugin",
        tier: "user",
        now: "enabled",
        pick: "on",
        points: "web.search",
      },
      {
        name: "knowledge",
        kind: "plugin",
        tier: "builtin",
        now: "enabled",
        pick: "keep",
        points: "knowledge.*",
      },
      {
        name: "work",
        kind: "plugin",
        tier: "builtin",
        now: "enabled",
        pick: "keep",
        points: "work.tasks",
      },
    ],
  },
  {
    layer: "L1",
    title: "코어",
    items: [
      {
        name: "core-loop",
        kind: "core",
        tier: "core",
        now: "enabled",
        pick: "keep",
        locked: "끌 수 없어요 · core tier",
      },
    ],
  },
];

/** tool.call.before(first)에 걸린 핸들러 순서: (tier, loadIndex, 등록 순번). X.operations §3.1 */
export const chainOrder = [
  { tier: "guard", items: ["권한 판정", "샌드박스"], fixed: true },
  { tier: "user", items: ["helm 쓰기 거부", "pre-commit-lint"] },
  { tier: "project", items: ["acme-notes"], removed: ["acme-notes"] },
  { tier: "builtin", items: [] as string[] },
];

// ── 코드 보기: drive 템플릿 10개 파일(group-kit/templates/index.json) ────────────

export const scaffoldFiles = [
  {
    path: ".fresnel-plugin/plugin.json",
    from: ["scope", "signal", "lens", "guard", "consume", "record", "restore"],
    state: "changed",
  },
  {
    path: "src/index.ts",
    from: ["signal", "lens", "guard", "drive", "consume", "record", "restore"],
    state: "changed",
  },
  { path: "src/state.ts", from: ["drive"], state: "changed" },
  { path: "src/settings.ts", from: ["scope", "drive"], state: "changed" },
  { path: "test/unit.test.ts", from: [], state: "template" },
  { path: "test/replay.test.ts", from: ["drive"], state: "template" },
  { path: "test/manifest.test.ts", from: [], state: "template" },
  { path: "package.json", from: [], state: "template" },
  { path: "tsconfig.json", from: [], state: "template" },
  { path: "README.md", from: ["scope"], state: "template" },
] as const;

/** 코드 줄과 블록. 줄 번호는 1부터. 블록 id가 있으면 그 블록에서 나온 줄 */
export const codeIndex: { text: string; block?: string }[] = [
  // 예시 코드의 import 줄은 sample-imports.txt에 둔다(문자열 안 import 문을 층 검사가 실제 import로 읽지 않게)
  ...sampleImports
    .trimEnd()
    .split("\n")
    .map((text) => ({ text })),
  { text: "" },
  { text: "const group: GroupModule = defineGroup<State>({", block: "scope" },
  { text: "  manifest: groupManifest(manifestJson),", block: "scope" },
  {
    text: "  state: { schema: lensReviewState, initial: initialState, version: 1 },",
    block: "scope",
  },
  { text: "  setup(g) {", block: "scope" },
  {
    text: '    g.on("tool.execution.after", tally);          // 신호 감지: 메모리 집계',
    block: "signal",
  },
  {
    text: '    g.on("boundary.settle.after", judge);         // 신호 감지: turn당 1회 commit·record',
    block: "signal",
  },
  {
    text: '    g.on("input.agent.before", lensBlock);        // 렌즈 주입(collect)',
    block: "lens",
  },
  {
    text: '    g.on("tool.call.before", (call, ctx) =>       // 쓰기 거부(first, 실패하면 거부)',
    block: "guard",
  },
  { text: "      denyWrite(ctx.state.phase, call));", block: "guard" },
  {
    text: "    g.drive(async (loop, st) => {                 // 단계 머신: 커밋 상태로 다시 호출",
    block: "drive",
  },
  {
    text: '      if (st.phase === "idle") return st.pending ? step("leaseGranted") : undefined;',
    block: "drive",
  },
  { text: '      if (st.phase === "diverge") return turnOnce(loop, "diverge");', block: "drive" },
  {
    text: '      if (st.phase === "explore") return spawnLenses(loop, st.lenses);',
    block: "drive",
  },
  { text: '      if (st.phase === "converge")', block: "drive" },
  {
    text: '        return step("converged", await gatherContext(g)); // 지식 소비',
    block: "consume",
  },
  { text: '      if (st.phase === "apply") {', block: "drive" },
  { text: '        await turnOnce(loop, "apply");', block: "drive" },
  {
    text: "        await recordDiscoveries(g, st);            // 발견 기록 · work.tasks",
    block: "record",
  },
  { text: "      }", block: "drive" },
  { text: "    }, { limits: { maxTurns: 4, maxSpawns: 6, maxTokens: 200000 } });", block: "drive" },
  { text: '    g.on("session.start", checkRestore);          // 상태 복원', block: "restore" },
  { text: "  },", block: "scope" },
  { text: "});", block: "scope" },
  { text: "export default group;" },
];

export const manifestIndex: { text: string; block?: string }[] = [
  { text: "{" },
  { text: '  "schemaVersion": 1,', block: "scope" },
  { text: '  "name": "lens-review",', block: "scope" },
  { text: '  "version": "0.1.0",', block: "scope" },
  { text: '  "layer": "L3",', block: "scope" },
  { text: '  "kind": "group",', block: "scope" },
  { text: '  "entry": "./dist/index.js",', block: "scope" },
  { text: '  "usesDrive": true,', block: "drive" },
  { text: '  "usesPost": true,', block: "signal" },
  { text: '  "points": [', block: "scope" },
  { text: '    "input.agent.before",', block: "lens" },
  { text: '    "tool.call.before",', block: "guard" },
  { text: '    "tool.execution.after",', block: "signal" },
  { text: '    "boundary.settle.after",', block: "signal" },
  { text: '    "session.start"', block: "restore" },
  { text: "  ],", block: "scope" },
  { text: '  "requires": [],', block: "consume" },
  { text: '  "optional": [', block: "consume" },
  { text: '    { "id": "web.search", "range": "^1.0.0" },', block: "consume" },
  { text: '    { "id": "knowledge.search", "range": "^1.0.0" },', block: "consume" },
  { text: '    { "id": "work.tasks", "range": "^1.0.0" }', block: "record" },
  { text: "  ],", block: "consume" },
  { text: '  "recordKinds": [', block: "record" },
  { text: '    { "kind": "grp.lens-review.signal.detected", "version": 1, … },', block: "signal" },
  {
    text: '    { "kind": "grp.lens-review.discovery.recorded", "version": 1, … }',
    block: "record",
  },
  { text: "  ],", block: "record" },
  { text: '  "trust": { "level": "user" }', block: "scope" },
  { text: "}" },
];
