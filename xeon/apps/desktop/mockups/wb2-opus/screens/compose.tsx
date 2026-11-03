// W8 구성(P-21): 탭 둘(프로필, 그룹 구성). 탭은 화면 머리 줄에(DP-37).
// 프로필: 왼쪽 목록 + 오른쪽 편집(확장마다 켜기·끄기·그대로, 설정 덮어쓰기, drive 그룹, 적용 동작).
//   프로필 모델에 enable과 disable이 따로 있어(§6.28) 체크 상자(켬/안 켬) 하나로는 "끄기"와 "그대로"를 구분하지 못한다.
//   그래서 행마다 세 값 SegmentedControl을 둔다(스펙 와이어프레임의 체크 상자와 다름, NOTES).
// 그룹 구성: 슬롯 조각(L3.slots.spec)을 슬롯마다 하나씩 골라 새 그룹 뼈대로 → W9 만들기.
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@caustic/react";
import { useState } from "react";
import { Check, CircleX, Trash2, threads, useShell } from "../../_shell";
import { RadioList } from "../parts/radio-list";
import { ScreenHead, SectionTitle, WB_WIDTH } from "../parts/screen-head";
import { extensions, settingKeys, slotPieces, type Profile } from "../fixtures";
import { useMock } from "../store";

type Pick = "on" | "off" | "keep";
const pickOf = (p: Profile, name: string): Pick =>
  p.enable.includes(name)
    ? "on"
    : (p as Profile & { disable?: string[] }).disable?.includes(name)
      ? "off"
      : "keep";

const STATUS_NOTE: Record<string, string> = {
  auto_disabled: "자동 꺼짐",
  disabled: "꺼짐",
};

function ProfileEditor({ profile }: { profile: Profile }) {
  const m = useMock();
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(extensions.map((e) => [e.name, pickOf(profile, e.name)])),
  );
  const drives = extensions.filter((e) => e.usesDrive && picks[e.name] !== "off");
  const ctxId = useShell().contextThreadId;
  const target = threads.find((t) => t.id === ctxId)?.title ?? null;
  return (
    <div className="grid min-w-0 gap-5">
      <Field label="이름">
        <Input size="xs" defaultValue={profile.title} containerClassName="w-[min(20rem,100%)]" />
      </Field>

      <section aria-labelledby="pf-ext" className="min-w-0">
        <SectionTitle id="pf-ext">확장</SectionTitle>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {extensions.map((e) => (
            <li key={e.name} className="flex h-8 min-w-0 items-center gap-2 px-2">
              <span className="min-w-0 flex-1 truncate text-ui-dense text-text-primary">
                {e.name}
                {STATUS_NOTE[e.status] !== undefined && (
                  <span className="ms-2 text-ui-xs text-text-tertiary">
                    지금 {STATUS_NOTE[e.status]}
                  </span>
                )}
              </span>
              <SegmentedControl
                size="xs"
                value={picks[e.name] ?? "keep"}
                onValueChange={(v) => setPicks((p) => ({ ...p, [e.name]: v as Pick }))}
                aria-label={`${e.name} 프로필 값`}
              >
                <SegmentedControlItem value="on">켜기</SegmentedControlItem>
                <SegmentedControlItem value="off">끄기</SegmentedControlItem>
                <SegmentedControlItem value="keep">그대로</SegmentedControlItem>
              </SegmentedControl>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pf-set">
        <SectionTitle id="pf-set">설정 덮어쓰기</SectionTitle>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {settingKeys
            .filter(
              (k) =>
                profile.settings.some((s) => s.key === k.key) ||
                (profile.id === "explore" && k.ext === "learning"),
            )
            .map((k) => {
              const v = profile.settings.find((s) => s.key === k.key)?.value;
              return (
                <li
                  key={k.key}
                  className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2"
                >
                  <span className="min-w-0 flex-1 truncate text-ui-dense text-text-primary">
                    {k.label}
                  </span>
                  {k.type === "number" ? (
                    <NumberField
                      size="xs"
                      aria-label={k.label}
                      defaultValue={Number(v ?? k.def)}
                      min={1}
                      max={8}
                      className="w-28"
                    />
                  ) : (
                    <Switch size="sm" aria-label={k.label} defaultChecked={Boolean(v ?? k.def)} />
                  )}
                  <IconButton size="xs" variant="ghost" label={`${k.label} 덮어쓰기 빼기`}>
                    <Trash2 />
                  </IconButton>
                </li>
              );
            })}
        </ul>
        <Button size="xs" variant="ghost" className="ms-1 mt-1">
          설정 더하기
        </Button>
      </section>

      <Field label="drive 그룹">
        <Select
          size="xs"
          defaultValue={profile.driveGroup ?? "auto"}
          className="w-[min(20rem,100%)]"
        >
          <SelectOption value="auto">자동(먼저 요청한 그룹)</SelectOption>
          {drives.map((e) => (
            <SelectOption key={e.name} value={e.name}>
              {e.name}
            </SelectOption>
          ))}
        </Select>
      </Field>

      <div className="grid gap-2">
        {m.applyFailed && (
          <Alert tone="danger" variant="soft" size="sm" emphasis="lead">
            <b>적용하지 못했어요.</b> 키 2개를 쓰지 못해 이미 쓴 3개를 되돌렸어요.
            <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-ui-dense">
              <li className="text-text-secondary">정책 파일이 잠갔어요 · ~/.fresnel/policy.json</li>
              <li className="text-text-secondary">review가 꺼져 있어 drive 그룹이 될 수 없어요</li>
            </ul>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            tone="accent"
            variant="solid"
            disabled={target === null}
            onClick={() => m.notify("다음 단계 경계에 적용해요")}
          >
            {target === null ? "대화를 고르면 적용" : "이 대화에 적용"}
          </Button>
          <Button
            size="sm"
            variant="soft"
            onClick={() => m.notify("테스트 대화를 만들고 적용했어요")}
          >
            새 테스트 대화로
          </Button>
          <Button size="sm" variant="ghost" onClick={() => m.notify("저장했어요")}>
            저장
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            onClick={() => m.set({ composeTab: "group" })}
          >
            그룹 뼈대로
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProfilesTab() {
  const m = useMock();
  const [sel, setSel] = useState(m.applyFailed ? "review-trial" : "explore");
  const profile = m.profiles.find((p) => p.id === sel) ?? m.profiles[0];
  return (
    <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-6 max-[900px]:grid-cols-1 max-[900px]:gap-3">
      <ListNavigation aria-label="프로필" kind="sessions" size="sm" as="div" className="self-start">
        <ListNavigationGroup
          heading="프로필"
          addLabel="새 프로필"
          onAdd={() => m.notify("새 프로필을 만들어요")}
        >
          {m.profiles.map((p) => (
            <ListNavigationItem
              key={p.id}
              current={p.id === sel}
              meta={p.driveGroup ?? "자동"}
              onSelect={() => setSel(p.id)}
            >
              {p.title}
            </ListNavigationItem>
          ))}
        </ListNavigationGroup>
      </ListNavigation>
      {profile !== undefined && <ProfileEditor key={profile.id} profile={profile} />}
    </div>
  );
}

const SLOTS = ["트리거", "펼치기", "모으기", "적용"] as const;
const DEFAULT_PICK: Record<string, string> = {
  트리거: "trigger.signal",
  펼치기: "fanout.lenses",
  모으기: "converge.vote",
  적용: "apply.task",
};

function GroupTab() {
  const m = useMock();
  const [pick, setPick] = useState(DEFAULT_PICK);
  const chosen = slotPieces.filter((p) => Object.values(pick).includes(p.id));
  const needs = [...new Set(chosen.flatMap((p) => p.requires))];
  const drives = chosen.some((p) => p.slot === "펼치기");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_16rem] gap-6 max-[900px]:grid-cols-1">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 max-[700px]:grid-cols-1">
        {SLOTS.map((slot) => (
          <section key={slot} aria-labelledby={`slot-${slot}`} className="min-w-0">
            <SectionTitle id={`slot-${slot}`}>{slot}</SectionTitle>
            <RadioList
              labelledBy={`slot-${slot}`}
              value={pick[slot] ?? ""}
              onValueChange={(v) => setPick((p) => ({ ...p, [slot]: v }))}
              rows={slotPieces
                .filter((p) => p.slot === slot)
                .map((p) => ({ value: p.id, title: p.label }))}
            />
          </section>
        ))}
      </div>
      <aside aria-labelledby="g-sum" className="grid content-start gap-3">
        <SectionTitle id="g-sum">이 구성이면</SectionTitle>
        <dl className="m-0 grid gap-2 px-2 text-ui-dense">
          <div className="grid gap-0.5">
            <dt className="text-ui-xs text-text-tertiary">템플릿</dt>
            <dd className="m-0 text-text-primary">
              {drives ? "플러그인 그룹 · drive" : "플러그인 그룹 · 관찰"}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-ui-xs text-text-tertiary">필요한 기능</dt>
            <dd className="m-0 grid gap-0.5">
              {needs.length === 0 && <span className="text-text-tertiary">없음</span>}
              {needs.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5 text-text-primary">
                  {n === "agents" ? (
                    <Check aria-hidden className="size-icon-xs text-text-tertiary" />
                  ) : (
                    <CircleX aria-hidden className="size-icon-xs text-text-tertiary" />
                  )}
                  <span className="font-mono text-mono-sm">{n}</span>
                  <span className="text-ui-xs text-text-tertiary">
                    {n === "agents" ? "있음" : "requires에 넣어요"}
                  </span>
                </span>
              ))}
            </dd>
          </div>
        </dl>
        <Button
          size="sm"
          tone="accent"
          variant="solid"
          className="justify-self-start"
          onClick={() => m.set({ screen: "create", createStep: 1 })}
        >
          이 구성으로 만들기
        </Button>
      </aside>
    </div>
  );
}

export function ComposeScreen() {
  const m = useMock();
  return (
    <Tabs
      value={m.composeTab}
      onValueChange={(v) => m.set({ composeTab: v as "profiles" | "group" })}
      variant="soft"
      size="sm"
      tone="neutral"
      className="flex min-h-0 flex-1 flex-col"
    >
      <ScreenHead
        title="구성"
        actions={
          <TabsList aria-label="구성 탭">
            <TabsTrigger value="profiles">프로필</TabsTrigger>
            <TabsTrigger value="group">그룹 구성</TabsTrigger>
          </TabsList>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} pb-6 pt-1`}>
          <TabsContent value="profiles">
            <ProfilesTab />
          </TabsContent>
          <TabsContent value="group">
            <GroupTab />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
