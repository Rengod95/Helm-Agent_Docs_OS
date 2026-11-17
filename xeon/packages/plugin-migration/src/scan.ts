// 어댑터들을 루트마다 돌려 `MigrationScan`을 만든다. 읽기 전용이고 결정적이다(항목은 경로, 키 순서).
import { agentSkillsAdapter } from "./adapters/agent-skills.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { mcpJsonAdapter } from "./adapters/mcp-json.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type MigrationScan,
  type ScanContext,
  type ScanDiagnostic,
  type ScanFs,
  type ScanLimits,
  type ScanRoot,
  type SourceAdapter,
  type SourceItem,
} from "./types.ts";

/** 첫 조각의 어댑터. 새 하네스는 어댑터 하나와 규칙표 하나를 더한다 */
export const FIRST_PIECE_ADAPTERS: readonly SourceAdapter[] = [
  mcpJsonAdapter,
  agentSkillsAdapter,
  claudeCodeAdapter,
];

export interface ScanInput {
  readonly roots: readonly ScanRoot[];
  readonly fs: ScanFs;
  readonly ctx: ScanContext;
  readonly adapters?: readonly SourceAdapter[];
  readonly limits?: ScanLimits;
}

function byItem(a: SourceItem, b: SourceItem): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  const keyA = a.keyPath ?? "";
  const keyB = b.keyPath ?? "";
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

/** 훑기. 같은 `itemId`가 두 번 나오면(같은 폴더를 두 루트가 겹쳐 훑은 경우) 첫 항목만 둔다 */
export async function scanRoots(input: ScanInput): Promise<MigrationScan> {
  const limits = input.limits ?? DEFAULT_SCAN_LIMITS;
  const adapters = input.adapters ?? FIRST_PIECE_ADAPTERS;
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const scanned = new Set<string>();
  const results = await Promise.all(
    input.roots.flatMap((root) =>
      adapters.map((adapter) => adapter.scan(root, input.fs, limits, input.ctx)),
    ),
  );
  for (const result of results) {
    for (const item of result.items) {
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      items.push(item);
    }
    diagnostics.push(...result.diagnostics);
    for (const path of result.scanned) scanned.add(path);
  }
  return {
    roots: input.roots,
    scanned: [...scanned].toSorted(),
    items: items.toSorted(byItem),
    diagnostics,
    limits,
  };
}
