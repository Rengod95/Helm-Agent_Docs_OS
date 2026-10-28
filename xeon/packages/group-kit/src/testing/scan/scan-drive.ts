import { attempt } from "@xeon/contracts";
import { parseSync } from "@swc/core";

export type DriveScanCode =
  | "SD-00"
  | "SD-01"
  | "SD-02"
  | "SD-03"
  | "SD-04"
  | "SD-05"
  | "SD-06"
  | "SD-07"
  | "SD-08"
  | "SD-09"
  | "SD-10";

export interface DriveScanFinding {
  readonly code: DriveScanCode;
  readonly severity: "error" | "warning";
  /** 1부터 */
  readonly line: number;
  /** 1부터. UTF-16 코드 단위 기준 */
  readonly column: number;
  /** 금지 문자열 그대로. 예: "Date.now" */
  readonly target: string;
  readonly message: string;
}

export interface DriveScanOptions {
  /** 확장자 `.tsx`면 JSX를 켠다. 없으면 `.ts`로 본다 */
  readonly fileName?: string;
}

const CLOCK = "Inject Clock (eng.typescript.guide TY-21).";
const CLOCK_SHORT = "Inject Clock (TY-21).";
const RANDOM = "Inject RandomSource (TY-21).";
const IO = "Direct I/O is not allowed in drive; use the effects of ADR-0015 §3.2.";
const STATE = "drive state lives only in scope state (eng.events EV-09).";

interface MemberRule {
  readonly code: DriveScanCode;
  readonly message: string;
}

/** `<객체>.<속성>` 참조 하나가 금지 대상인가. 키는 "Date.now" 같은 문자열 */
const MEMBER_RULES: ReadonlyMap<string, MemberRule> = new Map([
  ["Date.now", { code: "SD-01", message: CLOCK }],
  ["Math.random", { code: "SD-03", message: RANDOM }],
  ["crypto.randomUUID", { code: "SD-04", message: "Use IdFactory (TY-21)." }],
  ["crypto.getRandomValues", { code: "SD-05", message: RANDOM }],
  ["performance.now", { code: "SD-06", message: CLOCK_SHORT }],
  ["Bun.file", { code: "SD-08", message: IO }],
  ["Bun.write", { code: "SD-08", message: IO }],
]);

const FS_MODULES: ReadonlySet<string> = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);

const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
  "FunctionDeclaration",
]);

interface Span {
  readonly start: number;
  readonly end: number;
}

/** swc 구문 트리의 노드. 형태가 넓어 `type`과 `span`만 믿고 나머지 필드는 값마다 확인한다 */
interface Node {
  readonly type: string;
  readonly span: Span;
  readonly [key: string]: unknown;
}

function isSpan(value: unknown): value is Span {
  return (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    "end" in value &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  );
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "span" in value &&
    isSpan(value.span)
  );
}

function nodesOf(value: unknown): readonly Node[] {
  if (Array.isArray(value)) return value.flatMap((member) => nodesOf(member));
  return isNode(value) ? [value] : [];
}

/** 노드의 직접 자식 노드들. 배열과 래퍼 객체(`{ spread, expression }`) 안의 노드도 포함한다 */
function childrenOf(node: Node): readonly Node[] {
  return Object.values(node).flatMap((value) => {
    if (isNode(value) || Array.isArray(value)) return nodesOf(value);
    if (typeof value === "object" && value !== null) return nodesOf(Object.values(value));
    return [];
  });
}

function visit(node: Node, enter: (node: Node, parent: Node | undefined) => void): void {
  const walk = (current: Node, parent: Node | undefined): void => {
    enter(current, parent);
    for (const child of childrenOf(current)) walk(child, current);
  };
  walk(node, undefined);
}

/** 호출·new의 인자 식들. swc는 인자를 `{ spread, expression }` 래퍼로 감싼다 */
function argumentsOf(node: Node): readonly Node[] {
  const list: unknown = node["arguments"];
  const entries: readonly unknown[] = Array.isArray(list) ? list : [];
  return entries.flatMap((entry: unknown): readonly Node[] => {
    if (typeof entry !== "object" || entry === null || !("expression" in entry)) return [];
    const expression: unknown = entry.expression;
    return isNode(expression) ? [expression] : [];
  });
}

function stringField(node: Node, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}

function nodeField(node: Node, key: string): Node | undefined {
  const value = node[key];
  return isNode(value) ? value : undefined;
}

/** `Identifier`의 이름. 아니면 undefined */
function identifierName(node: Node | undefined): string | undefined {
  return node?.type === "Identifier" ? stringField(node, "value") : undefined;
}

/** `a.b` 형태(점 접근, 계산 접근 아님)의 멤버 표현식이면 `"a.b"` */
function memberKey(node: Node): string | undefined {
  if (node.type !== "MemberExpression") return undefined;
  const object = identifierName(nodeField(node, "object"));
  const property = nodeField(node, "property");
  const name = property?.type === "Identifier" ? stringField(property, "value") : undefined;
  return object === undefined || name === undefined ? undefined : `${object}.${name}`;
}

function isFunction(node: Node | undefined): node is Node {
  return node !== undefined && FUNCTION_TYPES.has(node.type);
}

interface Position {
  readonly line: number;
  readonly column: number;
}

/** swc span은 바이트 오프셋이고 모듈 시작이 기준이다. 줄·열(1부터)로 바꾼다 */
function positioner(source: string, base: number): (offset: number) => Position {
  const bytes = new TextEncoder().encode(source);
  const decoder = new TextDecoder();
  return (offset) => {
    const at = Math.max(0, Math.min(bytes.length, offset - base));
    const before = bytes.subarray(0, at);
    const lineStart = before.lastIndexOf(10) + 1;
    const line = before.reduce((count, byte) => (byte === 10 ? count + 1 : count), 1);
    return { line, column: decoder.decode(before.subarray(lineStart)).length + 1 };
  };
}

/** 파일 안 함수 선언의 이름과 노드. `function f() {}`와 `const f = () => {}`를 본다 */
function functionsByName(module: Node): ReadonlyMap<string, Node> {
  const found = new Map<string, Node>();
  visit(module, (node) => {
    if (node.type === "FunctionDeclaration") {
      const name = identifierName(nodeField(node, "identifier"));
      if (name !== undefined) found.set(name, node);
    } else if (node.type === "VariableDeclarator") {
      const name = identifierName(nodeField(node, "id"));
      const init = nodeField(node, "init");
      if (name !== undefined && isFunction(init)) found.set(name, init);
    }
  });
  return found;
}

/** `<식>.drive(첫 인자)`의 첫 인자가 함수 식이면 그 노드, 같은 파일의 함수 이름이면 선언 본문 */
function driveTargets(module: Node, functions: ReadonlyMap<string, Node>): readonly Node[] {
  const targets: Node[] = [];
  visit(module, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = nodeField(node, "callee");
    const property =
      callee?.type === "MemberExpression" ? nodeField(callee, "property") : undefined;
    if (property === undefined || identifierName(property) !== "drive") return;
    const argument = argumentsOf(node).at(0);
    if (isFunction(argument)) {
      targets.push(argument);
      return;
    }
    const name = identifierName(argument);
    const declared = name === undefined ? undefined : functions.get(name);
    if (declared !== undefined) targets.push(declared);
  });
  return targets;
}

/** 모듈 안 `fs` 계열 import가 만든 지역 이름 */
function fsBindings(module: Node): ReadonlySet<string> {
  const names = new Set<string>();
  for (const item of nodesOf(module["body"])) {
    if (item.type !== "ImportDeclaration") continue;
    const source = nodeField(item, "source");
    const from = source === undefined ? undefined : stringField(source, "value");
    if (from === undefined || !FS_MODULES.has(from)) continue;
    for (const specifier of nodesOf(item["specifiers"])) {
      const local = identifierName(nodeField(specifier, "local"));
      if (local !== undefined) names.add(local);
    }
  }
  return names;
}

/** 함수 노드 안에서 선언한 이름: 매개변수와 변수 선언 */
function localNames(fn: Node): ReadonlySet<string> {
  const names = new Set<string>();
  const collect = (pattern: Node): void => {
    visit(pattern, (node) => {
      if (node.type === "Identifier") {
        const name = stringField(node, "value");
        if (name !== undefined) names.add(name);
      }
    });
  };
  for (const param of nodesOf(fn["params"])) collect(param);
  visit(fn, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = nodeField(node, "id");
    if (id !== undefined) collect(id);
  });
  return names;
}

/** 모듈 안에서 `let`·`var`로 선언한 변수 이름과 선언 노드의 span */
function mutableDeclarations(module: Node): readonly { name: string; span: Span }[] {
  const found: { name: string; span: Span }[] = [];
  visit(module, (node) => {
    if (node.type !== "VariableDeclaration") return;
    const kind = stringField(node, "kind");
    if (kind !== "let" && kind !== "var") return;
    for (const declarator of nodesOf(node["declarations"])) {
      const name = identifierName(nodeField(declarator, "id"));
      if (name !== undefined) found.push({ name, span: node.span });
    }
  });
  return found;
}

function inside(inner: Span, outer: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

interface RawFinding {
  readonly code: DriveScanCode;
  readonly severity: "error" | "warning";
  readonly span: Span;
  readonly target: string;
  readonly message: string;
}

/** drive 함수 하나(중첩 함수 포함)를 검사한다. `helperDepth`가 1이면 같은 파일 함수 호출을 따라가지 않는다 */
function scanFunction(
  module: Node,
  fn: Node,
  fs: ReadonlySet<string>,
  functions: ReadonlyMap<string, Node>,
  followHelpers: boolean,
): readonly RawFinding[] {
  const raw: RawFinding[] = [];
  const mutable = mutableDeclarations(module).filter((entry) => !inside(entry.span, fn.span));
  const locals = localNames(fn);
  const helpers: Node[] = [];

  const add = (
    code: DriveScanCode,
    node: Node,
    target: string,
    message: string,
    severity: "error" | "warning" = "error",
  ): void => {
    raw.push({ code, severity, span: node.span, target, message });
  };

  visit(fn, (node, parent) => {
    const key = memberKey(node);
    if (key !== undefined) {
      const rule = MEMBER_RULES.get(key);
      if (rule !== undefined) add(rule.code, node, key, rule.message);
      else if (key.startsWith("Bun.")) add("SD-09", node, key, IO);
      const object = identifierName(nodeField(node, "object"));
      if (object !== undefined && fs.has(object)) add("SD-08", node, key, IO);
    }
    if (node.type === "NewExpression") {
      const callee = identifierName(nodeField(node, "callee"));
      if (callee === "Date" && argumentsOf(node).length === 0) {
        add("SD-02", node, "new Date()", CLOCK_SHORT);
      }
    }
    if (node.type === "CallExpression") {
      const callee = identifierName(nodeField(node, "callee"));
      if (callee === "fetch") add("SD-07", node, "fetch", IO);
      if (callee !== undefined && fs.has(callee)) add("SD-08", node, callee, IO);
      const helper = callee === undefined ? undefined : functions.get(callee);
      if (helper !== undefined && helper !== fn) helpers.push(helper);
    }
    if (node.type === "Identifier" && parent?.type !== "MemberExpression") {
      const name = stringField(node, "value");
      if (name !== undefined && fs.has(name) && parent?.type !== "CallExpression") {
        add("SD-08", node, name, IO);
      }
    }
    const assigned =
      node.type === "AssignmentExpression"
        ? identifierName(nodeField(node, "left"))
        : node.type === "UpdateExpression"
          ? identifierName(nodeField(node, "argument"))
          : undefined;
    if (assigned !== undefined && !locals.has(assigned)) {
      if (mutable.some((entry) => entry.name === assigned)) {
        add("SD-10", node, assigned, STATE, "warning");
      }
    }
  });

  if (!followHelpers) return raw;
  const further = helpers.flatMap((helper) => scanFunction(module, helper, fs, functions, false));
  return [...raw, ...further];
}

function dedupe(findings: readonly RawFinding[]): readonly RawFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.span.start}:${finding.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 소스 문자열에서 drive 함수 본문을 찾아 재생 규율(F.extensions.spec §4.6, ADR-0015 §3.2)을 검사한다. 순수 함수(L3.group-kit.spec §3.11).
 * 대상은 `<식>.drive(` 호출의 첫 인자 함수와, 같은 파일에서 그 이름으로 선언한 함수다. 본문이 직접 부르는 같은 파일의
 * 함수는 한 단계만 따라간다. 다른 모듈은 검사하지 않는다. 구문 오류가 있으면 `SD-00` 오류 하나를 돌려준다 [제안]
 */
export function scanDriveSource(
  source: string,
  options: DriveScanOptions = {},
): readonly DriveScanFinding[] {
  const parsed = attempt(() =>
    parseSync(source, {
      syntax: "typescript",
      tsx: options.fileName?.endsWith(".tsx") === true,
      target: "es2022",
    }),
  );
  if (!parsed.ok) {
    const message =
      parsed.error.cause instanceof Error ? parsed.error.cause.message : "parse failed";
    return [{ code: "SD-00", severity: "error", line: 1, column: 1, target: "source", message }];
  }
  const module: Node = { ...parsed.value, type: "Module" };
  const where = positioner(source, parsed.value.span.start);
  const functions = functionsByName(module);
  const fs = fsBindings(module);
  const raw = dedupe(
    driveTargets(module, functions).flatMap((fn) => scanFunction(module, fn, fs, functions, true)),
  );
  return raw
    .toSorted((a, b) => a.span.start - b.span.start)
    .map((finding) => {
      const { line, column } = where(finding.span.start);
      return {
        code: finding.code,
        severity: finding.severity,
        line,
        column,
        target: finding.target,
        message: finding.message,
      };
    });
}
