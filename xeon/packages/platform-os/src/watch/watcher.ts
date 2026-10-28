import { isAbsolute, relative, resolve } from "node:path";
import { eachAsync, err, ok, type Logger, type Result, type Scheduler } from "@xeon/contracts";
import type { FileChange, WatchError, WatchHandle, WatchOptions } from "@xeon/contracts/services";

// L0.os.spec §3.8. 앱 설정·스킬·플러그인 디렉터리 감시. 백엔드는 좁은 포트(WatchBackend) 뒤에 둔다. 승인된 외부 의존이
// 없는 지금은 fs.watch 구현이 기본이고, `@parcel/watcher` 어댑터는 승인 뒤 같은 포트를 구현하는 1커밋으로 더한다
// [결정: 오케스트레이터 기본값].

const DEFAULT_WATCH_DEBOUNCE_MS = 100;
const MAX_WATCH_DEBOUNCE_MS = 5000;

/** 백엔드 포트. 원시 변경을 그대로 통지한다(디바운스와 경로 검사는 FileWatcher가 한다) */
export interface WatchBackend {
  readonly id: string;
  subscribe(
    root: string,
    ignore: readonly string[],
    onRaw: (changes: readonly FileChange[]) => void,
  ): Promise<Result<WatchHandle, WatchError>>;
}

export interface FileWatcher {
  watch(
    root: string,
    opts: WatchOptions,
    onBatch: (changes: readonly FileChange[]) => void,
  ): Promise<Result<WatchHandle, WatchError>>;
  /** 열린 감시를 모두 닫는다(서비스 dispose) */
  closeAll(): Promise<void>;
}

export interface FileWatcherDeps {
  /** 감시를 허용하는 루트. OsDirs의 config·data·state와 조립 루트가 넘긴 추가 루트(워크트리 등) */
  readonly allowedRoots: readonly string[];
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 앞에서부터 시도한다. 비어 있으면 backend_unavailable */
  readonly backends: readonly WatchBackend[];
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** glob 하나를 정규식으로 옮긴다. `**`는 경로 구분자를 넘고 `*`와 `?`는 넘지 않는다 */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob.charAt(i + 1) === "*") {
        i += 1;
        if (glob.charAt(i + 1) === "/") i += 1;
        source += "(?:.*/)?";
        continue;
      }
      source += "[^/]*";
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function ignoreMatcher(root: string, ignore: readonly string[]): (path: string) => boolean {
  const patterns = ignore.map(globToRegExp);
  if (patterns.length === 0) return () => false;
  return (path) => {
    const rel = relative(root, path).split("\\").join("/");
    return patterns.some((p) => p.test(rel));
  };
}

/**
 * 같은 경로의 앞 변경과 새 변경을 합친다. 만들고 고친 파일은 create, 지우고 다시 만든 파일은 update로 남기고,
 * 그 밖에는 마지막 상태가 이긴다.
 */
function mergeChange(before: FileChange | undefined, next: FileChange): FileChange {
  if (before === undefined) return next;
  if (before.type === "create" && next.type === "update") return before;
  if (before.type === "delete" && next.type === "create")
    return { type: "update", path: next.path };
  return next;
}

export function createFileWatcher(deps: FileWatcherDeps): FileWatcher {
  const allowed = deps.allowedRoots.map((r) => resolve(r));
  const open = new Set<WatchHandle>();

  return {
    async watch(root, opts, onBatch) {
      const target = resolve(root);
      if (!allowed.some((a) => isInside(a, target))) {
        return err({ kind: "outside_app_dirs", path: root });
      }
      const debounceMs = Math.min(
        MAX_WATCH_DEBOUNCE_MS,
        Math.max(0, opts.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS),
      );
      const ignore = opts.ignore ?? [];
      const isIgnored = ignoreMatcher(target, ignore);

      let closed = false;
      let timer: ReturnType<Scheduler["setTimeout"]> | undefined;
      /** 경로별 마지막 상태. 삽입 순서를 유지한다 */
      const pending = new Map<string, FileChange>();
      const flush = (): void => {
        timer = undefined;
        if (closed || pending.size === 0) return;
        const batch = [...pending.values()];
        pending.clear();
        onBatch(batch);
      };
      const onRaw = (changes: readonly FileChange[]): void => {
        if (closed) return;
        for (const change of changes) {
          if (isIgnored(change.path)) continue;
          const before = pending.get(change.path);
          pending.delete(change.path);
          pending.set(change.path, mergeChange(before, change));
        }
        if (pending.size > 0 && timer === undefined) {
          timer = deps.scheduler.setTimeout(flush, debounceMs);
        }
      };

      let lastError: WatchError = { kind: "backend_unavailable", reason: "no backend" };
      const opened = await eachAsync<WatchBackend, Result<WatchHandle, WatchError>>(
        deps.backends,
        async (backend) => {
          const sub = await backend.subscribe(target, ignore, onRaw);
          if (sub.ok) {
            const handle: WatchHandle = {
              async close() {
                if (closed) return;
                closed = true;
                open.delete(handle);
                if (timer !== undefined) deps.scheduler.clearTimeout(timer);
                timer = undefined;
                pending.clear();
                await sub.value.close();
              },
            };
            open.add(handle);
            return { value: ok(handle) };
          }
          lastError = sub.error;
          // 경로가 없는 것은 백엔드 문제가 아니라 호출 문제다. 다음 백엔드로 넘기지 않는다
          if (sub.error.kind === "not_found") return { value: sub };
          deps.logger.warn("os.watch.backend_failed", {
            backend: backend.id,
            kind: sub.error.kind,
          });
          return undefined;
        },
      );
      return opened === undefined ? err(lastError) : opened.value;
    },
    async closeAll() {
      await Promise.all([...open].map((handle) => handle.close()));
    },
  };
}
