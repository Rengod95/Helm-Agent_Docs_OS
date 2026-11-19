// 실제 프로필을 읽는 얇은 연결(`profile.list`, m4/lcAlts `alts/profiles.ts`와 같은 길). 읽기만 하고 고치지 않는다.
// 플러그인의 붙는 방식은 이 연결이 모른다: 표본에 같은 이름이 있으면 그 정의를 쓰고, 없으면 "자리 모름"으로 그린다.
import { detach, rethrow } from "@fresnel/contracts";
import type { Profile } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useLinkPhase } from "../../../../state/engine/index.ts";
import { useCommands } from "../../../../views/commands.ts";
import type { Defs, PluginDef, ProfileModel } from "./model.ts";

export function useRealProfiles(): readonly Profile[] {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [value, setValue] = useState<readonly Profile[]>([]);
  useEffect(() => {
    if (!live) return undefined;
    const run = { stale: false };
    detach(
      (async () => {
        const got = await commands.workbench.profiles();
        if (!run.stale && got.ok) setValue(got.value);
      })(),
      rethrow,
    );
    return () => {
      run.stale = true;
    };
  }, [commands, live]);
  return value;
}

export function modelOfReal(profile: Profile): ProfileModel {
  return {
    id: profile.id,
    title: profile.title,
    sample: false,
    entries: profile.plugins.map((p) => ({ id: p.name, base: false })),
    startDrive: profile.startDrive,
    groups: [],
  };
}

/** 표본 정의에 실제 프로필의 모르는 이름을 더한다. 스타트 Drive는 Drive로, 나머지는 자리 모름(고리 안 점선)이다 */
export function defsWithReal(base: Defs, profile: ProfileModel): Defs {
  const extra: Record<string, PluginDef> = {};
  for (const e of profile.entries) {
    if (base[e.id] !== undefined) continue;
    extra[e.id] =
      profile.startDrive === e.id
        ? { id: e.id, kind: "drive", stages: [], parts: [] }
        : { id: e.id, kind: "inject", unread: true, parts: [] };
  }
  return { ...base, ...extra };
}
