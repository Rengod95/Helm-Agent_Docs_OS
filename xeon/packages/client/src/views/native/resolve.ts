import {
  UI_LIMITS,
  type UiBinding,
  type UiNode,
  type UiScalar,
} from "@fresnel/contracts/extensions";
import {
  bindAllowed,
  isForbiddenPropName,
  isWidgetName,
  propSpecOf,
  scalarMismatch,
  WIDGET_SPECS,
  type WidgetSpec,
} from "./catalog.ts";
import { checkTree, type TreeIssue } from "./check.ts";
import { evalCondition } from "./expr.ts";
import { formatValue } from "./format.ts";
import { escapePointerSegment, type PointerRead } from "./pointer.ts";
import { createScope, resolvePath, withLocal, type Scope } from "./scope.ts";

// 화면 트리를 데이터와 합쳐 그릴 노드 트리로 만든다(ADR-0021 §3.4.1, §3.7). 순수 함수이고 던지지 않는다.
// 규칙:
// - when이 거짓이면 노드를 뺀다. when은 each 복사마다 그 복사의 이름으로 판정한다.
// - each는 경로의 배열 원소마다 한 벌씩 펼친다. 배열이 아니거나 없으면 0벌이다. 한 번에 최대 UI_LIMITS.eventRows벌이고 넘치면 truncated다.
// - 정적 props를 먼저 두고 bind가 같은 키를 덮는다. bind 경로가 없으면 정적 값이 남는다.
// - bind는 format이 있으면 formatValue로, 없으면 스칼라만 쓴다. 객체, 배열, null은 prop을 두지 않는다.
// - 카탈로그에 맞지 않는 prop은 버린다. 정적인 문제는 checkTree가 issue로 보고하고, bind 값의 종류 문제는 여기서 issue로 보고한다.
// - 모르는 위젯은 자리표시 노드 하나이고 자식은 버린다.
// - 노드 수와 깊이는 한도로 막는다. 한도를 넘는 첫 노드가 too_long 자리표시 하나가 되고, 그 뒤는 모두 버린다.
// - 바인드 문자열은 4096자에서 자른다.

const BOUND_STRING_LIMIT = 4096;
const EACH_COPY_LIMIT: number = UI_LIMITS.eventRows;
/** each 복사 한 벌과 when 판정 한 번이 각각 일 한 단위다. 그리지 않는 복사도 세므로 거짓 when 아래의 중첩 each도 멈춘다 */
const WORK_LIMIT: number = UI_LIMITS.treeNodes * 10;

export interface ResolvedNode {
  readonly type: string;
  readonly props: Readonly<Record<string, UiScalar>>;
  readonly children: readonly ResolvedNode[];
  readonly placeholder?: "unknown_widget" | "too_long";
}

export interface ResolvedTree {
  /** 루트. 루트 each가 여러 벌이면 Stack 하나로 감싼다. when이 거짓이면 undefined다 */
  readonly root: ResolvedNode | undefined;
  readonly issues: readonly TreeIssue[];
  readonly truncated: boolean;
}

export interface ResolveInput {
  readonly doc: unknown;
  readonly locale: string;
  readonly nowMs: number;
  readonly limits?: { readonly nodes?: number; readonly depth?: number };
}

interface Walk {
  readonly locale: string;
  readonly nowMs: number;
  readonly nodeLimit: number;
  readonly depthLimit: number;
  nodes: number;
  work: number;
  stopped: boolean;
  truncated: boolean;
  readonly issues: TreeIssue[];
  readonly seen: Set<string>;
}

export function resolveTree(tree: UiNode, input: ResolveInput): ResolvedTree {
  const check = checkTree(tree);
  const walk: Walk = {
    locale: input.locale,
    nowMs: input.nowMs,
    nodeLimit: input.limits?.nodes ?? UI_LIMITS.treeNodes,
    depthLimit: input.limits?.depth ?? UI_LIMITS.treeDepth,
    nodes: 0,
    work: 0,
    stopped: false,
    truncated: false,
    issues: [...check.issues],
    seen: new Set(check.issues.map(issueKey)),
  };
  const copies = resolveTemplate(tree, createScope(input.doc), 1, "", walk);
  return { root: singleRoot(copies), issues: walk.issues, truncated: walk.truncated };
}

function singleRoot(nodes: readonly ResolvedNode[]): ResolvedNode | undefined {
  if (nodes.length <= 1) return nodes[0];
  return { type: "Stack", props: {}, children: nodes };
}

/** 템플릿 노드 하나를 0벌 이상의 노드로 펼친다(each가 없으면 0 또는 1벌) */
function resolveTemplate(
  node: UiNode,
  scope: Scope,
  depth: number,
  path: string,
  walk: Walk,
): readonly ResolvedNode[] {
  if (walk.stopped) return [];
  const each = node.each;
  if (each === undefined) return resolveInstance(node, scope, depth, path, walk);
  const listed = resolvePath(scope, each.path);
  const items: unknown = listed.found ? listed.value : undefined;
  if (!isArrayValue(items)) return [];
  if (items.length > EACH_COPY_LIMIT) walk.truncated = true;
  const count = Math.min(items.length, EACH_COPY_LIMIT);
  const copies: ResolvedNode[] = [];
  for (let index = 0; index < count && !isStopped(walk); index += 1) {
    if (!spendWork(walk)) break;
    const inner = withLocal(scope, each.as, items[index]);
    copies.push(...resolveInstance(node, inner, depth, path, walk));
  }
  return copies;
}

/** 자식 호출이 stopped를 세울 수 있으므로 반복 조건은 함수로 읽는다. 직접 읽으면 앞의 검사로 false로 좁혀져 계속 참으로 보인다 */
function isStopped(walk: Walk): boolean {
  return walk.stopped;
}

/** each가 이미 풀린 노드 한 벌을 그린다 */
function resolveInstance(
  node: UiNode,
  scope: Scope,
  depth: number,
  path: string,
  walk: Walk,
): readonly ResolvedNode[] {
  if (walk.stopped) return [];
  if (node.when !== undefined) {
    if (!spendWork(walk)) return [];
    if (!evalCondition(node.when, scope)) return [];
  }
  if (depth > walk.depthLimit || walk.nodes >= walk.nodeLimit) {
    return [stop(node.type, walk)];
  }
  walk.nodes += 1;
  const type = node.type;
  if (!isWidgetName(type)) {
    return [{ type, props: {}, children: [], placeholder: "unknown_widget" }];
  }
  const props = resolveProps(node, WIDGET_SPECS[type], scope, path, walk);
  const children: ResolvedNode[] = [];
  const childNodes: readonly UiNode[] = node.children ?? [];
  for (const [index, child] of childNodes.entries()) {
    children.push(...resolveTemplate(child, scope, depth + 1, `${path}/children/${index}`, walk));
  }
  return [{ type, props, children }];
}

/** 일 한 단위를 쓴다. 예산이 다하면 멈추고 잘렸다고 표시한다(자리표시 노드는 없다) */
function spendWork(walk: Walk): boolean {
  if (walk.stopped) return false;
  walk.work += 1;
  if (walk.work <= WORK_LIMIT) return true;
  walk.stopped = true;
  walk.truncated = true;
  return false;
}

function stop(type: string, walk: Walk): ResolvedNode {
  walk.stopped = true;
  walk.truncated = true;
  return { type, props: {}, children: [], placeholder: "too_long" };
}

function resolveProps(
  node: UiNode,
  widget: WidgetSpec,
  scope: Scope,
  path: string,
  walk: Walk,
): Readonly<Record<string, UiScalar>> {
  const props: Record<string, UiScalar> = {};
  const staticProps: Readonly<Record<string, UiScalar>> = node.props ?? {};
  for (const [key, value] of Object.entries(staticProps)) {
    // 맞지 않는 정적 prop은 checkTree가 이미 issue로 적었다. 여기서는 뺀다
    if (isForbiddenPropName(key)) continue;
    const prop = propSpecOf(widget, key);
    if (prop === undefined || scalarMismatch(prop, value) !== undefined) continue;
    props[key] = clipScalar(value);
  }
  const binds: Readonly<Record<string, UiBinding>> = node.bind ?? {};
  for (const [key, binding] of Object.entries(binds)) {
    if (isForbiddenPropName(key) || !bindAllowed(widget, key)) continue;
    const value = boundValue(binding, scope, walk);
    if (value === undefined) continue;
    const prop = propSpecOf(widget, key);
    if (prop !== undefined) {
      const reason = scalarMismatch(prop, value);
      if (reason !== undefined) {
        report(walk, {
          code: "prop_type",
          path: `${path}/bind/${escapePointerSegment(key)}`,
          message: `prop "${key}" ${reason}`,
        });
        continue;
      }
    }
    props[key] = value;
  }
  return props;
}

/** 바인드 하나의 값. 경로가 없거나, 서식이 맞지 않거나, 스칼라가 아니거나, null이면 undefined다 */
function boundValue(binding: UiBinding, scope: Scope, walk: Walk): UiScalar | undefined {
  const read: PointerRead = resolvePath(scope, binding.path);
  if (!read.found) return undefined;
  const value: UiScalar | undefined =
    binding.format === undefined
      ? scalarOf(read.value)
      : formatValue(binding.format, read.value, walk.locale, walk.nowMs);
  if (value === null) return undefined;
  return value;
}

function scalarOf(value: unknown): UiScalar | undefined {
  if (typeof value === "string") return clipText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

function clipScalar(value: UiScalar): UiScalar {
  return typeof value === "string" ? clipText(value) : value;
}

/** 4096자에서 자른다. 자리에 서로게이트 쌍의 앞쪽만 남지 않게 한 글자 앞에서 끊는다 */
function clipText(text: string): string {
  if (text.length <= BOUND_STRING_LIMIT) return text;
  const last = text.charCodeAt(BOUND_STRING_LIMIT - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? BOUND_STRING_LIMIT - 1 : BOUND_STRING_LIMIT;
  return text.slice(0, end);
}

function report(walk: Walk, issue: TreeIssue): void {
  const key = issueKey(issue);
  if (walk.seen.has(key)) return;
  walk.seen.add(key);
  walk.issues.push(issue);
}

function issueKey(issue: TreeIssue): string {
  return `${issue.code} ${issue.path}`;
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
