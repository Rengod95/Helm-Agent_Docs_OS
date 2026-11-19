// cvC의 실제 프로필 읽기(얇은 연결). `profile.list`(commands.workbench.profiles)로 프로필을 읽어 표본과 같은 모양으로 옮긴다.
// 플러그인 종류와 자리는 표본 목록에서만 안다: 표본에 없는 이름은 그림에 오르지 않는다. 드래프트·묶음은 아직 읽지 않는다(빈 값).
import { detach, rethrow } from "@fresnel/contracts";
import type { Profile } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useLinkPhase } from "../../../../state/engine/index.ts";
import { useCommands } from "../../../../views/commands.ts";
import type { SampleProfile } from "./sample.ts";

/** 실제 프로필 하나를 표본 모양으로. id는 표본과 겹치지 않게 앞에 `real:`을 붙인다 */
function sampleOfProfile(p: Profile): SampleProfile {
  return {
    id: `real:${p.id}`,
    title: p.title,
    plugins: p.plugins.map((r) => r.name),
    startDrive: p.startDrive,
    drafts: [],
    groups: [],
  };
}

const NONE: readonly SampleProfile[] = [];

export function useRealProfiles(): readonly SampleProfile[] {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [value, setValue] = useState<readonly SampleProfile[]>(NONE);
  useEffect(() => {
    if (!live) return undefined;
    const run = { stale: false };
    detach(
      (async () => {
        const got = await commands.workbench.profiles();
        if (!run.stale && got.ok)
          setValue(got.value.filter((p) => p.hidden !== true).map(sampleOfProfile));
      })(),
      rethrow,
    );
    return () => {
      run.stale = true;
    };
  }, [commands, live]);
  return value;
}
