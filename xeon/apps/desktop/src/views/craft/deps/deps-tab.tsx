// 플러그인 상세(`ext-detail.tsx`)의 "의존" 탭 입구(m6Mb, AGE-33). 모든 플러그인에 탭이 있다(기대는 것이 없어도 없다고 말한다).
import type { ExtListEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { useInstalledEntries } from "../installed-entries.ts";
import { useDepsSource } from "./deps-source.ts";
import { DepsView } from "./deps-view.tsx";

export function DepsTab(props: { readonly entry: ExtListEntry }): ReactNode {
  const entries = useInstalledEntries();
  const data = useDepsSource(props.entry, entries);
  return <DepsView data={data} />;
}
