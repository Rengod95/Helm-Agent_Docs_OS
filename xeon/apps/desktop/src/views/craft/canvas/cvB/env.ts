// cvB가 바깥에서 읽는 것: 테마(셰이더 밝기), 움직임 줄이기, 실제 프로필(얇은 연결).
// 실제 프로필은 `profile.list`로 읽고, 표본 카탈로그에 있는 이름만 캔버스에 올린다(나머지는 수만 알린다).
import { detach, rethrow } from "@fresnel/contracts";
import type { Profile } from "@fresnel/contracts/wire";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLinkPhase } from "../../../../state/engine/index.ts";
import { useCommands } from "../../../../views/commands.ts";
import type { Catalog, ProfileState } from "./model.ts";

const DARK = "(prefers-color-scheme: dark)";
const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-motion"],
  });
  const dark = window.matchMedia(DARK);
  const reduce = window.matchMedia(REDUCE);
  dark.addEventListener("change", onChange);
  reduce.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    dark.removeEventListener("change", onChange);
    reduce.removeEventListener("change", onChange);
  };
}

function darkNow(): boolean {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light") return false;
  if (explicit === "dark") return true;
  return window.matchMedia(DARK).matches;
}

function reducedNow(): boolean {
  return (
    document.documentElement.getAttribute("data-motion") === "reduce" ||
    window.matchMedia(REDUCE).matches
  );
}

export function useDark(): boolean {
  return useSyncExternalStore(subscribe, darkNow, () => true);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedNow, () => false);
}

export interface RealProfiles {
  readonly ready: boolean;
  readonly value: readonly Profile[];
}

/** `profile.list`. 엔진에 닿지 않으면 빈 목록이다(표본만 보인다) */
export function useRealProfiles(): RealProfiles {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [load, setLoad] = useState<RealProfiles>({ ready: false, value: [] });
  useEffect(() => {
    if (!live) return undefined;
    const run = { stale: false };
    detach(
      (async () => {
        const got = await commands.workbench.profiles();
        if (!run.stale)
          setLoad({ ready: true, value: got.ok ? got.value.filter((p) => p.hidden !== true) : [] });
      })(),
      rethrow,
    );
    return () => {
      run.stale = true;
    };
  }, [commands, live]);
  return load;
}

/** 실제 프로필 → 캔버스 상태. 표본 카탈로그에 없는 플러그인은 빼고 그 수를 돌려준다 */
export function fromReal(
  profile: Profile,
  catalog: Catalog,
): { readonly state: ProfileState; readonly unknown: number } {
  const known = profile.plugins.filter((p) => catalog.has(p.name));
  return {
    state: {
      id: `real:${profile.id}`,
      title: { text: profile.title },
      entries: known.map((p) => ({ plugin: p.name, base: false })),
      startDrive:
        profile.startDrive !== null && catalog.has(profile.startDrive) ? profile.startDrive : null,
      groups: [],
    },
    unknown: profile.plugins.length - known.length,
  };
}
