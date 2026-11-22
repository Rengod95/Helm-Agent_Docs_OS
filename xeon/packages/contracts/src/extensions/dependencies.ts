import {
  pluginsOf,
  type DependencyDecl,
  type DependencyKind,
  type ExtensionManifest,
} from "./manifest.ts";

// 플러그인 사이의 의존 선언(`PluginDecl.dependsOn`, AGE-33)을 읽는 순수 함수. 선언의 형식 검사는 `validate.ts`가,
// 버전 범위 만족과 설치 상태를 보는 계산은 X(`@fresnel/ext-host`의 dependency-graph)가 한다.

/** 정규화한 의존 한 줄. 선언한 Registration과 가리키는 Registration, 확장 이름을 모두 싣는다 */
export interface PluginDependency {
  /** 의존을 건 Registration id(`<이름>` 또는 `<이름>/<id>`) */
  readonly from: string;
  /** 가리키는 Registration id. 확장 이름만 적었으면 그 루트 플러그인이다 */
  readonly target: string;
  /** 가리키는 확장 이름(`target`의 `/` 앞) */
  readonly targetExtension: string;
  /** 있으면 구성원 id(`target`의 `/` 뒤). 확장 전체를 가리키면 null */
  readonly targetMember: string | null;
  /** 생략하면 어느 버전이든 된다 */
  readonly range: string | null;
  /** 생략하면 soft다 */
  readonly kind: DependencyKind;
}

/** `kind`가 없으면 soft다 */
export function dependencyKindOf(decl: Pick<DependencyDecl, "kind">): DependencyKind {
  return decl.kind ?? "soft";
}

/** 가리키는 Registration id를 확장 이름과 구성원 id로 가른다 */
export function splitDependencyTarget(target: string): {
  readonly extension: string;
  readonly member: string | null;
} {
  const slash = target.indexOf("/");
  if (slash === -1) return { extension: target, member: null };
  return { extension: target.slice(0, slash), member: target.slice(slash + 1) };
}

/** 매니페스트의 모든 플러그인이 건 의존을 모은다. 선언 순서를 지킨다 */
export function dependenciesOf(
  manifest: Pick<ExtensionManifest, "name" | "plugins" | "orchestration">,
): readonly PluginDependency[] {
  return pluginsOf(manifest).flatMap((entry) =>
    (entry.decl.dependsOn ?? []).map((decl) => {
      const { extension, member } = splitDependencyTarget(decl.plugin);
      return {
        from: entry.registrationId,
        target: decl.plugin,
        targetExtension: extension,
        targetMember: member,
        range: decl.range ?? null,
        kind: dependencyKindOf(decl),
      };
    }),
  );
}

/** 이 매니페스트 집합에서 `hard` 의존만으로 이어진 순환. 각 순환은 Registration id를 돌아가는 순서로 담는다. 순환이 없으면 빈 목록이다 */
export function hardDependencyCycles(
  manifests: readonly Pick<ExtensionManifest, "name" | "plugins" | "orchestration">[],
): readonly (readonly string[])[] {
  const edges = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const dependency of dependenciesOf(manifest)) {
      if (dependency.kind !== "hard") continue;
      edges.set(dependency.from, [...(edges.get(dependency.from) ?? []), dependency.target]);
    }
  }
  const cycles: string[][] = [];
  const done = new Set<string>();
  const walk = (node: string, path: readonly string[]): void => {
    const at = path.indexOf(node);
    if (at !== -1) {
      const cycle = path.slice(at);
      const key = [...cycle].toSorted().join("|");
      if (!cycles.some((known) => [...known].toSorted().join("|") === key)) cycles.push(cycle);
      return;
    }
    if (done.has(node)) return;
    for (const next of edges.get(node) ?? []) walk(next, [...path, node]);
    done.add(node);
  };
  for (const node of edges.keys()) walk(node, []);
  return cycles;
}
