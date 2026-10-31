// 설정 화면 공용 틀(P-09~P-13). 공용 셸(../_shell) 가운데에 탭 열(키 찾기 + 탭 13개)과 폼 열(머리 + 띠 + 내용 + 초안 바닥)을 꽂는다.
// 가운데는 투명하다(DP-01): 탭 열과 폼 열은 표면 없이 간격으로만 나뉜다. 좁은 폭(compact)에서는 탭 열을 접고 폼 머리의 Select가 탭을 맡는다.
// 오른쪽 well은 설정 화면에서 처음에 닫힌다(폼 폭이 먼저). 페이지가 extraTabs로 well 탭(예: 파일)을 더할 수 있다.
import {
  Alert,
  Button,
  FormLayoutFooter,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  ScrollArea,
  Select,
  SelectOption,
} from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  defaultStatusCells,
  PanelLeft,
  Search,
  Shell,
  standardRightTabs,
  useShell,
  type RightTab,
  type StatusCell,
} from "../_shell";
import { TABS, tabLabel, type TabId } from "./tabs";

export interface SettingsFrameProps {
  tab: TabId;
  onTabSelect: (id: TabId) => void;
  /** 폼 머리 제목. 기본은 탭 이름. */
  title?: ReactNode | undefined;
  /** 제목 옆 연한 글(개수, 상태). */
  meta?: ReactNode | undefined;
  /** 머리 끝 동작. */
  actions?: ReactNode | undefined;
  /** 머리 아래 띠(재시작 필요, 충돌 등). 오프라인 띠는 offline이 맡는다. */
  banner?: ReactNode | undefined;
  /** 저장 버튼이 있는 편집(목록, 표, 전용 편집기, 파일)을 바꾼 동안의 바닥. */
  draft?: { count: number; saving?: boolean } | undefined;
  /** 키 찾기 칸 값. 값이 있으면 탭 열은 찾은 개수를 보인다. */
  query?: string | undefined;
  tabCounts?: Partial<Record<TabId, number>> | undefined;
  /** 엔진에 연결되지 않음: 띠와 상태 표시줄 연결 칸. 편집 잠금은 페이지가 한다. */
  offline?: boolean | undefined;
  /** 오른쪽 well에 더할 탭(맨 앞). */
  extraTabs?: RightTab[] | undefined;
  /** 처음에 열 well 탭. 없으면 well은 닫힌 채로 시작한다. */
  initialEnd?: string | undefined;
  modalOpen?: boolean | undefined;
  /** 폼 열 최대 폭. 기본 44rem. */
  wide?: boolean | undefined;
  children: ReactNode;
}

const offlineLink: StatusCell = {
  id: "link",
  text: "끊김",
  dot: "danger",
  title: "연결 끊김",
  description: "엔진에 연결되지 않았어요. 읽은 값만 보여요.",
  action: { label: "다시 연결", onSelect: () => {} },
};

function TabColumn({
  tab,
  onTabSelect,
  query,
  tabCounts,
}: Pick<SettingsFrameProps, "tab" | "onTabSelect" | "query" | "tabCounts">) {
  const m = useShell();
  const searching = query !== undefined && query !== "";
  return (
    <div className="flex w-44 flex-none flex-col">
      {/* 폼 머리(h-10)와 같은 줄에 키 찾기. 사이드바가 닫혔으면 그 앞에 여는 버튼. */}
      <div className="flex h-10 flex-none items-center gap-1">
        {!m.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => m.setStartOpen(true)}
          >
            <PanelLeft />
          </IconButton>
        )}
        <Input
          size="xs"
          variant="soft"
          prefix={<Search />}
          placeholder="키 찾기"
          aria-label="설정 키 찾기"
          defaultValue={query}
          containerClassName="min-w-0 flex-1"
        />
      </div>
      <ScrollArea label="설정 탭" className="min-h-0 flex-1">
        <ListNavigation aria-label="설정 탭" kind="pages" size="sm" className="pb-2">
          <ListNavigationGroup>
            {TABS.map((t) => {
              const n = tabCounts?.[t.id];
              // 찾는 중에는 찾은 항목이 없는 탭을 연하게 둔다(목록 길이와 위치는 그대로).
              const dim = searching && n === undefined;
              return (
                <ListNavigationItem
                  key={t.id}
                  current={!searching && t.id === tab}
                  count={searching ? n : undefined}
                  aria-label={searching ? `${t.label}, 찾은 항목 ${n ?? 0}개` : undefined}
                  className={
                    dim ? "[&_[data-slot=list-navigation-label]]:text-text-tertiary" : undefined
                  }
                  onSelect={() => onTabSelect(t.id)}
                >
                  {t.label}
                </ListNavigationItem>
              );
            })}
          </ListNavigationGroup>
        </ListNavigation>
      </ScrollArea>
    </div>
  );
}

export function SettingsFrame({
  tab,
  onTabSelect,
  title,
  meta,
  actions,
  banner,
  draft,
  query,
  tabCounts,
  offline = false,
  extraTabs = [],
  initialEnd,
  modalOpen = false,
  wide = false,
  children,
}: SettingsFrameProps) {
  const m = useShell();
  const compact = m.layout === "compact";
  // 설정 화면은 well을 닫고 시작한다(넓은 폭 기본값은 열림). 페이지가 initialEnd를 주면 그 탭을 연다.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    if (initialEnd !== undefined) m.openEnd(initialEnd);
    else m.setEndOpen(false);
  }, [m, initialEnd]);

  return (
    <Shell
      activeNav="settings"
      stageLabel="설정"
      modalOpen={modalOpen}
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={[...extraTabs, ...standardRightTabs({ inboxBadge: 5 })]}
      status={defaultStatusCells({
        layout: m.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: m.openEnd,
        link: offline ? offlineLink : undefined,
      })}
    >
      <div className="flex min-h-0 flex-1 gap-6">
        {!compact && (
          <TabColumn tab={tab} onTabSelect={onTabSelect} query={query} tabCounts={tabCounts} />
        )}
        <div className="flex min-w-0 flex-1 flex-col @container">
          <header className="flex h-10 flex-none items-center gap-2">
            {compact && (
              <>
                {!m.startOpen && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label="사이드바 열기"
                    aria-expanded={false}
                    onClick={() => m.setStartOpen(true)}
                    className="-ms-1.5"
                  >
                    <PanelLeft />
                  </IconButton>
                )}
                <Select
                  size="xs"
                  variant="ghost"
                  aria-label="설정 탭"
                  value={tab}
                  onValueChange={(v) => onTabSelect(v as TabId)}
                  className="w-auto"
                >
                  {TABS.map((t) => (
                    <SelectOption key={t.id} value={t.id}>
                      {t.label}
                    </SelectOption>
                  ))}
                </Select>
              </>
            )}
            <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
              <h1
                className={`m-0 truncate font-ui text-ui-strong text-text-primary ${compact && title === undefined ? "sr-only" : ""}`}
              >
                {title ?? tabLabel(tab)}
              </h1>
              {meta !== undefined && (
                <span className="truncate text-ui-sm text-text-tertiary">{meta}</span>
              )}
            </div>
            {actions !== undefined && (
              <div className="flex flex-none items-center gap-1">{actions}</div>
            )}
          </header>
          <ScrollArea label={`${tabLabel(tab)} 설정`} className="min-h-0 flex-1">
            <div className={`${wide ? "max-w-[56rem]" : "max-w-[44rem]"} pe-1 pb-4`}>
              {(offline || banner !== undefined) && (
                <div className="grid gap-2 pb-3">
                  {offline && (
                    <Alert tone="warning" layout="inline">
                      엔진에 연결되면 바꿀 수 있어요. 지금은 읽은 값만 보여요.
                    </Alert>
                  )}
                  {banner}
                </div>
              )}
              {children}
              {draft !== undefined && draft.count > 0 && (
                // 저장 버튼이 있는 편집의 초안 바닥. 스크롤해도 폼 아래에 붙어 있다.
                <FormLayoutFooter className="sticky bottom-0 z-10 mt-3 items-center bg-bg-app py-2">
                  <span role="status" className="me-auto text-ui-sm text-text-secondary">
                    저장하지 않은 변경 {draft.count}개
                  </span>
                  <Button size="sm" tone="neutral" variant="ghost">
                    되돌리기
                  </Button>
                  <Button size="sm" tone="neutral" variant="solid" disabled={draft.saving}>
                    {draft.saving === true ? "저장 중" : "저장"}
                  </Button>
                </FormLayoutFooter>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </Shell>
  );
}
