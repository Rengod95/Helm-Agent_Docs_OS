// P-13 플러그인과 그룹: 런타임 표면. Fresnel은 층별 플러그인(F/X/L0~L3)과 L3 플러그인 그룹으로 조립되므로, 이 화면은
//   1) 이 대화에서 켜진 그룹, 주도를 가진 그룹, 다음 단계 경계에 걸린 전환
//   2) L3 플러그인 그룹(내장·사용자·프로젝트): 훅(on·post·drive·scope), drive 상태, 자동 끄기·신뢰·안전 모드, 그룹 설정
//   3) 층별 플러그인(L2·L1·L0)
//   4) 핸들러 실패 기록(scope.handler_failed)
// 과 그룹 만들기 · 다시 불러오기를 한곳에 둔다.
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  ListDescription,
  ListDescriptionRow,
  NumberField,
  Popover,
  PopoverTitle,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
} from "@caustic/react";
import { useState } from "react";
import {
  CircleAlert,
  Compass,
  Copy,
  Lightbulb,
  Package,
  Plus,
  RotateCw,
  useShell,
} from "../_shell";
import { SettingsFrame } from "../_settings/frame";
import { SettingRow, SettingSection } from "../_settings/row";
import { gotoTabPage, type TabId } from "../_settings/tabs";
import { failures, groups, plugins, type Ext } from "./fixtures";
import { GroupRow, InlineButton, PluginRow } from "./parts";

export const STATES = [
  { id: "S1", label: "S1 기본" },
  { id: "S2", label: "S2 안전 모드" },
  { id: "S3", label: "S3 실패 자세히" },
  { id: "S4", label: "S4 그룹 만들기" },
  { id: "S5", label: "S5 사용자 그룹 없음" },
  { id: "S6", label: "S6 저장 실패" },
  { id: "S7", label: "S7 다시 불러오는 중" },
] as const;
type State = (typeof STATES)[number]["id"];

const ld = "rounded-none [--cs-size-list-term:7.5rem] [&_[data-slot=list-description-row]]:px-0";

function ThisThread({ safe }: { safe: boolean }) {
  const shell = useShell();
  return (
    <SettingSection
      title="이 대화 · 캐시 무효화 조사"
      end={
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          iconStart={<Compass />}
          onClick={() => shell.openEnd("helm")}
        >
          탐구 보기
        </Button>
      }
    >
      <ListDescription variant="ghost" size="xs" aria-label="이 대화의 그룹 상태" className={ld}>
        <ListDescriptionRow term="켜진 그룹">
          {safe ? (
            <span className="text-text-tertiary">없음 (안전 모드)</span>
          ) : (
            "Helm · 학습은 다음 단계 경계에 켜져요"
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term="주도">
          {safe ? (
            <span className="text-text-tertiary">없음</span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">Helm</span>
              <span className="text-text-tertiary">
                주도 차수 3 · 턴 1/4 · spawn 2/8 · 렌즈 3 실행 중
              </span>
            </span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term="drive 그룹">
          <span className="flex items-center gap-2">
            <Select
              size="xs"
              aria-label="drive 그룹"
              defaultValue="auto"
              disabled={safe}
              className="w-40"
            >
              <SelectOption value="auto">자동</SelectOption>
              <SelectOption value="group-helm">Helm</SelectOption>
              <SelectOption value="review">review</SelectOption>
            </Select>
            <span className="font-mono text-mono-sm text-text-tertiary">
              x.primitives.activeDriveGroup · 대화
            </span>
          </span>
        </ListDescriptionRow>
      </ListDescription>
    </SettingSection>
  );
}

function HelmSettings({ error }: { error: boolean }) {
  return (
    <>
      <SettingRow label="자동 시작" k="ext.helm.autoStart" scope="user" apply="boundary">
        <Select size="xs" aria-label="자동 시작" defaultValue="suggest" className="w-40">
          <SelectOption value="off">끔</SelectOption>
          <SelectOption value="suggest">제안만</SelectOption>
          <SelectOption value="auto">자동</SelectOption>
        </Select>
      </SettingRow>
      <SettingRow
        label="렌즈 수"
        k="ext.helm.lenses"
        scope="user"
        apply="boundary"
        error={error ? "1에서 8 사이여야 해요." : undefined}
      >
        <NumberField
          appearance="stepper"
          containerClassName="w-32"
          size="xs"
          aria-label="렌즈 수"
          defaultValue={error ? 12 : 3}
          min={1}
          max={8}
          invalid={error}
        />
      </SettingRow>
      <SettingRow
        label="자식 쓰기 거부"
        k="ext.helm.denyChildWrites"
        scope="default"
        apply="boundary"
      >
        <Switch size="sm" aria-label="자식 쓰기 거부" defaultChecked />
      </SettingRow>
      <SettingRow label="주도 상한" k="x.primitives.driveLimits" scope="default" apply="boundary">
        <div className="flex items-center gap-3 text-ui-sm text-text-tertiary">
          턴
          <NumberField
            appearance="stepper"
            containerClassName="w-28"
            size="xs"
            aria-label="주도 턴 상한"
            defaultValue={4}
          />
          spawn
          <NumberField
            appearance="stepper"
            containerClassName="w-28"
            size="xs"
            aria-label="주도 spawn 상한"
            defaultValue={8}
          />
        </div>
      </SettingRow>
    </>
  );
}

function FailureDetail({ open }: { open: boolean }) {
  return (
    <Popover
      side="bottom"
      align="end"
      size="sm"
      defaultOpen={open}
      className="w-80"
      anchor={
        <Button size="xs" tone="neutral" variant="ghost">
          자세히
        </Button>
      }
    >
      <PopoverTitle>review 핸들러 실패</PopoverTitle>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="실패 자세히"
        className={`${ld} [--cs-size-list-term:5.5rem]`}
      >
        <ListDescriptionRow term="훅" mono>
          tool.call.before
        </ListDescriptionRow>
        <ListDescriptionRow term="오류" mono>
          handler_timeout · 2000ms
        </ListDescriptionRow>
        <ListDescriptionRow term="기준">연속 5번 (최근 50번 중 7번)</ListDescriptionRow>
        <ListDescriptionRow term="위치" mono>
          src/index.ts:42
        </ListDescriptionRow>
        <ListDescriptionRow term="마지막">3분 전</ListDescriptionRow>
      </ListDescription>
      <div className="flex justify-end gap-1 pt-2">
        <Button size="xs" tone="neutral" variant="ghost" iconStart={<Copy />}>
          진단 복사
        </Button>
        <Button size="xs" tone="neutral" variant="outline">
          다시 켜기
        </Button>
      </div>
    </Popover>
  );
}

function NewGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState("pr-triage");
  return (
    <Dialog
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      title="그룹 만들기"
      description="그룹은 루프에 on·post·drive·scope로 붙는 L3 확장이에요. 이름과 위치를 고르면 뼈대를 만들고, 고친 뒤 다시 불러와요."
      closeLabel="닫기"
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="ghost">
              닫기
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" variant="solid" iconStart={<Plus />}>
            만들기
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="이름" hint="소문자, 숫자, 하이픈 2~32자">
          <Input size="sm" value={name} onValueChange={setName} className="font-mono" />
        </Field>
        <Field label="위치" group>
          <RadioGroup defaultValue="project" orientation="horizontal" className="gap-5">
            <RadioGroupItem value="user">사용자 · ~/.fresnel/groups</RadioGroupItem>
            <RadioGroupItem value="project">프로젝트 · .fresnel/groups</RadioGroupItem>
          </RadioGroup>
        </Field>
        <ol className="m-0 grid list-none gap-2 p-0 text-ui text-text-secondary">
          <li className="grid gap-1">
            <span>
              1. 이름과 위치를 고르고 만들면 <b className="font-mono">{name}</b> 뼈대가 생겨요
            </span>
          </li>
          <li>2. manifest.json의 usesDrive와 src/index.ts의 scope setup을 고쳐요</li>
          <li>
            3. 이 화면의 “다시 불러오기”를 누르면 다음 단계 경계에 실려요. 프로젝트 그룹은 처음에
            신뢰를 물어요
          </li>
        </ol>
      </div>
    </Dialog>
  );
}

export function App({ state }: { state: State }) {
  const onTabSelect = (id: TabId) => void gotoTabPage(id, "p13-plugins");
  const safe = state === "S2";
  const reloading = state === "S7";
  const [newOpen, setNewOpen] = useState(state === "S4");
  const list: Ext[] = state === "S5" ? groups.filter((g) => g.source === "builtin") : groups;
  const icon = (g: Ext) =>
    g.name === "group-helm" ? (
      <Compass />
    ) : g.name === "group-learning" ? (
      <Lightbulb />
    ) : g.name === "group-account-rotation" ? (
      <RotateCw />
    ) : (
      <Package />
    );
  const layers = (["L2", "L1", "L0"] as const).map((l) => ({
    l,
    items: plugins.filter((p) => p.layer === l),
  }));

  return (
    <>
      <SettingsFrame
        tab="plugins"
        onTabSelect={onTabSelect}
        modalOpen={newOpen}
        meta={safe ? "안전 모드" : "확장 17개 · 안전 모드 꺼짐"}
        actions={
          <>
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              iconStart={<RotateCw />}
              disabled={reloading}
            >
              {reloading ? "다시 불러오는 중" : "다시 불러오기"}
            </Button>
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<Plus />}
              onClick={() => setNewOpen(true)}
            >
              그룹 만들기
            </Button>
          </>
        }
        banner={
          safe ? (
            <Alert
              tone="warning"
              layout="inline"
              action={
                <Button size="xs" tone="neutral" variant="outline">
                  안전 모드 끄고 다시 시작
                </Button>
              }
            >
              안전 모드로 시작했어요. 사용자·프로젝트 확장과 L3 내장 그룹을 싣지 않았어요.
            </Alert>
          ) : reloading ? (
            <Alert tone="info" layout="inline">
              확장 3개가 바뀌었어요. 진행 중인 턴이 끝나는 단계 경계에서 새로 실어요.
            </Alert>
          ) : undefined
        }
      >
        <ThisThread safe={safe} />

        <SettingSection title={`플러그인 그룹 · L3 ${list.length}`}>
          {list.map((g) => (
            <GroupRow
              key={g.name}
              e={g}
              icon={icon(g)}
              safe={safe}
              error={
                state === "S6" && g.name === "group-learning"
                  ? "켜기를 저장하지 못했어요. 엔진이 잠시 바빠요."
                  : undefined
              }
              actions={
                g.state.kind === "autoDisabled" && !safe ? (
                  <>
                    <FailureDetail open={state === "S3"} />
                    <InlineButton>다시 켜기</InlineButton>
                  </>
                ) : g.state.kind === "untrusted" && !safe ? (
                  <InlineButton>신뢰…</InlineButton>
                ) : g.name === "group-account-rotation" ? (
                  <span className="pe-1 text-ui-sm text-text-tertiary">켜면 위험 안내</span>
                ) : undefined
              }
              {...(g.name === "group-helm"
                ? {
                    settings: <HelmSettings error={state === "S6"} />,
                    settingsCount: 4,
                    defaultOpen: state === "S6",
                  }
                : g.name === "group-learning"
                  ? {
                      settings: (
                        <p className="m-0 text-ui-sm text-text-tertiary">
                          리뷰 기준, 승인, 스캔 4개
                        </p>
                      ),
                      settingsCount: 4,
                    }
                  : {})}
            />
          ))}
          {state === "S5" && (
            <div className="flex items-center gap-2 py-2 ps-7.5 text-ui text-text-secondary">
              사용자 그룹이 없어요. 위의 “그룹 만들기”로 만들어요.
            </div>
          )}
        </SettingSection>

        {layers.map(({ l, items }) => (
          <SettingSection key={l} title={`플러그인 · ${l} ${items.length}`}>
            {items.map((p) => (
              <PluginRow key={p.name} e={p} safe={safe} />
            ))}
          </SettingSection>
        ))}

        <SettingSection title={`핸들러 실패 ${failures.length}`}>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {failures.map((f) => (
              <li key={f.ext + f.point} className="flex min-h-8 min-w-0 items-center gap-2 text-ui">
                <CircleAlert aria-hidden className="size-icon-sm flex-none text-danger-text" />
                <span className="font-mono text-mono text-text-primary">{f.ext}</span>
                <span className="min-w-0 truncate font-mono text-mono-sm text-text-secondary">
                  {f.point} · {f.code}
                </span>
                <span className="ms-auto flex-none text-ui-sm text-text-tertiary">
                  {f.detail} · {f.count} · {f.at}
                </span>
              </li>
            ))}
          </ul>
        </SettingSection>
        {safe && (
          <p className="m-0 pt-2">
            <Badge size="sm" tone="neutral">
              관리·L0~L2 내장 확장만 실렸어요
            </Badge>
          </p>
        )}
      </SettingsFrame>
      <NewGroupDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
