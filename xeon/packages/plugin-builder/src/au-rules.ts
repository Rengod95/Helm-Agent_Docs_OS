import { validateComposition, type ExtensionManifest } from "@fresnel/contracts/extensions";
import type { CapabilityId } from "@fresnel/contracts/capabilities";
import type { DevkitIssue } from "@fresnel/contracts/services";

// L3.authoring.spec §3.5 제작 검사 AU-004, AU-008, AU-010, AU-011. 순수 함수다. validate.ts가 읽은 매니페스트와 소스 글자를 받는다.
// AU-010, AU-011은 소스 글자의 휴리스틱이다(구문 분석이 아니다). 경고라서 거짓 양성이 제작을 막지 않는다.

export interface SourceText {
  readonly file: string;
  readonly text: string;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text.charCodeAt(at) === 10) line += 1;
  return line;
}

/**
 * AU-004: drive 블록 둘(`drive_duplicate`, 오류), on 핸들러의 기능 호출(`on_capability_call`, 오류),
 * 필수 기능의 제공자 없음(`capability_missing`, 경고). 앞의 둘은 F 검사가 이미 낸 `issues`에서 가져오고
 * (매니페스트가 오류로 정규화되지 않아도 보인다), 마지막은 제공자 목록(`providers`)이 있고 매니페스트가 읽힐 때만 본다.
 */
export function au004(
  issues: readonly DevkitIssue[],
  manifest: ExtensionManifest | undefined,
  providers: readonly CapabilityId[] | undefined,
): readonly DevkitIssue[] {
  const aliased = issues
    .filter((entry) => entry.code === "drive_duplicate" || entry.code === "on_capability_call")
    .map((entry) => ({
      severity: "error" as const,
      code: "AU-004",
      path: entry.path,
      message: `${entry.code}: ${entry.message}`,
    }));
  const composition = manifest?.group?.composition;
  if (manifest === undefined || composition === undefined || providers === undefined)
    return aliased;
  const missing = validateComposition(composition, {
    manifest: { plugins: manifest.plugins },
    providers,
  })
    .filter((entry) => entry.code === "capability_missing")
    .map((entry) => ({
      severity: "warning" as const,
      code: "AU-004",
      path: `/group/composition${entry.path}`,
      message: `${entry.code}: ${entry.message}`,
    }));
  return [...aliased, ...missing];
}

/**
 * AU-008(정보): Plugin App(프레임) 화면에 같은 모양을 위젯 카탈로그로 그린 `fallback` 트리가 있다.
 * 트리 후보가 있다는 뜻이므로 선언형으로 낼 수 있는지 다시 본다. `items`는 원본 JSON의 `ui.items`다.
 */
export function au008(items: readonly unknown[]): readonly DevkitIssue[] {
  const found: DevkitIssue[] = [];
  items.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const app = "app" in item ? item.app : undefined;
    const fallback = "fallback" in item ? item.fallback : undefined;
    if (app !== undefined && typeof fallback === "string")
      found.push({
        severity: "info",
        code: "AU-008",
        path: `/ui/items/${String(index)}/app`,
        message: `the frame view has a widget tree (${fallback}) that already draws it: consider the declarative mode`,
      });
  });
  return found;
}

const COSTLY_STEP = /\bloop\.spawn\s*\(|\.delegate\s*\(/;
const ASKS = /\.ask\s*\(/;

/**
 * AU-010(경고): 비용이 드는 단계(서브에이전트 spawn, 위임)가 있는데 사람 확인이 없다.
 * 확인은 소스의 `loop.ask(`, 단계 선언의 `human` 노드, 메서드 선언의 `approval: true` 중 하나다.
 */
export function au010(
  manifest: ExtensionManifest,
  sources: readonly SourceText[],
): readonly DevkitIssue[] {
  const nodes = manifest.group?.composition?.phases?.nodes ?? [];
  const costlyInSource = sources.find((source) => COSTLY_STEP.test(source.text));
  const costly = costlyInSource !== undefined || nodes.some((node) => node.kind === "spawn");
  if (!costly) return [];
  const confirmed =
    sources.some((source) => ASKS.test(source.text)) ||
    nodes.some((node) => node.kind === "human") ||
    (manifest.methods ?? []).some((method) => method.approval === true);
  if (confirmed) return [];
  const match = costlyInSource === undefined ? null : COSTLY_STEP.exec(costlyInSource.text);
  return [
    {
      severity: "warning",
      code: "AU-010",
      path: "/group",
      message:
        "a step that costs (spawn or delegate) has no human confirmation: ask with loop.ask, add a human phase node, or set approval: true",
      ...(costlyInSource === undefined || match === null
        ? {}
        : { file: costlyInSource.file, line: lineOf(costlyInSource.text, match.index) }),
    },
  ];
}

const STATE_USE = /\bg\.(?:commit|state)\s*\(/;
const STATE_DECL = /\bstate\s*:\s*\{[^}]*\bversion\s*:\s*(\d+)/s;
const MIGRATIONS = /\bmigrations\b/;

/**
 * AU-011(경고): 상태 문서를 쓰는데 `state.version`이 없거나, version이 2 이상인데 마이그레이션이 없다
 * (`L3.group-sdk.spec` §4.7).
 */
export function au011(sources: readonly SourceText[]): readonly DevkitIssue[] {
  const found: DevkitIssue[] = [];
  const users = sources.filter((source) => STATE_USE.test(source.text));
  if (users.length === 0) return found;
  const declaring = sources.find((source) => STATE_DECL.test(source.text));
  if (declaring === undefined) {
    const [first] = users;
    found.push({
      severity: "warning",
      code: "AU-011",
      path: "/group",
      message: "the state document is used but no state declaration with a version was found",
      ...(first === undefined ? {} : { file: first.file }),
    });
    return found;
  }
  const version = Number(STATE_DECL.exec(declaring.text)?.[1] ?? "1");
  if (version >= 2 && !sources.some((source) => MIGRATIONS.test(source.text)))
    found.push({
      severity: "warning",
      code: "AU-011",
      path: "/group",
      message: `state.version is ${String(version)} but no migrations were found`,
      file: declaring.file,
    });
  return found;
}
