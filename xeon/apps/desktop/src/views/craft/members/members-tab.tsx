// 플러그인 상세(`ext-detail.tsx`)의 "구성원" 탭 입구(m6Mb). 구성원이 있는 플러그인에서만 탭이 생긴다(`hasMembers`).
// 배포 빌드는 줄 목록(`list`)으로 실제 엔진을 그린다. 개발 빌드는 배치 고르개와 표본 장면(`members-dev.tsx`)을 얹는다.
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../../app/build.ts";
import { blockTitlesOf } from "./members-model.ts";
import { useMembersSource } from "./members-source.ts";
import { useSplitActions } from "./split-source.ts";
import { MembersView } from "./members-view.tsx";

const MembersDev = BUILD_CHECKS
  ? lazy(() => import("./members-dev.tsx").then((m) => ({ default: m.MembersDev })))
  : null;

export function MembersTab(props: {
  readonly entry: ExtListEntry;
  /** 설치본 매니페스트(`ext.get`). 아직 못 읽었거나 실패했으면 null */
  readonly manifest: Readonly<Record<string, unknown>> | null;
}): ReactNode {
  const titles = useMemo(
    () => (props.manifest === null ? new Map<string, string>() : blockTitlesOf(props.manifest)),
    [props.manifest],
  );
  const live = useMembersSource(props.entry, props.manifest, titles);
  const split = useSplitActions();
  if (MembersDev === null) return <MembersView data={live} layout="list" split={split} />;
  return (
    <Suspense fallback={null}>
      <MembersDev live={live} split={split} />
    </Suspense>
  );
}
