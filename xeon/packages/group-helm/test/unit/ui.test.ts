import { expect, test } from "bun:test";
import { join } from "node:path";
import { assertNever, parse, parseJson } from "@fresnel/contracts";
import {
  validateManifest,
  validateUiTree,
  type UiCondition,
  type UiNode,
} from "@fresnel/contracts/extensions";
import { helmManifest, helmUi } from "../../src/index.ts";
import { InquiryFinishedPayloadSchema, SignalDetectedPayloadSchema } from "../../src/records.ts";
import { createRig, type Rig } from "../support/rig.ts";

// Plugin UI 기여 일곱 개(ADR-0021 §3.10)와 화면 트리 다섯 개를 시험한다.
// 위젯 카탈로그 v1 이름은 ADR-0021 §3.4.1 목록이다. 공용 검사기(packages/client/src/views)는 아직 없어서
// 이 파일에 이름 목록을 둔다. 그 검사기가 생기면 이 상수를 그쪽 export로 바꾼다.
const CATALOG_V1: ReadonlySet<string> = new Set([
  "Stack",
  "Row",
  "Section",
  "Tabs",
  "Split",
  "Text",
  "Heading",
  "Markdown",
  "Code",
  "List",
  "Table",
  "ListDescription",
  "Badge",
  "Chip",
  "Progress",
  "Meter",
  "Stepper",
  "ActivityTree",
  "Timeline",
  "Sparkline",
  "Alert",
  "EmptyState",
  "Skeleton",
  "Button",
  "Switch",
  "Select",
  "TextField",
  "NumberField",
  "SegmentedControl",
  "Form",
  "ThreadLink",
  "TurnLink",
  "ViewLink",
  "ApprovalLink",
]);

/** 화면 트리에서 쓸 수 있는 글자와 선택 속성 이름. 색, 크기 숫자, CSS, HTML 이름은 없다(DP-08) */
const ALLOWED_PROPS: ReadonlySet<string> = new Set([
  "text",
  "label",
  "step",
  "title",
  "max",
  "command",
  "name",
  "placeholder",
  "maxLength",
  "submitLabel",
]);

const TREE_DIR = join(import.meta.dir, "../../ui");

async function treeOf(file: string): Promise<UiNode> {
  const text = await Bun.file(join(TREE_DIR, file.replace("./ui/", ""))).text();
  const json = parseJson(text);
  if (!json.ok) throw new Error(`${file} is not JSON`);
  const checked = validateUiTree(json.value);
  if (!checked.ok) throw new Error(`${file} is not a valid tree: ${checked.issues[0]?.message}`);
  return checked.tree;
}

function nativeFiles(): readonly { readonly id: string; readonly file: string }[] {
  return helmUi.items.flatMap((item) =>
    item.file === undefined ? [] : [{ id: item.id, file: item.file }],
  );
}

// ── 경로 해석(렌더러가 할 일의 시험용 사본) ──────────────────────────────────
// 바인딩 규칙: 경로의 첫 마디가 감싸는 each의 `as`와 같으면 그 항목 안을, 아니면 문서 루트를 본다.

interface ScopeItem {
  readonly as: string;
  readonly value: unknown;
}
interface Scope {
  readonly root: unknown;
  readonly items: readonly ScopeItem[];
}
type Found = { readonly found: false } | { readonly found: true; readonly value: unknown };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function segmentsOf(path: string): readonly string[] {
  if (path === "") return [];
  return path
    .split("/")
    .slice(1)
    .map((raw) => raw.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function lookup(value: unknown, segments: readonly string[]): Found {
  let current: unknown = value;
  for (const key of segments) {
    if (Array.isArray(current)) {
      const list: readonly unknown[] = current;
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return { found: false };
      current = list[index];
    } else if (isRecord(current) && key in current) {
      current = current[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function valueAt(scope: Scope, path: string): Found {
  const segments = segmentsOf(path);
  const [head, ...rest] = segments;
  const item = head === undefined ? undefined : scope.items.findLast((entry) => entry.as === head);
  return item === undefined ? lookup(scope.root, segments) : lookup(item.value, rest);
}

function holds(condition: UiCondition, scope: Scope): boolean {
  const found = valueAt(scope, condition.path);
  switch (condition.op) {
    case "exists":
      return found.found;
    case "missing":
      return !found.found;
    case "eq":
      return found.found && found.value === condition.value;
    case "ne":
      return !found.found || found.value !== condition.value;
    default:
      return assertNever(condition.op, "holds");
  }
}

/** 렌더러가 읽을 바인딩과 each 경로 가운데 없는 것의 목록. 조건이 거짓인 가지는 읽지 않으므로 보지 않는다 */
function unresolvedOf(node: UiNode, scope: Scope, at = ""): string[] {
  const each = node.each;
  if (each === undefined) return bodyUnresolved(node, scope, at);
  const list = valueAt(scope, each.path);
  if (!list.found || !Array.isArray(list.value)) return [`${at} each ${each.path}`];
  const items: readonly unknown[] = list.value;
  return items.flatMap((item) =>
    bodyUnresolved(
      node,
      { root: scope.root, items: [...scope.items, { as: each.as, value: item }] },
      at,
    ),
  );
}

function bodyUnresolved(node: UiNode, scope: Scope, at: string): string[] {
  const out: string[] = [];
  const when = node.when;
  if (when !== undefined) {
    if (when.op !== "exists" && when.op !== "missing" && !valueAt(scope, when.path).found) {
      out.push(`${at} when ${when.path}`);
    }
    // 조건이 거짓인 가지는 그리지 않으므로 그 안의 경로는 읽히지 않는다
    if (!holds(when, scope)) return out;
  }
  for (const [name, binding] of Object.entries(node.bind ?? {})) {
    if (!valueAt(scope, binding.path).found) out.push(`${at} bind.${name} ${binding.path}`);
  }
  (node.children ?? []).forEach((child, index) => {
    out.push(...unresolvedOf(child, scope, `${at}/children/${String(index)}`));
  });
  return out;
}

/** 렌더러가 글자로 그릴 값을 화면 순서대로 모은다. when이 거짓이면 그 가지는 그리지 않는다 */
function textsOf(node: UiNode, scope: Scope): string[] {
  const each = node.each;
  if (each === undefined) return bodyTexts(node, scope);
  const list = valueAt(scope, each.path);
  if (!list.found || !Array.isArray(list.value)) return [];
  const items: readonly unknown[] = list.value;
  return items.flatMap((item) =>
    bodyTexts(node, { root: scope.root, items: [...scope.items, { as: each.as, value: item }] }),
  );
}

function bodyTexts(node: UiNode, scope: Scope): string[] {
  if (node.when !== undefined && !holds(node.when, scope)) return [];
  const own: string[] = [];
  const literal = node.props?.text;
  if (typeof literal === "string") own.push(literal);
  const bound = node.bind?.text;
  if (bound !== undefined) {
    const found = valueAt(scope, bound.path);
    if (found.found && (typeof found.value === "string" || typeof found.value === "number")) {
      own.push(String(found.value));
    }
  }
  return [...own, ...(node.children ?? []).flatMap((child) => textsOf(child, scope))];
}

function catalogNamesOf(node: UiNode): string[] {
  return [node.type, ...(node.children ?? []).flatMap(catalogNamesOf)];
}

function propNamesOf(node: UiNode): string[] {
  return [...Object.keys(node.props ?? {}), ...(node.children ?? []).flatMap(propNamesOf)];
}

// ── 실제 결과 ──────────────────────────────────────────────────────────────

/** 호스트가 낸 메서드 결과 값. ok가 아니면 시험이 실패해야 하므로 던진다 */
async function valueOfCall(rig: Rig, verb: string, params: unknown): Promise<unknown> {
  const outcome = await rig.t.host.methods.call({
    extension: "helm",
    verb,
    params,
    threadId: rig.thread,
    signal: new AbortController().signal,
    caller: "wire",
  });
  if (outcome.kind !== "ok") throw new Error(`${verb} returned ${outcome.kind}`);
  return outcome.value;
}

/** 탐구 하나를 돌려 status(탐색 중), inquiries와 findings(끝난 뒤), 끝난 기록의 값을 실제 호스트에서 얻는다 */
async function realResults(): Promise<{
  readonly status: unknown;
  readonly inquiries: unknown;
  readonly findings: unknown;
  readonly finished: unknown;
}> {
  const captured: { status?: unknown; armed: boolean } = { armed: true };
  const holder: { rig?: Rig } = {};
  const rig = await createRig({
    onSpawn: async () => {
      // 렌즈 세 개가 동시에 떠서 hook이 세 번 불린다. 첫 호출만 잡도록 표지를 동기로 내린다
      const target = holder.rig;
      if (target === undefined || !captured.armed) return;
      captured.armed = false;
      captured.status = await valueOfCall(target, "status", {});
    },
  });
  holder.rig = rig;
  await rig.runInquiry("캐시 무효화");
  const finished = parse(InquiryFinishedPayloadSchema, rig.records("grp.helm.inquiry.finished")[0]);
  if (!finished.ok) throw new Error("the finished record does not match its schema");
  return {
    status: captured.status,
    inquiries: await valueOfCall(rig, "inquiries", {}),
    findings: await valueOfCall(rig, "findings", { inquiryId: finished.value.inquiryId }),
    finished: finished.value,
  };
}

// ── 시험 ───────────────────────────────────────────────────────────────────

test("ui.contributions: the seven Helm items with their placements and record kinds", () => {
  expect(helmUi.items.map((item) => [item.id, item.placement, item.forKind ?? null])).toEqual([
    ["helm-inquiry", "page", null],
    ["helm-panel", "panel", null],
    ["helm-finished", "card", "grp.helm.inquiry.finished"],
    ["helm-suggested", "card", "grp.helm.signal.detected"],
    ["helm-phase", "status", null],
    ["helm-start", "command", null],
    ["helm-stop", "command", null],
  ]);
  expect(helmManifest.ui).toEqual(helmUi);
  expect(helmUi.widgets).toBe("^1.0.0");
  expect(helmUi.items.filter((item) => item.file === undefined).map((item) => item.id)).toEqual([
    "helm-start",
    "helm-stop",
  ]);
  expect(nativeFiles()).toEqual([
    { id: "helm-inquiry", file: "./ui/helm-inquiry.view.json" },
    { id: "helm-panel", file: "./ui/helm-panel.view.json" },
    { id: "helm-finished", file: "./ui/helm-finished.view.json" },
    { id: "helm-suggested", file: "./ui/helm-suggested.view.json" },
    { id: "helm-phase", file: "./ui/helm-phase.view.json" },
  ]);
  expect(
    validateManifest(helmManifest).issues.filter((issue) => issue.severity === "error"),
  ).toEqual([]);
});

test("ui.trees: every tree file parses, passes validateUiTree and uses only catalog v1 names", async () => {
  const trees = await Promise.all(nativeFiles().map(({ file }) => treeOf(file)));
  const names = trees.flatMap(catalogNamesOf);
  expect(names.filter((name) => !CATALOG_V1.has(name))).toEqual([]);
  expect([...new Set(names)].toSorted()).toEqual(
    [
      "Badge",
      "Button",
      "Chip",
      "Heading",
      "List",
      "Meter",
      "ActivityTree",
      "EmptyState",
      "Form",
      "Row",
      "Section",
      "Stack",
      "Stepper",
      "Text",
      "TextField",
    ].toSorted(),
  );
});

test("ui.form: the page and panel start with a Form that sends `helm start` plus a topic field, and stop with a button, by lease", async () => {
  const start: UiNode = {
    type: "Form",
    props: { command: "helm start", submitLabel: "탐구 시작" },
    when: { path: "/status/lease", op: "eq", value: "none" },
    children: [
      {
        type: "TextField",
        props: {
          name: "arg",
          label: "주제",
          placeholder: "비우면 마지막 입력에서 뽑은 낱말로 정해요",
          maxLength: 300,
        },
      },
    ],
  };
  const stop: UiNode = {
    type: "Button",
    props: { label: "탐구 멈춤", command: "helm stop" },
    when: { path: "/status/lease", op: "ne", value: "none" },
  };
  const trees = await Promise.all(
    ["./ui/helm-inquiry.view.json", "./ui/helm-panel.view.json"].map((file) => treeOf(file)),
  );
  expect(trees.map((tree) => (tree.children ?? []).slice(-2))).toEqual([
    [start, stop],
    [start, stop],
  ]);
});

test("ui.trees: props hold letters and the few selectors only, no colors, sizes or markup", async () => {
  const trees = await Promise.all(nativeFiles().map(({ file }) => treeOf(file)));
  const keys = trees.flatMap(propNamesOf);
  expect(keys.filter((key) => !ALLOWED_PROPS.has(key))).toEqual([]);
});

test("ui.bind: the page, panel and status trees resolve every bind and each path against real method results", async () => {
  const real = await realResults();
  const doc = { status: real.status, inquiries: real.inquiries, findings: real.findings };
  const ids = ["helm-inquiry", "helm-panel", "helm-phase"];
  const unresolved = await Promise.all(
    ids.map(async (id) => {
      const item = helmUi.items.find((entry) => entry.id === id);
      if (item?.file === undefined) throw new Error(`${id} has no tree file`);
      return unresolvedOf(await treeOf(item.file), { root: doc, items: [] });
    }),
  );
  expect(unresolved).toEqual([[], [], []]);
});

test("ui.text: the page and panel show the real status, lens, finding and past inquiry values in order", async () => {
  const real = await realResults();
  const doc = { status: real.status, inquiries: real.inquiries, findings: real.findings };
  const root: Scope = { root: doc, items: [] };
  const page = await treeOf("./ui/helm-inquiry.view.json");
  const panel = await treeOf("./ui/helm-panel.view.json");
  expect(textsOf(panel, root)).toEqual([
    "대기",
    "발산",
    "다른 분야 탐색",
    "수렴",
    "적용",
    "캐시 무효화",
    "발견",
    "0",
    "탐구하는 중이에요",
  ]);
  expect(textsOf(page, root)).toEqual([
    "대기",
    "발산",
    "다른 분야 탐색",
    "수렴",
    "적용",
    "탐구하는 중이에요",
    "다른 분야의 유사 문제",
    "진행 중",
    "선행 사례와 문헌",
    "진행 중",
    "기본 원리로 다시 보기",
    "진행 중",
    "면역 기억을 닮은 재검증",
    "보통",
    "선행 사례: 버전 태그 캐시",
    "보통",
    "전제: 무효화는 일관성 비용이다",
    "보통",
    "캐시 무효화",
    "끝남",
    "적용됨",
  ]);
});

test("ui.bind: the finished card resolves against the real finished record and shows its values", async () => {
  const real = await realResults();
  const card = await treeOf("./ui/helm-finished.view.json");
  const scope: Scope = { root: real.finished, items: [] };
  expect(unresolvedOf(card, scope)).toEqual([]);
  expect(textsOf(card, scope)).toEqual(["캐시 무효화", "적용됨", "발견", "3"]);
});

test("ui.bind: the suggestion card shows only for a suggested signal and resolves its payload", async () => {
  const payload = parse(SignalDetectedPayloadSchema, {
    signal: "repeat",
    turnId: "trn_suggest",
    evidence: { toolName: "bash", count: 3 },
    action: "suggested",
    inquiryId: null,
  });
  if (!payload.ok) throw new Error("the sample signal payload does not match its schema");
  const card = await treeOf("./ui/helm-suggested.view.json");
  const scope: Scope = { root: payload.value, items: [] };
  expect(unresolvedOf(card, scope)).toEqual([]);
  expect(textsOf(card, scope)).toEqual(["탐구 신호가 감지되었습니다", "신호", "repeat", "bash"]);
  expect(textsOf(card, { root: { ...payload.value, action: "recorded" }, items: [] })).toEqual([]);
});

test("ui.bind: a path that the result does not have is reported, so the check is not vacuous", async () => {
  const real = await realResults();
  const broken: UiNode = {
    type: "Text",
    bind: { text: { path: "/status/nope" } },
    each: { path: "/status/missing", as: "row" },
  };
  expect(unresolvedOf(broken, { root: { status: real.status }, items: [] })).toEqual([
    " each /status/missing",
  ]);
  const bound: UiNode = { type: "Text", bind: { text: { path: "/status/nope" } } };
  expect(unresolvedOf(bound, { root: { status: real.status }, items: [] })).toEqual([
    " bind.text /status/nope",
  ]);
});

test("ui.text: no tree shows a stored English key through a Badge bind", async () => {
  const trees = await Promise.all(
    ["helm-inquiry", "helm-panel", "helm-finished"].map((id) => {
      const file = nativeFiles().find((entry) => entry.id === id)?.file;
      if (file === undefined) throw new Error(`${id} has no tree file`);
      return treeOf(file);
    }),
  );
  const rawBadges = (node: UiNode): number =>
    (node.type === "Badge" && node.bind?.text !== undefined ? 1 : 0) +
    (node.children ?? []).reduce((sum, child) => sum + rawBadges(child), 0);
  expect(trees.map(rawBadges)).toEqual([0, 0, 0]);
});
