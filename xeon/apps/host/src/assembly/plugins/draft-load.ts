import { attemptAsync, err, ok, type LogFields, type Result } from "@fresnel/contracts";
import { internalDraftName, type ExtensionLoader } from "@fresnel/ext-host";
import type { DraftUnavailableReason } from "@fresnel/contracts/wire";
import type { DraftLoadRefusal, DraftRef } from "./overlay.ts";

// 초안 싣기(M5c §4.3.8, X.loading-trust.spec §4.9.8). 초안은 격리 프로세스에서만 돈다. 로더의 `loadDraft`가 격리 포트가 없으면
// `isolation_unavailable`로 거부하므로 이 함수는 엔진 안에서 초안을 싣는 길을 갖지 않는다. 싣기는 한 번에 하나씩 돈다(같은 초안을
// 두 대화가 동시에 싣지 않게). 하나라도 못 싣으면 이 호출이 싣은 것을 내리고 실패를 돌려준다.

/** 초안 싣기가 쓰는 로더의 좁은 면. 전체 로더 대신 이 셋만 받아 시험이 대역을 쉽게 세운다 */
export type DraftLoaderPort = Pick<ExtensionLoader, "loadDraft" | "unloadDraft" | "draftOf">;

export interface DraftLoaderDeps {
  /** 로더. 조립이 외부 확장을 싣기 전이면 undefined다(초안은 싣지 못한다) */
  readonly loader: () => DraftLoaderPort | undefined;
  /** 진단 기록. 싣지 못한 초안은 `plugin.overlay.draft_load_failed`로 남긴다 */
  readonly report: (event: string, fields: LogFields) => void;
  /** 초안 하나를 싣는 상한 시간 */
  readonly timeoutMs: number;
}

/** 초안 여러 개를 한 번에 싣는다. 실패하면 이 호출이 싣은 초안은 모두 내린다 */
export type DraftLoad = (drafts: readonly DraftRef[]) => Promise<Result<void, DraftLoadRefusal>>;

export function createDraftLoader(deps: DraftLoaderDeps): DraftLoad {
  let queue: Promise<unknown> = Promise.resolve();
  return (drafts) => {
    const run = queue.then(() => loadAll(deps, drafts));
    // 앞선 싣기가 실패해도 다음 싣기는 기다린다(실패 값은 호출자에게 그대로 간다)
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

async function loadAll(
  deps: DraftLoaderDeps,
  drafts: readonly DraftRef[],
): Promise<Result<void, DraftLoadRefusal>> {
  const loader = deps.loader();
  const first = drafts[0];
  if (first === undefined) return ok(undefined);
  if (loader === undefined) return refused(deps, first.name, "loader_unavailable");
  const fresh: string[] = [];
  // 차례로 싣는다: 앞 초안이 실패하면 뒤 것은 싣지 않는다
  for (const draft of drafts) {
    const internalName = internalDraftName(draft.name, draft.draftId);
    const held = loader.draftOf(internalName);
    // 이미 실린 같은 초안은 다시 싣지 않는다. 식별자가 같으면 내용도 같다(초안 스냅샷은 바뀌지 않는다)
    if (held !== undefined) {
      if (held.contentHash === draft.contentHash) continue;
      // oxlint-disable-next-line no-await-in-loop -- 초안은 차례로 싣는다(앞이 실패하면 뒤는 싣지 않는다) (profile-project-loader §4.3.8)
      await unwind(deps, loader, fresh);
      return refused(deps, draft.name, "content_changed");
    }
    const signal = AbortSignal.timeout(deps.timeoutMs);
    // oxlint-disable-next-line no-await-in-loop -- 초안은 차례로 싣는다(앞이 실패하면 뒤는 싣지 않는다) (profile-project-loader §4.3.8)
    const attempted = await attemptAsync(() =>
      loader.loadDraft(
        {
          plugin: draft.name,
          draftId: draft.draftId,
          root: draft.tree,
          contentHash: draft.contentHash,
        },
        signal,
      ),
    );
    if (!attempted.ok) {
      // oxlint-disable-next-line no-await-in-loop -- 초안은 차례로 싣는다(앞이 실패하면 뒤는 싣지 않는다) (profile-project-loader §4.3.8)
      await unwind(deps, loader, fresh);
      return refused(deps, draft.name, "thrown");
    }
    if (!attempted.value.ok) {
      // oxlint-disable-next-line no-await-in-loop -- 초안은 차례로 싣는다(앞이 실패하면 뒤는 싣지 않는다) (profile-project-loader §4.3.8)
      await unwind(deps, loader, fresh);
      const failure = attempted.value.error;
      // `not_active`는 어느 상태로 왜 켜지지 않았는지(첫 진단 코드)를 같이 남긴다
      const firstDiag = failure.kind === "not_active" ? failure.diagnostics[0] : undefined;
      const extra =
        failure.kind === "not_active"
          ? { state: failure.state, code: firstDiag?.code ?? "none" }
          : {};
      const issue = firstDiag?.issues?.find((candidate) => candidate.severity === "error");
      const detail =
        firstDiag === undefined
          ? undefined
          : firstLineOf(
              issue === undefined
                ? firstDiag.message
                : `${firstDiag.message}: ${issue.path === "" ? "" : `${issue.path} `}${issue.message}`,
            );
      return refused(
        deps,
        draft.name,
        failure.kind,
        detail === undefined ? extra : { ...extra, message: detail },
        detail,
      );
    }
    fresh.push(internalName);
  }
  return ok(undefined);
}

/** 로더가 준 싣기 실패 종류를 와이어의 사유로 옮긴다. 모르는 종류는 `load_failed`다 */
function reasonOfLoadKind(kind: string): DraftUnavailableReason {
  if (kind === "isolation_unavailable" || kind === "loader_unavailable") {
    return "isolation_unavailable";
  }
  if (kind === "safe_mode" || kind === "not_active" || kind === "content_changed") return kind;
  return "load_failed";
}

/** 이 호출이 싣은 초안을 내린다. 내리지 못하면 기록만 남기고 계속한다 */
async function unwind(
  deps: DraftLoaderDeps,
  loader: DraftLoaderPort,
  internalNames: readonly string[],
): Promise<void> {
  for (const internalName of internalNames) {
    // oxlint-disable-next-line no-await-in-loop -- 싣은 초안은 하나씩 차례로 내린다 (profile-project-loader §4.3.8)
    const removed = await attemptAsync(() => loader.unloadDraft(internalName));
    if (!removed.ok) {
      deps.report("plugin.overlay.draft_unload_failed", { name: internalName, kind: "thrown" });
    }
  }
}

/** 진단 문장의 첫 줄. 길면 자른다. 비면 없다 */
function firstLineOf(message: string): string | undefined {
  const line = (message.split("\n")[0] ?? "").trim();
  if (line === "") return undefined;
  return line.length > 300 ? `${line.slice(0, 300)}...` : line;
}

function refused(
  deps: DraftLoaderDeps,
  name: string,
  kind: string,
  extra: LogFields = {},
  detail?: string,
): Result<never, DraftLoadRefusal> {
  const reason = reasonOfLoadKind(kind);
  deps.report("plugin.overlay.draft_load_failed", { name, kind, reason, ...extra });
  return err({ name, kind, reason, ...(detail === undefined ? {} : { detail }) });
}
