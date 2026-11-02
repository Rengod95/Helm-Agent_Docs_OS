// P-09 설정: 13탭 일반 폼. 모델 탭(기본), 개요, 고급(파일 전용), 그 밖의 일반 탭. 전용 탭(시크릿, 계정, 도구, 플러그인)은 옆 시안으로 옮긴다.
import { Alert, Button, Skeleton } from "@caustic/react";
import { useState } from "react";
import { FileText, RotateCcw } from "../_shell";
import { SettingsFrame } from "../_settings/frame";
import { initialTabParam } from "../_settings/mount";
import { gotoTabPage, TABS, type TabId } from "../_settings/tabs";
import { FileTab } from "./file-tab";
import { GenericTab } from "./generic-tabs";
import { ModelsTab } from "./models-tab";
import { OverviewTab } from "./overview-tab";
import { SearchResults, SEARCH_COUNTS } from "./search";

export const STATES = [
  { id: "S1", label: "S1 모델 탭" },
  { id: "S2", label: "S2 초안·외부 변경" },
  { id: "S3", label: "S3 저장 오류" },
  { id: "S4", label: "S4 읽는 중" },
  { id: "S5", label: "S5 오프라인" },
  { id: "S6", label: "S6 키 찾기" },
  { id: "S7", label: "S7 개요 탭" },
  { id: "S8", label: "S8 파일로 보기·충돌" },
  { id: "S9", label: "S9 빈 탭(파일 전용)" },
] as const;
export type State = (typeof STATES)[number]["id"];

const HERE = "p09-settings";

function startTab(state: State): TabId {
  if (state === "S7") return "overview";
  if (state === "S9") return "advanced";
  const p = initialTabParam();
  return TABS.some((t) => t.id === p) ? (p as TabId) : "models";
}

function FormSkeleton() {
  return (
    <div aria-busy="true" aria-label="설정을 읽는 중" className="grid gap-5 pt-1">
      {[60, 40, 52, 36, 48].map((w, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton height={12} width={`${w}%`} />
          <Skeleton height={28} width="18rem" radius="lg" />
        </div>
      ))}
    </div>
  );
}

export function App({ state }: { state: State }) {
  const [tab, setTab] = useState<TabId>(() => startTab(state));
  const onTabSelect = (id: TabId) => {
    if (!gotoTabPage(id, HERE)) setTab(id);
  };
  const offline = state === "S5";
  const searching = state === "S6";

  const fileAction = (
    <Button size="xs" tone="neutral" variant="ghost" iconStart={<FileText />}>
      파일로 보기
    </Button>
  );
  const restartBanner =
    tab === "models" && state !== "S4" ? (
      <Alert
        tone="warning"
        layout="inline"
        action={
          <Button
            size="xs"
            tone="neutral"
            variant="outline"
            iconStart={<RotateCcw />}
            disabled={offline}
          >
            엔진 재시작
          </Button>
        }
      >
        재시작해야 적용되는 변경이 1개 있어요.
      </Alert>
    ) : undefined;

  if (searching)
    return (
      <SettingsFrame
        tab={tab}
        onTabSelect={onTabSelect}
        query="timeout"
        tabCounts={SEARCH_COUNTS}
        title="‘timeout’ 찾은 항목"
        meta="4개 탭에서 5개"
      >
        <SearchResults />
      </SettingsFrame>
    );

  return (
    <SettingsFrame
      tab={tab}
      onTabSelect={onTabSelect}
      actions={tab === "overview" ? undefined : fileAction}
      banner={restartBanner}
      offline={offline}
      draft={state === "S2" ? { count: 1 } : undefined}
      extraTabs={
        state === "S8"
          ? [{ id: "file", label: "사용자 설정 파일", icon: <FileText />, content: <FileTab /> }]
          : []
      }
      initialEnd={state === "S8" ? "file" : undefined}
    >
      {state === "S4" ? (
        <FormSkeleton />
      ) : tab === "models" ? (
        <ModelsTab state={state} />
      ) : tab === "overview" ? (
        <OverviewTab />
      ) : (
        <GenericTab tab={tab} disabled={offline} />
      )}
    </SettingsFrame>
  );
}
