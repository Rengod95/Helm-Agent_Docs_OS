import type { CancelScope, ExecutionEnv } from "@xeon/contracts/services";
import { WorkspaceFailure } from "../errors.ts";
import { getOrThrow } from "../upstream/get-or-throw.ts";

// L2.workspace.spec §4.4 원자적 쓰기와 동시 변경 감지 [결정: 오케스트레이터 기본값, 미결 4].
// 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다. 쓰는 도중 프로세스가 죽어도 대상 파일은 원본이거나 새 내용 전체다.

/** 원자적 쓰기가 쓰는 파일 시스템 메서드 */
export type AtomicEnv = Pick<
  ExecutionEnv,
  "readTextFile" | "writeFile" | "flushFile" | "renameFile" | "remove" | "exists" | "joinPath"
>;

export interface AtomicWriteOptions {
  /**
   * 있으면 이름을 바꾸기 직전에 대상 파일을 다시 읽어 이 내용과 같은지 본다. 다르거나 파일이 없어졌으면
   * `edit_conflict`로 거부하고 대상은 그대로 둔다(읽은 뒤 다른 프로세스나 `bash`가 파일을 바꾼 경우).
   * 확인과 이름 바꾸기 사이의 틈은 남는다. 이 검사는 잠금이 아니라 덮어쓰기 위험을 줄이는 감지다.
   */
  readonly expectedBefore?: string;
}

/** 임시 파일 이름의 접두. 죽은 쓰기가 남긴 파일을 알아보는 표지 */
const ATOMIC_TEMP_MARK = ".xeon-tmp-";

function splitName(path: string): { readonly dir: string; readonly name: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

/** 같은 디렉터리의 임시 파일 경로. 이름 바꾸기가 같은 파일 시스템 안에서 일어나게 한다 */
function tempPathFor(path: string, id: string): string {
  const { dir, name } = splitName(path);
  return `${dir}.${name}${ATOMIC_TEMP_MARK}${id}`;
}

function conflict(path: string, reason: "changed" | "removed"): WorkspaceFailure {
  return new WorkspaceFailure(
    "edit_conflict",
    `The file changed since it was read, so nothing was written: ${path}. Read it again and redo the edit.`,
    { detail: { reason, path } },
  );
}

function abortIfAsked(context: CancelScope): void {
  if (context.abortSignal?.aborted === true) {
    throw new WorkspaceFailure("aborted", "The operation was aborted.");
  }
}

/**
 * 임시 파일 정리. 정리가 실패해도 호출한 쪽의 원래 실패를 먼저 알려야 하므로 결과를 보지 않는다.
 * 취소된 호출의 신호로 지우면 정리까지 취소되므로 신호 없는 문맥을 쓴다.
 */
async function discard(env: AtomicEnv, temp: string): Promise<void> {
  await env.remove(temp, { force: true }, { abortSignal: undefined });
}

/**
 * `path`(정규 경로)에 `content`를 원자적으로 쓴다. 부모 디렉터리가 없으면 만든다(`writeFile`이 만든다).
 * 실패하면 임시 파일을 지우고 대상은 건드리지 않는다.
 */
export async function atomicWrite(
  env: AtomicEnv,
  path: string,
  content: string,
  context: CancelScope,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const temp = tempPathFor(path, crypto.randomUUID());
  try {
    abortIfAsked(context);
    getOrThrow(await env.writeFile(temp, content, context));
    // 디스크에 내려간 뒤에 이름을 바꾼다. 그렇지 않으면 전원 손실 뒤 빈 파일이 대상이 될 수 있다
    getOrThrow(await env.flushFile(temp, context));
    if (options.expectedBefore !== undefined) {
      const now = await env.readTextFile(path, context);
      if (!now.ok) {
        if (now.error.code === "not_found") throw conflict(path, "removed");
        throw now.error;
      }
      if (now.value !== options.expectedBefore) throw conflict(path, "changed");
    }
    abortIfAsked(context);
    getOrThrow(await env.renameFile(temp, path, context));
  } catch (caught) {
    await discard(env, temp);
    throw caught;
  }
}
