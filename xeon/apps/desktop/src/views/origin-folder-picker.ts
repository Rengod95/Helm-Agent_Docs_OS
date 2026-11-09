import { attemptAsync, detach, rethrow } from "@fresnel/contracts";

// 서버 폴더 고르기(L4.remote.spec §6.1). 웹 기기는 작업 폴더가 origin 컴퓨터에 있으므로 OS 창 대신 origin의 폴더 목록을
// `origin_folder_list`로 한 단계씩 보며 고른다. 이 파일은 대화 상자의 상태와 동작이고, 그림은 `origin-folder-dialog.tsx`가 그린다.

/** `origin_folder_list`가 거절한 사유. 셸이 준 글이 둘 중 하나가 아니면 `other`다 */
export type OriginFolderFailure = "bad-request" | "read_failed" | "other";

/** 폴더 하나. `path`는 origin의 절대 경로다 */
interface OriginFolderEntry {
  readonly name: string;
  readonly path: string;
}

export type OriginFolderListing =
  | { readonly kind: "loading"; readonly path: string | null }
  | {
      readonly kind: "ready";
      readonly path: string;
      readonly parent: string | null;
      readonly home: string;
      readonly entries: readonly OriginFolderEntry[];
      readonly truncated: boolean;
    }
  | { readonly kind: "failed"; readonly reason: OriginFolderFailure; readonly path: string | null };

export type OriginFolderState =
  | { readonly open: false }
  | { readonly open: true; readonly listing: OriginFolderListing };

export interface OriginFolderPicker {
  getState: () => OriginFolderState;
  subscribe: (listener: () => void) => () => void;
  /** 대화 상자를 연다. 고르면 절대 경로, 취소하면 undefined다. 열려 있는 동안 다시 열면 앞의 것은 취소된다 */
  open: () => Promise<string | undefined>;
  /** 폴더로 간다. null은 홈이다 */
  navigate: (path: string | null) => void;
  /** 지금 폴더를 고른다. 목록이 준비됐을 때만 된다 */
  choose: () => void;
  cancel: () => void;
  /** 실패한 목록을 같은 경로로 다시 읽는다 */
  retry: () => void;
}

function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor === undefined ? undefined : descriptor.value;
}

function entriesOf(value: unknown): readonly OriginFolderEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: OriginFolderEntry[] = [];
  for (const item of value) {
    const name = fieldOf(item, "name");
    const path = fieldOf(item, "path");
    if (typeof name !== "string" || typeof path !== "string") return null;
    entries.push({ name, path });
  }
  return entries;
}

/** 목록 답을 읽는다. 모양이 틀리면 null이다 */
export function listingOf(reply: unknown): Extract<OriginFolderListing, { kind: "ready" }> | null {
  const path = fieldOf(reply, "path");
  const parent = fieldOf(reply, "parent");
  const home = fieldOf(reply, "home");
  const truncated = fieldOf(reply, "truncated");
  const entries = entriesOf(fieldOf(reply, "entries"));
  if (typeof path !== "string" || typeof home !== "string" || typeof truncated !== "boolean") {
    return null;
  }
  if (parent !== null && typeof parent !== "string") return null;
  if (entries === null) return null;
  return { kind: "ready", path, parent, home, entries, truncated };
}

/** 셸이 거절한 사유. 거절 값이 글이면 그 글로, 아니면 other다 */
function failureOf(thrown: unknown): OriginFolderFailure {
  const text = thrown instanceof Error ? thrown.message : thrown;
  if (text === "bad-request" || text === "read_failed") return text;
  return "other";
}

export function createOriginFolderPicker(
  invoke: (command: string, args?: Readonly<Record<string, unknown>>) => Promise<unknown>,
): OriginFolderPicker {
  const listeners = new Set<() => void>();
  const session: {
    state: OriginFolderState;
    seq: number;
    resolve: ((path: string | undefined) => void) | null;
  } = { state: { open: false }, seq: 0, resolve: null };

  const set = (state: OriginFolderState): void => {
    session.state = state;
    for (const listener of listeners) listener();
  };

  const finish = (path: string | undefined): void => {
    const resolve = session.resolve;
    session.resolve = null;
    session.seq += 1;
    set({ open: false });
    if (resolve !== null) resolve(path);
  };

  const load = (path: string | null): void => {
    session.seq += 1;
    const seq = session.seq;
    set({ open: true, listing: { kind: "loading", path } });
    const args = path === null ? {} : { path };
    const run = async (): Promise<void> => {
      const reply = await attemptAsync(() => invoke("origin_folder_list", args));
      // 더 새로운 이동이 시작됐거나 대화 상자가 닫혔으면 늦은 답은 버린다
      if (seq !== session.seq || !session.state.open) return;
      if (!reply.ok) {
        set({
          open: true,
          listing: { kind: "failed", reason: failureOf(reply.error.cause), path },
        });
        return;
      }
      const listing = listingOf(reply.value);
      set({ open: true, listing: listing ?? { kind: "failed", reason: "other", path } });
    };
    detach(run(), rethrow);
  };

  return {
    getState: () => session.state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open() {
      if (session.resolve !== null) finish(undefined);
      return new Promise<string | undefined>((resolve) => {
        session.resolve = resolve;
        load(null);
      });
    },
    navigate(path) {
      if (!session.state.open) return;
      load(path);
    },
    choose() {
      const state = session.state;
      if (!state.open || state.listing.kind !== "ready") return;
      finish(state.listing.path);
    },
    cancel() {
      finish(undefined);
    },
    retry() {
      const state = session.state;
      if (!state.open || state.listing.kind !== "failed") return;
      load(state.listing.path);
    },
  };
}

/** 폴더 고르기 invoke를 만든다. 웹이고 폴더 고르기가 origin 방식이면 `pick_folder`가 대화 상자를 열고, 아니면 셸에 넘긴다 */
export function folderPickWith(
  invoke: (command: "pick_folder" | "pick_file") => Promise<unknown>,
  picker: OriginFolderPicker,
  originPicker: () => Promise<boolean>,
): (command: "pick_folder" | "pick_file") => Promise<unknown> {
  return async (command) => {
    if (command === "pick_folder" && (await originPicker())) {
      const chosen = await picker.open();
      return chosen ?? null;
    }
    return invoke(command);
  };
}
