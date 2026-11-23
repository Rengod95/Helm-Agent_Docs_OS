import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useCallback, useSyncExternalStore } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands, type Commands } from "../commands.ts";

// 플레이그라운드 탭·목록·상세가 같이 읽는 `ext.list` 행. 머리 줄 탭은 모든 화면 머리(숨긴 탭 화면의 머리도)에 그려지므로
// 부품마다 따로 읽지 않고 명령 개체 하나에 저장소 하나를 둔다. 구독자가 있는 동안 확장 목록 알림마다 다시 읽는다.

interface Listing {
  entries: readonly ExtListEntry[] | undefined;
  readonly listeners: Set<() => void>;
  stop: (() => void) | undefined;
  /** 늦게 온 응답이 새 응답을 덮지 않게 읽기마다 올린다 */
  seq: number;
}

const listings = new WeakMap<Commands, Listing>();

function listingOf(commands: Commands): Listing {
  const known = listings.get(commands);
  if (known !== undefined) return known;
  const made: Listing = { entries: undefined, listeners: new Set(), stop: undefined, seq: 0 };
  listings.set(commands, made);
  return made;
}

function load(commands: Commands, listing: Listing): void {
  listing.seq += 1;
  const mine = listing.seq;
  detach(
    commands.workbench.list().then((result) => {
      if (mine !== listing.seq || !result.ok) return undefined;
      listing.entries = result.value;
      for (const listener of listing.listeners) listener();
      return undefined;
    }),
    rethrow,
  );
}

/** 첫 구독자가 오면 읽고 알림을 듣는다. 마지막 구독자가 가면 듣기를 멈춘다(값은 남는다) */
function subscribeListing(commands: Commands, listener: () => void): () => void {
  const listing = listingOf(commands);
  listing.listeners.add(listener);
  if (listing.stop === undefined) {
    load(commands, listing);
    listing.stop = commands.workbench.onChanged(() => {
      load(commands, listing);
    });
  }
  return () => {
    listing.listeners.delete(listener);
    if (listing.listeners.size === 0 && listing.stop !== undefined) {
      listing.stop();
      listing.stop = undefined;
    }
  };
}

/** `ext.list` 행. 아직 못 읽었거나 연결이 없으면 undefined */
export function useExtListing(): readonly ExtListEntry[] | undefined {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  // 연결이 끊기면 모든 구독이 풀리고, 다시 붙으면 첫 구독자가 새 연결로 다시 읽는다
  const subscribe = useCallback(
    (listener: () => void) => (live ? subscribeListing(commands, listener) : () => {}),
    [commands, live],
  );
  const snapshot = useCallback(() => listingOf(commands).entries, [commands]);
  const entries = useSyncExternalStore(subscribe, snapshot, snapshot);
  return live ? entries : undefined;
}
