// 실제 프로필을 읽는 얇은 연결(`profile.list`). 시안은 표본으로 그리고, 저장된 프로필이 있으면 고르기 목록에 더한다.
// 실제 프로필의 플러그인은 표본이 아는 이름만 놓는다(종류와 자리를 표본에서 빌린다. 실제 종류 읽기는 `plugin.list`의 일이다).
import { useCallback, useMemo } from "react";
import { useLinkPhase } from "../../../../state/engine/index.ts";
import { useCommands } from "../../../../views/commands.ts";
import { tabLinkOf, useTabRead } from "../../../workbench/tab-read.ts";
import type { CanvasProfile } from "./model.ts";
import { pluginById, SAMPLE_BASE } from "./sample.ts";

export interface RealProfile {
  readonly id: string;
  readonly title: string;
  readonly profile: CanvasProfile;
}

export function useRealProfiles(): readonly RealProfile[] {
  const commands = useCommands();
  const link = tabLinkOf(useLinkPhase());
  const load = useCallback(() => commands.workbench.profiles(), [commands]);
  const read = useTabRead("cvD-profiles", link, load);
  return useMemo(() => {
    if (read.kind !== "ready") return [];
    return read.value.map((p) => {
      const id = `real:${p.id}`;
      const own = p.plugins
        .map((ref) => ref.name)
        .filter((name) => pluginById(name) !== undefined && !SAMPLE_BASE.includes(name));
      return {
        id,
        title: p.title,
        profile: {
          id,
          startDrive: p.startDrive !== null && own.includes(p.startDrive) ? p.startDrive : null,
          entries: [
            ...SAMPLE_BASE.map((plugin) => ({ plugin, origin: "base" as const })),
            ...own.map((plugin) => ({ plugin, origin: "profile" as const })),
          ],
          groups: [],
        },
      };
    });
  }, [read]);
}
