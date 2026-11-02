import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { attemptAsync, detach, err, ok, type Logger } from "@fresnel/contracts";
import type { FileChange, WatchError } from "@fresnel/contracts/services";
import type { WatchBackend } from "./watcher.ts";

// node:fs.watch(recursive) 백엔드. 새 의존 없이 Linux(inotify)·macOS(FSEvents)에서 돈다. 이벤트는 파일 이름만 주므로
// 종류는 stat으로 정한다: rename이고 파일이 없으면 delete, 있으면 처음 보는 경로는 create, 아는 경로는 update.

function errnoOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function toWatchError(root: string, caught: unknown): WatchError {
  const code = errnoOf(caught);
  if (code === "ENOENT" || code === "ENOTDIR") return { kind: "not_found", path: root };
  if (code === "ENOSPC" || code === "EMFILE") {
    return { kind: "limit_reached", backend: "native", detail: code };
  }
  return { kind: "backend_unavailable", reason: code };
}

export function createFsWatchBackend(deps: {
  readonly logger: Logger;
  /**
   * `fs.watch`가 돌아온 뒤 통지가 시작되기까지 기다릴 시간(ms). 시작 신호가 없어서 기다린 뒤에 구독을 돌려준다. 그래서
   * 호출자가 감시가 시작됐다는 반환을 받은 뒤의 변경은 놓치지 않는다. 기본 0(select.ts의 `watchStartMs`가 OS별로 정한다)
   */
  readonly startMs?: number;
}): WatchBackend {
  const startMs = deps.startMs ?? 0;
  return {
    id: "fs-watch",
    async subscribe(root, _ignore, onRaw) {
      const exists = await attemptAsync(() => stat(root));
      if (!exists.ok) return err(toWatchError(root, exists.error.cause));
      const known = new Set<string>();
      let watcher: FSWatcher;
      try {
        watcher = watch(root, { recursive: true }, (eventType, filename) => {
          if (typeof filename !== "string") return;
          const path = join(root, filename);
          detach(
            attemptAsync(() => stat(path)).then((found) => {
              let change: FileChange;
              if (!found.ok) {
                known.delete(path);
                change = { type: "delete", path };
              } else if (eventType === "rename" && !known.has(path)) {
                known.add(path);
                change = { type: "create", path };
              } else {
                known.add(path);
                change = { type: "update", path };
              }
              onRaw([change]);
              return change;
            }),
            (cause) => {
              deps.logger.warn("os.watch.fs_watch_error", { root, code: errnoOf(cause) });
            },
          );
        });
      } catch (caught) {
        return err(toWatchError(root, caught));
      }
      watcher.on("error", (caught) => {
        deps.logger.warn("os.watch.fs_watch_error", { root, code: errnoOf(caught) });
      });
      if (startMs > 0) await sleep(startMs);
      return ok({
        close() {
          watcher.close();
          return Promise.resolve();
        },
      });
    },
  };
}
