// P-11 계정과 제공자(기본) + 예산과 한도(S4). 이 탭은 키 단위 저장 대신 "저장" 한 번으로 세 키를 함께 쓴다
// (l1.models.accounts, l1.models.rateLimit, ext.account-rotation.acknowledgeRisk → settings.writeFile { baseSha256 }).
import {
  EmptyState,
  Skeleton,
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  IconButton,
  NumberField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
} from "@caustic/react";
import { useState } from "react";
import { X } from "../../_shell";
import { SettingsFrame } from "../../_settings/frame";
import { initialTabParam } from "../../_settings/mount";
import { SettingRow, SettingSection } from "../../_settings/row";
import { gotoTabPage, type TabId } from "../../_settings/tabs";
import { AccountGrid, AddAccountButton, Gauge, type Account } from "./parts";

export const STATES = [
  { id: "S1", label: "S1 계정 풀" },
  { id: "S2", label: "S2 회전 위험 확인" },
  { id: "S3", label: "S3 회전 켬·초안" },
  { id: "S4", label: "S4 예산과 한도 탭" },
  { id: "S5", label: "S5 파일 충돌" },
  { id: "S6", label: "S6 계정 검사 오류" },
  { id: "S7", label: "S7 오프라인" },
  { id: "D-empty", label: "D 빈 계정 풀" },
  { id: "D-loading", label: "D 읽는 중" },
] as const;
type State = (typeof STATES)[number]["id"];

const HERE = "p11-accounts";

function accountsFor(state: State): Account[] {
  return [
    {
      id: "work",
      secret: "ant-work",
      priority: 0,
      reserve: state === "S6" ? 120 : 10,
      ...(state === "S6" ? { error: "예비율은 0에서 90 사이여야 해요." } : {}),
    },
    {
      id: "personal",
      secret: "ant-me",
      priority: 10,
      reserve: state === "S3" || state === "S5" ? 20 : 30,
      changed: state === "S3" || state === "S5",
    },
  ];
}

function UsageSection() {
  return (
    <SettingSection title="사용량 · 이 창">
      <Gauge label="anthropic 토큰" value="41k" ratio={null} limit="한도 모름" />
      <Gauge label="anthropic 비용" value="$0.82" ratio={null} limit="한도 모름" />
      <Gauge label="오늘 비용" value="$3.40" ratio={0.34} limit="$10 중" />
    </SettingSection>
  );
}

function ProvidersTab({ state }: { state: State }) {
  const off = state === "S7";
  if (state === "D-loading")
    return (
      <div className="grid gap-3 pt-1" role="status" aria-label="계정 읽는 중">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={`g${i}`} width={`${40 + i * 12}%`} height={12} />
        ))}
        <Skeleton width="20%" height={14} />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-6">
            <Skeleton width="18%" height={12} />
            <Skeleton width="22%" height={12} />
            <Skeleton width="10%" height={12} />
            <Skeleton width="10%" height={12} />
          </div>
        ))}
      </div>
    );
  const rotationOn = state === "S3" || state === "S5";
  return (
    <>
      <UsageSection />
      <SettingSection title="anthropic" end={<AddAccountButton disabled={off} />}>
        {state === "D-empty" ? (
          <EmptyState
            size="sm"
            surface="none"
            title="계정 풀이 비어 있어요"
            actions={<AddAccountButton disabled={false} />}
          />
        ) : (
          <>
            <AccountGrid provider="anthropic" accounts={accountsFor(state)} disabled={off} />
          </>
        )}
      </SettingSection>
      <SettingSection title="openai" end={<AddAccountButton disabled={off} />}>
        <p className="m-0 py-0.5 text-ui text-text-secondary">계정이 없어요.</p>
      </SettingSection>
      <SettingSection title="계정 회전">
        <SettingRow
          label="계정 회전"
          k="ext.account-rotation.enabled"
          scope="user"
          apply="boundary"
          disabled={off || state === "D-empty"}
          {...(state === "D-empty" ? { hint: "계정이 둘 이상이어야 켤 수 있어요." } : {})}
          extra={
            rotationOn ? (
              <p className="m-0 flex items-center gap-2 text-ui-sm text-text-tertiary">
                <Badge size="sm" tone="warning">
                  위험 확인함
                </Badge>
                10월 30일
              </p>
            ) : undefined
          }
        >
          <Switch size="sm" aria-label="계정 회전" defaultChecked={rotationOn} disabled={off} />
        </SettingRow>
      </SettingSection>
    </>
  );
}

function RateRow({ p, gap, on, wait }: { p: string; gap: number; on: string; wait: number }) {
  return (
    <div
      role="row"
      className="grid grid-cols-[6rem_8rem_7rem_9rem_1.75rem] items-center gap-2 py-0.5"
    >
      <span role="cell" className="font-mono text-mono text-text-primary">
        {p}
      </span>
      <span role="cell">
        <NumberField
          size="xs"
          aria-label={`${p} 최소 간격`}
          defaultValue={gap}
          unit="ms"
          step={100}
        />
      </span>
      <span role="cell">
        <Select size="xs" aria-label={`${p} 한도 도달 시`} defaultValue={on} className="w-full">
          <SelectOption value="wait">대기</SelectOption>
          <SelectOption value="switch">전환</SelectOption>
          <SelectOption value="fail">실패</SelectOption>
        </Select>
      </span>
      <span role="cell">
        <NumberField
          size="xs"
          aria-label={`${p} 최대 대기`}
          defaultValue={wait}
          unit="ms"
          step={1000}
        />
      </span>
      <IconButton size="xs" variant="ghost" label={`${p} 정책 지우기`}>
        <X />
      </IconButton>
    </div>
  );
}

function BudgetsTab() {
  return (
    <>
      <UsageSection />
      <SettingSection title="예산">
        <SettingRow label="하루 비용 한도" k="l1.models.budget.dailyUsd" scope="user" apply="now">
          <NumberField
            appearance="stepper"
            containerClassName="w-36"
            size="sm"
            aria-label="하루 비용 한도(달러)"
            defaultValue={10}
          />
        </SettingRow>
        <SettingRow
          label="한도 도달 시"
          k="l1.models.budget.onExceed"
          scope="user"
          apply="nextTurn"
        >
          <RadioGroup
            aria-label="한도 도달 시"
            orientation="horizontal"
            defaultValue="ask"
            className="min-h-7 gap-5"
          >
            <RadioGroupItem value="ask">묻기</RadioGroupItem>
            <RadioGroupItem value="stop">멈추기</RadioGroupItem>
            <RadioGroupItem value="warn">알리기만</RadioGroupItem>
          </RadioGroup>
        </SettingRow>
      </SettingSection>
      <SettingSection
        title="레이트 리밋"
        end={
          <Button size="xs" variant="ghost">
            정책 추가
          </Button>
        }
      >
        <div
          role="table"
          aria-label="provider별 레이트 리밋"
          className="grid overflow-x-auto py-0.5"
        >
          <div
            role="row"
            className="grid grid-cols-[6rem_8rem_7rem_9rem_1.75rem] gap-2 pb-1 text-ui-sm text-text-tertiary"
          >
            <span role="columnheader">provider</span>
            <span role="columnheader">최소 간격</span>
            <span role="columnheader">한도 도달 시</span>
            <span role="columnheader">최대 대기</span>
            <span role="columnheader">
              <span className="sr-only">동작</span>
            </span>
          </div>
          <RateRow p="anthropic" gap={500} on="switch" wait={30000} />
          <RateRow p="openai" gap={0} on="wait" wait={60000} />
        </div>
      </SettingSection>
    </>
  );
}

export function App({ state }: { state: State }) {
  const [tab, setTab] = useState<TabId>(() =>
    state === "S4" || initialTabParam() === "budgets" ? "budgets" : "providers",
  );
  const [riskOpen, setRiskOpen] = useState(state === "S2");
  const onTabSelect = (id: TabId) => {
    if (id === "budgets" || id === "providers") setTab(id);
    else gotoTabPage(id, HERE);
  };
  const draftCount = state === "S3" || state === "S5" ? 2 : state === "S6" ? 1 : 0;
  return (
    <>
      <SettingsFrame
        tab={tab}
        onTabSelect={onTabSelect}
        offline={state === "S7"}
        modalOpen={riskOpen}
        draft={draftCount > 0 ? { count: draftCount } : undefined}
        banner={
          state === "S5" ? (
            <Alert
              tone="warning"
              layout="inline"
              action={
                <Button size="xs" variant="outline">
                  다시 읽기
                </Button>
              }
            >
              파일이 다른 곳에서 바뀌었어요. 다시 읽은 뒤 고친 2곳을 다시 넣어 주세요.
            </Alert>
          ) : undefined
        }
      >
        {tab === "budgets" ? <BudgetsTab /> : <ProvidersTab state={state} />}
      </SettingsFrame>
      <Dialog
        kind="alert"
        size="sm"
        tone="warning"
        open={riskOpen}
        onOpenChange={setRiskOpen}
        title="구독 계정 회전은 약관 위험이 있어요"
        description="여러 구독 계정을 번갈아 쓰면 provider 약관에 어긋날 수 있어요. 계정이 정지되면 Fresnel이 되돌릴 수 없어요."
        footer={
          <>
            <DialogClose asChild>
              <Button size="sm" variant="outline" autoFocus>
                취소
              </Button>
            </DialogClose>
            <Button size="sm" variant="solid" onClick={() => setRiskOpen(false)}>
              위험을 알고 켜기
            </Button>
          </>
        }
      />
    </>
  );
}
