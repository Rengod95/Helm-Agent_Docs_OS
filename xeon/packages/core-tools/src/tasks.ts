import { err, ok, type Result } from "@xeon/contracts";
import type {
  ExecService,
  LockRequest,
  TaskScope,
  TaskService,
  ToolRunContext,
} from "@xeon/contracts/services";
import type { LockDecl } from "./types.ts";

// L1.tools.spec §4.2 7a~7c, §4.12. 태스크 엔진 연결: tool 범위 노드와 잠금 키 산출.

export type ToolTasks = Pick<TaskService, "find" | "openScope" | "locks">;
export type LockEnv = Pick<ExecService, "id" | "canonicalPath" | "absolutePath">;

export interface ToolScopeHandle {
  readonly node: TaskScope;
  /** 10단계 커밋(또는 중단) 뒤 노드를 정착시킨다. 두 번 불러도 된다 */
  readonly release: () => void;
  /** node.track이 돌려준 Promise. release 뒤 이행한다 */
  readonly tracked: Promise<void>;
}

/**
 * turn 노드 아래에 tool 노드를 열고 7a~10단계를 노드의 작업으로 등록한다.
 * turn 노드가 없으면(재개 직후 등) 노드 없이 실행한다.
 */
export function openToolScope(
  tasks: ToolTasks | undefined,
  run: ToolRunContext,
  toolCallId: string,
): ToolScopeHandle | undefined {
  if (tasks === undefined) return undefined;
  const turn = tasks.find("turn", run.turnId);
  if (turn === undefined) return undefined;
  const node = tasks.openScope(turn, { kind: "tool", id: toolCallId });
  const done = Promise.withResolvers<void>();
  const tracked = node.track(done.promise);
  return {
    node,
    release: () => {
      done.resolve();
    },
    tracked,
  };
}

export type LockKeyError = { readonly kind: "lock_path_unresolved"; readonly path: string };

function splitParent(
  path: string,
): { readonly parent: string; readonly sep: string; readonly name: string } | undefined {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index <= 0) return undefined;
  return { parent: path.slice(0, index), sep: path.charAt(index), name: path.slice(index + 1) };
}

/** 정규 경로. 없는 파일은 부모 정규 경로 + 이름이다(L1.tools.spec §4.2 7b) */
async function realPathOf(
  env: LockEnv,
  path: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const context = { abortSignal: signal };
  const direct = await env.canonicalPath(path, context);
  if (direct.ok) return direct.value;
  if (direct.error.code !== "not_found") return undefined;
  const absolute = await env.absolutePath(path, context);
  if (!absolute.ok) return undefined;
  const parts = splitParent(absolute.value);
  if (parts === undefined) return undefined;
  const parent = await env.canonicalPath(parts.parent, context);
  if (!parent.ok) return undefined;
  return `${parent.value}${parts.sep}${parts.name}`;
}

/** 잠금 선언을 키 큐 요청으로 바꾼다. 키는 `${env.id}\0${realpath}`이고 같은 키는 강한 모드 하나로 합친다 */
export async function lockRequests(
  env: LockEnv,
  decls: readonly LockDecl[],
  signal: AbortSignal,
): Promise<Result<readonly LockRequest[], LockKeyError>> {
  const resolved = await Promise.all(decls.map((decl) => realPathOf(env, decl.path, signal)));
  const byKey = new Map<string, LockRequest>();
  for (const [index, decl] of decls.entries()) {
    const real = resolved[index];
    if (real === undefined) return err({ kind: "lock_path_unresolved", path: decl.path });
    const key = `${env.id}\0${real}`;
    const existing = byKey.get(key);
    const mode =
      existing?.mode === "exclusive" || decl.mode === "exclusive" ? "exclusive" : "shared";
    byKey.set(key, { key, mode });
  }
  return ok([...byKey.values()]);
}
