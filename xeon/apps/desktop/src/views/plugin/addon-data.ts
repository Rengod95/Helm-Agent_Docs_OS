import { activeLocale } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtHookInfo } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands, type Commands } from "../commands.ts";
import { isHidden } from "../../plugin-ui/placements.ts";
import { addonMetaOf, type AddonMetaMap, type AddonSource } from "./addon-model.ts";
import { useExtListing } from "./ext-listing.ts";
import { usePluginUiState } from "./plugin-context.tsx";

// 플레이그라운드의 탭·목록·상세가 같이 쓰는 입력: 화면 런타임 상태(`ext.ui.list`), `ext.list` 행, (상세·목록만) `ext.get`의
// 매니페스트와 훅. `ext.get`은 이름과 판(버전)마다 한 번 읽고 명령 개체 하나에 모아 둔다(판이 바뀌면 다시 읽는다).

interface Got {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly hooks: readonly ExtHookInfo[];
}

interface GetCache {
  /** `<이름>@<판>` → 읽은 값 */
  readonly got: Map<string, Got>;
  readonly asked: Set<string>;
  readonly listeners: Set<() => void>;
  /** 바뀔 때마다 새 개체(스냅숏) */
  snapshot: ReadonlyMap<string, Got>;
}

const caches = new WeakMap<Commands, GetCache>();

function cacheOf(commands: Commands): GetCache {
  const known = caches.get(commands);
  if (known !== undefined) return known;
  const made: GetCache = {
    got: new Map(),
    asked: new Set(),
    listeners: new Set(),
    snapshot: new Map(),
  };
  caches.set(commands, made);
  return made;
}

function ask(commands: Commands, cache: GetCache, name: string, version: string): void {
  const id = `${name}@${version}`;
  if (cache.asked.has(id)) return;
  cache.asked.add(id);
  detach(
    commands.workbench.get(name).then((result) => {
      if (!result.ok) {
        // 다음 화면 열기에서 다시 묻는다
        cache.asked.delete(id);
        return undefined;
      }
      cache.got.set(id, { manifest: result.value.manifest, hooks: result.value.hooks });
      cache.snapshot = new Map(cache.got);
      for (const listener of cache.listeners) listener();
      return undefined;
    }),
    rethrow,
  );
}

export interface AddonData {
  readonly source: AddonSource;
  readonly meta: AddonMetaMap;
  readonly locale: string;
  readonly phase: "loading" | "ready" | "offline";
  /** `ext.list`에 행이 있는 이름 */
  readonly listed: ReadonlySet<string>;
}

/**
 * 플레이그라운드 입력을 모은다. `manifests`가 참이면 이름마다 `ext.get`도 읽는다(설명, 만든 이, 링크, 훅, 메서드).
 * 탭 줄은 `ext.list`만으로 충분해 거짓이다. 사용자가 숨긴 항목(`x.ui.hidden`)은 빠진다(플레이그라운드 목록, 머리 줄 탭, 탭 화면).
 * `keepHidden`이 참이면 숨긴 항목도 둔다: 크래프트 "화면과 설정" 탭이 숨긴 항목에도 스위치를 그린다(AGE-73)
 */
export function useAddonData(manifests: boolean, keepHidden = false): AddonData {
  const state = usePluginUiState();
  const listing = useExtListing();
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const cache = cacheOf(commands);
  const subscribe = useCallback(
    (listener: () => void) => {
      cache.listeners.add(listener);
      return () => {
        cache.listeners.delete(listener);
      };
    },
    [cache],
  );
  const snapshot = useCallback(() => cache.snapshot, [cache]);
  const got = useSyncExternalStore(subscribe, snapshot, snapshot);
  const wanted = useMemo(() => {
    const versions = new Map<string, string>();
    for (const entry of listing ?? []) versions.set(entry.name, entry.version);
    for (const entry of state.entries) {
      if (!versions.has(entry.extension)) versions.set(entry.extension, entry.version);
    }
    return versions;
  }, [listing, state.entries]);
  useEffect(() => {
    if (!manifests || !live) return;
    for (const [name, ver] of wanted) ask(commands, cache, name, ver);
  }, [manifests, live, wanted, commands, cache]);
  const meta = useMemo(() => {
    const map = new Map<string, ReturnType<typeof addonMetaOf>>();
    for (const [name, ver] of wanted) {
      const read = manifests ? got.get(`${name}@${ver}`) : undefined;
      map.set(
        name,
        addonMetaOf(
          listing?.find((entry) => entry.name === name),
          read?.manifest,
          read?.hooks,
        ),
      );
    }
    return map;
  }, [wanted, listing, manifests, got]);
  const source = useMemo(
    () => ({
      entries: keepHidden
        ? state.entries
        : state.entries.filter((entry) => !isHidden(state.layout, entry)),
      inactive: state.inactive,
      settings: state.settings,
    }),
    [keepHidden, state.entries, state.layout, state.inactive, state.settings],
  );
  const listed = useMemo(() => new Set((listing ?? []).map((entry) => entry.name)), [listing]);
  return { source, meta, locale: activeLocale(), phase: state.phase, listed };
}
