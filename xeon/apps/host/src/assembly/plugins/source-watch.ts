import { dirname, sep } from "node:path";
import { sequentially } from "../../util.ts";
import { attemptAsync, type Logger, type Result } from "@fresnel/contracts";
import type {
  FileChange,
  WatchError,
  WatchHandle,
  WatchOptions,
} from "@fresnel/contracts/services";

// 플러그인 원본 폴더 감시(M5c §4.5.7). 사용자 플러그인 폴더와 열린 프로젝트의 `.fresnel/plugins`를 OS 감시로 본다(폴링 없음).
// 바뀌면 훑기(`scan`)를 한 번 돌려 검토 항목을 만든다. 감시는 항목을 직접 만들지 않고 승인도 하지 않는다: 검토본이 아닌 원본은
// 훑기와 검토 항목을 거쳐야 실린다. 저장 중간 상태는 감시 디바운스가 모으고, 같은 내용(같은 해시)은 훑기가 항목을 만들지 않는다.

/** 연달아 오는 변경을 모으는 시간(§4.5.7: 디바운스 1초) */
const SOURCE_WATCH_DEBOUNCE_MS = 1000;
/** 동시에 여는 감시의 상한 [제안: 스펙에 값이 없다. 기계의 감시 한도를 다 쓰지 않게 둔다] */
const SOURCE_WATCH_MAX = 64;

/** 의존 폴더와 버전 관리 폴더의 변경은 원본 내용이 아니다 */
const IGNORE: readonly string[] = ["**/node_modules/**/*", "**/.git/**/*"];

export interface SourceWatchDeps {
  /** `x.loading-trust.sourceWatch`의 지금 값. 거짓이면 감시를 열지 않는다 */
  readonly enabled: () => boolean;
  /** 플러그인 폴더가 들어 있는 위치들(`<config>/plugins`, `<루트>/.fresnel/plugins`). 없는 폴더도 줄 수 있다 */
  readonly containers: () => Promise<readonly string[]>;
  /** 지금 발견된 원본 폴더의 실제 경로들. 위치 밖으로 링크된 원본을 따로 보려고 쓴다 */
  readonly sourceDirs: () => Promise<readonly string[]>;
  /** 폴더가 있는지(없는 위치는 부모에서 돌아오기를 기다린다) */
  readonly exists: (path: string) => Promise<boolean>;
  /** 감시를 연다. 변경은 디바운스를 거친 묶음으로 온다 */
  readonly watch: (
    root: string,
    opts: WatchOptions,
    onBatch: (changes: readonly FileChange[]) => void,
  ) => Promise<Result<WatchHandle, WatchError>>;
  /** 훑기를 한 번 돈다(검토 항목 생성). 실패는 부르는 쪽이 기록한다 */
  readonly scan: () => Promise<void>;
  readonly logger: Logger;
  readonly debounceMs?: number;
  readonly maxWatches?: number;
}

export interface SourceWatch {
  /** 감시 집합을 지금 위치들과 맞춘다(열린 프로젝트가 바뀌었거나 설정이 바뀐 뒤). 꺼져 있으면 전부 닫는다 */
  sync(): Promise<void>;
  /** 열린 감시를 모두 닫고 진행 중인 훑기를 기다린다 */
  close(): Promise<void>;
}

interface Target {
  /** 열 폴더 */
  readonly root: string;
  /** 이 폴더 밑에서 바뀐 경로만 훑기를 부른다(부모를 보는 경우 위치 자신만) */
  readonly interest: string;
  /** 부모에서 위치가 돌아오기를 기다리는 감시인가 */
  readonly waiting: boolean;
}

function isInside(base: string, path: string): boolean {
  return path === base || path.startsWith(base + sep);
}

function keyOf(target: Target): string {
  return `${target.waiting ? "wait" : "own"}:${target.root}`;
}

export function createSourceWatch(deps: SourceWatchDeps): SourceWatch {
  const debounceMs = deps.debounceMs ?? SOURCE_WATCH_DEBOUNCE_MS;
  const maxWatches = deps.maxWatches ?? SOURCE_WATCH_MAX;
  const open = new Map<string, WatchHandle>();
  const state: { closed: boolean; dirty: boolean; running: Promise<void> | undefined } = {
    closed: false,
    dirty: false,
    running: undefined,
  };
  // 맞추기는 한 줄로 돈다. 훑는 동안 온 변경은 끝난 뒤 한 번 더 훑는다
  const chain: { tail: Promise<void> } = { tail: Promise.resolve() };

  function isDirty(): boolean {
    return state.dirty;
  }

  function isClosed(): boolean {
    return state.closed;
  }

  async function targetsOf(): Promise<readonly Target[]> {
    const containers = [...new Set(await deps.containers())];
    const found = await Promise.all(
      containers.map(async (container): Promise<Target | undefined> => {
        if (await deps.exists(container)) {
          return { root: container, interest: container, waiting: false };
        }
        // 없는 위치: 부모가 있으면 부모에서 위치가 만들어지는 것만 기다린다(프로젝트 루트 전체는 보지 않는다)
        const parent = dirname(container);
        if (parent !== container && (await deps.exists(parent))) {
          return { root: parent, interest: container, waiting: true };
        }
        return undefined;
      }),
    );
    const targets: Target[] = found.filter((target) => target !== undefined);
    // 위치 밖으로 링크된 원본 폴더는 따로 본다(발견이 링크를 풀어 실제 경로를 준다)
    const seen = new Set(targets.map(keyOf));
    for (const dir of await deps.sourceDirs()) {
      if (containers.some((container) => isInside(container, dir))) continue;
      const target: Target = { root: dir, interest: dir, waiting: false };
      if (seen.has(keyOf(target))) continue;
      seen.add(keyOf(target));
      targets.push(target);
    }
    return targets;
  }

  function onBatch(target: Target, changes: readonly FileChange[]): void {
    if (isClosed()) return;
    const relevant = target.waiting
      ? changes.some((change) => change.path === target.interest)
      : changes.some((change) => isInside(target.interest, change.path));
    if (relevant) trigger();
  }

  async function openTarget(target: Target): Promise<void> {
    const key = keyOf(target);
    if (open.has(key) || isClosed()) return;
    const opened = await deps.watch(target.root, { debounceMs, ignore: IGNORE }, (changes) => {
      onBatch(target, changes);
    });
    if (!opened.ok) {
      // 열지 못한 감시는 그 위치만 못 본다. 훑기(`plugin.scan`)로는 계속 반영된다
      deps.logger.warn("plugin.watch.open_failed", { root: target.root, kind: opened.error.kind });
      return;
    }
    // 여는 동안 닫혔으면 바로 닫는다
    if (isClosed()) {
      await opened.value.close();
      return;
    }
    open.set(key, opened.value);
  }

  async function applySync(): Promise<void> {
    if (isClosed()) return;
    const wanted = deps.enabled() ? await targetsOf() : [];
    const capped = wanted.slice(0, maxWatches);
    if (wanted.length > capped.length) {
      deps.logger.warn("plugin.watch.limit", { wanted: wanted.length, max: maxWatches });
    }
    const keep = new Set(capped.map(keyOf));
    const stale = [...open].filter(([key]) => !keep.has(key));
    for (const [key] of stale) open.delete(key);
    await Promise.all(stale.map(([, handle]) => handle.close()));
    await sequentially(capped, openTarget);
  }

  async function syncOnce(): Promise<void> {
    const done = await attemptAsync(applySync);
    if (!done.ok) {
      deps.logger.warn("plugin.watch.sync_failed", { reason: String(done.error.cause) });
    }
  }

  function sync(): Promise<void> {
    chain.tail = chain.tail.then(syncOnce);
    return chain.tail;
  }

  async function scanLoop(): Promise<void> {
    state.dirty = false;
    const done = await attemptAsync(deps.scan);
    if (!done.ok) {
      deps.logger.warn("plugin.watch.scan_failed", { reason: String(done.error.cause) });
    }
    // 위치가 지워졌다 돌아왔을 수 있다: 감시 집합을 다시 맞춘다
    await sync();
    if (isDirty() && !isClosed()) await scanLoop();
  }

  function trigger(): void {
    if (isClosed()) return;
    if (state.running !== undefined) {
      state.dirty = true;
      return;
    }
    state.running = scanLoop().finally(() => {
      state.running = undefined;
    });
  }

  return {
    sync,
    async close() {
      state.closed = true;
      const handles = [...open.values()];
      open.clear();
      await Promise.all(handles.map((handle) => handle.close()));
      await state.running;
      await chain.tail;
    },
  };
}
