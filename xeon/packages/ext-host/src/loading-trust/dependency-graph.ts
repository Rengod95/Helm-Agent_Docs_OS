import {
  dependenciesOf,
  pluginsOf,
  type DependencyKind,
  type ExtensionManifest,
  type PluginDependency,
} from "@fresnel/contracts/extensions";
import { satisfiesRange } from "./semver.ts";

// 플러그인 사이의 의존(`PluginDecl.dependsOn`, AGE-33)을 계산하는 순수 함수. 저장 상태를 읽지 않고 쓰지도 않는다.
// 설치·프로필·끄기·삭제·업데이트가 같은 함수로 같은 답을 얻는다. 규칙(F.extensions.spec 의존 관계):
// hard는 대상이 없거나 범위가 맞지 않으면 막고, soft는 알리기만 한다. 켜는 순서는 hard 대상이 먼저이며 Hook 호출 순서는 바꾸지 않는다.

/** 의존 계산이 보는 확장 한 개(설치되어 검토를 지난 판) */
export interface DependencyNode {
  readonly name: string;
  readonly version: string;
  readonly manifest: ExtensionManifest;
}

/** 의존 한 줄이 맞지 않는 까닭 */
export type DependencyProblemCode =
  /** 대상 확장이 없다(설치하지 않았거나 승인 전이다) */
  | "target_missing"
  /** 대상 확장은 있으나 가리킨 구성원이 없다 */
  | "member_missing"
  /** 대상 버전이 `range`를 만족하지 않는다 */
  | "range_unmet"
  /** 대상이 이 프로필에서 꺼져 있다(프로필 검증에서만 쓴다) */
  | "target_disabled";

export interface DependencyProblem {
  readonly code: DependencyProblemCode;
  readonly from: string;
  readonly target: string;
  readonly kind: DependencyKind;
  readonly range: string | null;
  /** `range_unmet`에서 찾은 대상 버전 */
  readonly found: string | null;
}

export interface DependencyReport {
  /** 설치와 승인을 막는 문제(hard) */
  readonly blocking: readonly DependencyProblem[];
  /** 알리기만 하는 문제(soft) */
  readonly warnings: readonly DependencyProblem[];
}

function problemOf(
  dependency: PluginDependency,
  code: DependencyProblemCode,
  found: string | null,
): DependencyProblem {
  return {
    code,
    from: dependency.from,
    target: dependency.target,
    kind: dependency.kind,
    range: dependency.range,
    found,
  };
}

function reportOf(problems: readonly DependencyProblem[]): DependencyReport {
  return {
    blocking: problems.filter((problem) => problem.kind === "hard"),
    warnings: problems.filter((problem) => problem.kind === "soft"),
  };
}

function hasMember(node: DependencyNode, member: string): boolean {
  return pluginsOf(node.manifest).some((entry) => entry.decl.id === member);
}

/** 한 의존이 이 집합에서 맞는가. 맞으면 undefined다 */
function problemIn(
  dependency: PluginDependency,
  nodes: readonly DependencyNode[],
): DependencyProblem | undefined {
  const node = nodes.find((candidate) => candidate.name === dependency.targetExtension);
  if (node === undefined) return problemOf(dependency, "target_missing", null);
  if (dependency.targetMember !== null && !hasMember(node, dependency.targetMember))
    return problemOf(dependency, "member_missing", null);
  if (dependency.range !== null && !satisfiesRange(node.version, dependency.range))
    return problemOf(dependency, "range_unmet", node.version);
  return undefined;
}

/**
 * 설치와 승인 때의 검사. `subject`의 의존이 `available`(설치되어 승인된 확장)에서 맞는지 본다.
 * 같은 이름이 `available`에 있어도 `subject` 자신을 대상으로 한 의존은 없다(검증이 막는다)
 */
export function checkDependencies(
  subject: DependencyNode,
  available: readonly DependencyNode[],
): DependencyReport {
  const others = available.filter((node) => node.name !== subject.name);
  return reportOf(
    dependenciesOf(subject.manifest).flatMap((dependency) => {
      const problem = problemIn(dependency, others);
      return problem === undefined ? [] : [problem];
    }),
  );
}

/** 이 확장(또는 `이름/id` 구성원)에 기대는 의존 한 줄과 기댄 확장 */
export interface Dependent {
  readonly extension: string;
  readonly dependency: PluginDependency;
}

/**
 * `target`(확장 이름 또는 Registration id)에 기대는 의존을 모은다. 확장 이름을 주면 그 확장의 구성원을 가리킨 의존도 포함한다.
 * `Registration id`를 주면 그 구성원을 가리킨 의존과 확장 전체를 가리킨 의존(루트)만 포함한다
 */
export function dependentsOf(
  target: string,
  nodes: readonly DependencyNode[],
): readonly Dependent[] {
  const slash = target.indexOf("/");
  const extension = slash === -1 ? target : target.slice(0, slash);
  const member = slash === -1 ? null : target.slice(slash + 1);
  return nodes
    .filter((node) => node.name !== extension)
    .flatMap((node) =>
      dependenciesOf(node.manifest)
        .filter((dependency) => {
          if (dependency.targetExtension !== extension) return false;
          if (member === null) return true;
          return dependency.targetMember === member || dependency.targetMember === null;
        })
        .map((dependency) => ({ extension: node.name, dependency })),
    );
}

/** 끄기나 삭제를 막는 hard 의존자. `enabled`에 든 확장만 센다(꺼진 확장은 기대지 않는다) */
export function blockingDependents(
  removing: readonly string[],
  nodes: readonly DependencyNode[],
  enabled: ReadonlySet<string>,
): readonly Dependent[] {
  const removingExtensions = new Set(removing.map((name) => name.split("/")[0] ?? name));
  const seen = new Set<string>();
  const found: Dependent[] = [];
  for (const name of removing) {
    for (const dependent of dependentsOf(name, nodes)) {
      if (dependent.dependency.kind !== "hard") continue;
      if (removingExtensions.has(dependent.extension)) continue;
      if (!enabled.has(dependent.extension)) continue;
      const key = `${dependent.dependency.from}->${dependent.dependency.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(dependent);
    }
  }
  return found;
}

/** 업데이트가 깨는 의존. `next`가 새 판이고 `nodes`는 지금 설치된 모든 확장이다(`next.name`의 옛 판 포함) */
export function updateBreaks(
  next: DependencyNode,
  nodes: readonly DependencyNode[],
): readonly DependencyProblem[] {
  return dependentsOf(next.name, nodes).flatMap(({ dependency }) => {
    const problem = problemIn(dependency, [next]);
    return problem === undefined ? [] : [problem];
  });
}

/**
 * 프로필이 켜는 이름 목록에서 모자란 대상. 대상이 목록에 없으면 `target_disabled`(설치되지 않았으면 `target_missing`)다.
 * 이름은 확장 이름이다. 자동으로 켜지 않고 화면이 "함께 켤까요"를 묻도록 모자란 목록을 값으로 돌려준다
 */
export function missingForEnabled(
  enabledNames: readonly string[],
  nodes: readonly DependencyNode[],
): DependencyReport {
  const enabled = new Set(enabledNames);
  const problems: DependencyProblem[] = [];
  for (const name of enabledNames) {
    const node = nodes.find((candidate) => candidate.name === name);
    if (node === undefined) continue;
    for (const dependency of dependenciesOf(node.manifest)) {
      const inSet = problemIn(dependency, nodes);
      if (inSet !== undefined) problems.push(inSet);
      else if (!enabled.has(dependency.targetExtension))
        problems.push(problemOf(dependency, "target_disabled", null));
    }
  }
  return reportOf(problems);
}

/**
 * 켜는 순서. 입력 순서를 지키되 hard 대상이 먼저 오게 안정적으로 옮긴다(깊이 우선). 입력에 없는 이름은 넣지 않고,
 * 순환(hard 순환은 검사가 막는다)에서는 먼저 만난 쪽을 뒤로 보낼 뿐 순서를 보장하지 않는다. Hook 호출 순서는 이 함수와 무관하다(프로필이 정한다)
 */
export function enableOrder(
  names: readonly string[],
  nodes: readonly DependencyNode[],
): readonly string[] {
  const wanted = new Set(names);
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (name: string): void => {
    if (out.includes(name) || visiting.has(name)) return;
    visiting.add(name);
    const node = nodes.find((candidate) => candidate.name === name);
    if (node !== undefined) {
      for (const dependency of dependenciesOf(node.manifest)) {
        if (dependency.kind === "hard" && wanted.has(dependency.targetExtension))
          visit(dependency.targetExtension);
      }
    }
    visiting.delete(name);
    out.push(name);
  };
  for (const name of names) visit(name);
  return out;
}

/** 이 확장이 기대는 곳과 이 확장에 기대는 곳. 검토 카드가 값으로 싣는다 */
export interface DependencyView {
  readonly dependsOn: readonly (PluginDependency & {
    readonly problem: DependencyProblemCode | null;
  })[];
  readonly dependents: readonly Dependent[];
}

export function dependencyViewOf(
  subject: DependencyNode,
  nodes: readonly DependencyNode[],
): DependencyView {
  const others = nodes.filter((node) => node.name !== subject.name);
  return {
    dependsOn: dependenciesOf(subject.manifest).map((dependency) => ({
      from: dependency.from,
      target: dependency.target,
      targetExtension: dependency.targetExtension,
      targetMember: dependency.targetMember,
      range: dependency.range,
      kind: dependency.kind,
      problem: problemIn(dependency, others)?.code ?? null,
    })),
    dependents: dependentsOf(subject.name, nodes),
  };
}
