import { detach, rethrow } from "@fresnel/contracts";
import type { CommonSet, Profile } from "@fresnel/contracts/wire";
import { useCallback, useSyncExternalStore } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands, type Commands } from "../commands.ts";

// 대화 화면의 프로필 칩과 변화 표지가 같이 읽는 `profile.list`. 부품마다 따로 읽지 않고 명령 개체 하나에 저장소 하나를 둔다
// (ext-listing.ts와 같은 모양). 구독자가 있는 동안 확장 목록 알림과 프로필 변경 알림마다 다시 읽고, 칩 메뉴를 열 때도 다시 읽는다.

/** 읽기 상태. 연결이 없으면 `offline`이다 */
export type ProfilesRead =
  | { readonly kind: "offline" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  /** `common`은 전역 공통 묶음이다. 프로필 목록과 따로 읽히며, 켜짐 판정(제안 플러그인이 어디에든 있는가)이 함께 본다 */
  | { readonly kind: "ready"; readonly profiles: readonly Profile[]; readonly common: CommonSet };

interface Listing {
  read: ProfilesRead;
  readonly listeners: Set<() => void>;
  stop: (() => void) | undefined;
  /** 늦게 온 응답이 새 응답을 덮지 않게 읽기마다 올린다 */
  seq: number;
}

const LOADING: ProfilesRead = { kind: "loading" };
const OFFLINE: ProfilesRead = { kind: "offline" };
const listings = new WeakMap<Commands, Listing>();

function listingOf(commands: Commands): Listing {
  const known = listings.get(commands);
  if (known !== undefined) return known;
  const made: Listing = { read: LOADING, listeners: new Set(), stop: undefined, seq: 0 };
  listings.set(commands, made);
  return made;
}

function load(commands: Commands, listing: Listing): void {
  listing.seq += 1;
  const mine = listing.seq;
  detach(
    commands.workbench.profileList().then((result) => {
      if (mine !== listing.seq) return undefined;
      // 다시 읽다 실패해도 읽어 둔 목록은 그대로 둔다(칩이 깜빡이지 않는다). 처음 읽기만 실패로 보인다
      if (result.ok)
        listing.read = {
          kind: "ready",
          profiles: result.value.profiles,
          common: result.value.common,
        };
      else if (listing.read.kind !== "ready") listing.read = { kind: "failed" };
      for (const listener of listing.listeners) listener();
      return undefined;
    }),
    rethrow,
  );
}

function subscribeListing(commands: Commands, listener: () => void): () => void {
  const listing = listingOf(commands);
  listing.listeners.add(listener);
  if (listing.stop === undefined) {
    load(commands, listing);
    const offChanged = commands.workbench.onChanged(() => {
      load(commands, listing);
    });
    const offProfiles = commands.workbench.onProfilesChanged(() => {
      load(commands, listing);
    });
    listing.stop = () => {
      offChanged();
      offProfiles();
    };
  }
  return () => {
    listing.listeners.delete(listener);
    if (listing.listeners.size === 0 && listing.stop !== undefined) {
      listing.stop();
      listing.stop = undefined;
    }
  };
}

/** 지금 다시 읽는다(메뉴를 열 때, 다시 읽기) */
export function reloadProfiles(commands: Commands): void {
  load(commands, listingOf(commands));
}

/** 프로필 목록 읽기 상태 */
export function useProfiles(): ProfilesRead {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const subscribe = useCallback(
    (listener: () => void) => (live ? subscribeListing(commands, listener) : () => {}),
    [commands, live],
  );
  const snapshot = useCallback(() => listingOf(commands).read, [commands]);
  const read = useSyncExternalStore(subscribe, snapshot, snapshot);
  return live ? read : OFFLINE;
}

/** 프로필 id → 제목. 목록을 못 읽었거나 없는 id면 id 그대로다 */
export function profileTitleOf(read: ProfilesRead, id: string): string {
  if (read.kind !== "ready") return id;
  return read.profiles.find((profile) => profile.id === id)?.title ?? id;
}
