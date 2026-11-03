// 일반 폼 탭(권한, 샌드박스, 대화와 컨텍스트, 실행과 서비스, 외관, 고급). 고급은 모든 항목이 파일 전용이라 빈 탭(TabVM.emptyText).
import {
  Button,
  EmptyState,
  Input,
  NumberField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
  TagInput,
} from "@caustic/react";
import { SettingRow, SettingSection } from "../_settings/row";
import type { TabId } from "../_settings/tabs";

export function GenericTab({ tab, disabled }: { tab: TabId; disabled: boolean }) {
  switch (tab) {
    case "permissions":
      return (
        <SettingSection title="승인">
          <SettingRow
            label="기본 승인 방식"
            k="l1.tools.approval.mode"
            scope="user"
            apply="nextTurn"
          >
            <RadioGroup
              aria-label="기본 승인 방식"
              orientation="horizontal"
              defaultValue="ask"
              disabled={disabled}
              className="min-h-7 gap-5"
            >
              <RadioGroupItem value="ask">매번 묻기</RadioGroupItem>
              <RadioGroupItem value="edits">편집은 허용</RadioGroupItem>
              <RadioGroupItem value="all">모두 허용</RadioGroupItem>
            </RadioGroup>
          </SettingRow>
          <SettingRow
            label="항상 허용 명령"
            k="l1.tools.approval.allow"
            scope="project"
            apply="now"
          >
            <TagInput
              aria-label="항상 허용 명령"
              defaultValue={["bun test", "git status", "rg"]}
              disabled={disabled}
              containerClassName="max-w-[28rem]"
            />
          </SettingRow>
          <SettingRow label="항상 거부 명령" k="l1.tools.approval.deny" scope="managed">
            <TagInput
              aria-label="항상 거부 명령"
              defaultValue={["rm -rf /", "git push --force"]}
              disabled
              containerClassName="max-w-[28rem]"
            />
          </SettingRow>
        </SettingSection>
      );
    case "sandbox":
      return (
        <SettingSection title="격리">
          <SettingRow label="샌드박스" k="l0.sandbox.mode" scope="user" apply="restart">
            <RadioGroup
              aria-label="샌드박스"
              orientation="horizontal"
              defaultValue="workspace"
              disabled={disabled}
              className="min-h-7 gap-5"
            >
              <RadioGroupItem value="off">끔</RadioGroupItem>
              <RadioGroupItem value="workspace">작업 폴더만</RadioGroupItem>
              <RadioGroupItem value="strict">읽기 전용</RadioGroupItem>
            </RadioGroup>
          </SettingRow>
          <SettingRow
            label="쓰기 허용 경로"
            k="l0.sandbox.writePaths"
            scope="project"
            apply="nextTurn"
          >
            <TagInput
              aria-label="쓰기 허용 경로"
              defaultValue={["~/code/fresnel", "/tmp"]}
              disabled={disabled}
              containerClassName="max-w-[28rem] font-mono"
            />
          </SettingRow>
          <SettingRow label="네트워크" k="l0.sandbox.network" scope="default" apply="nextTurn">
            <Switch size="sm" aria-label="네트워크" defaultChecked disabled={disabled} />
          </SettingRow>
        </SettingSection>
      );
    case "session":
      return (
        <SettingSection title="컨텍스트">
          <SettingRow
            label="자동 컴팩션 기준"
            k="l1.context.compactAt"
            scope="default"
            apply="nextTurn"
          >
            <div className="flex items-center gap-2">
              <NumberField
                appearance="stepper"
                containerClassName="w-36"
                size="sm"
                aria-label="자동 컴팩션 기준"
                defaultValue={80}
                min={50}
                max={95}
                disabled={disabled}
              />
              <span className="text-ui-sm text-text-tertiary">%</span>
            </div>
          </SettingRow>
          <SettingRow
            label="체크포인트 보관"
            k="l1.persistence.checkpoints.keep"
            scope="user"
            apply="now"
          >
            <NumberField
              appearance="stepper"
              containerClassName="w-36"
              size="sm"
              aria-label="체크포인트 보관"
              defaultValue={50}
              disabled={disabled}
            />
          </SettingRow>
        </SettingSection>
      );
    case "runtime":
      return (
        <SettingSection title="엔진">
          <SettingRow label="실행 방식" k="l4.desktop.engine.mode" scope="user" apply="restart">
            <RadioGroup
              aria-label="실행 방식"
              orientation="horizontal"
              defaultValue="sidecar"
              disabled={disabled}
              className="min-h-7 gap-5"
            >
              <RadioGroupItem value="sidecar">앱 안 엔진</RadioGroupItem>
              <RadioGroupItem value="service">서비스</RadioGroupItem>
            </RadioGroup>
          </SettingRow>
          <SettingRow
            label="유휴 종료"
            k="l0.process.idleShutdownMinutes"
            scope="default"
            apply="restart"
          >
            <div className="flex items-center gap-2">
              <NumberField
                appearance="stepper"
                containerClassName="w-36"
                size="sm"
                aria-label="유휴 종료(분)"
                defaultValue={30}
                disabled={disabled}
              />
              <span className="text-ui-sm text-text-tertiary">분</span>
            </div>
          </SettingRow>
          <SettingRow label="원격 대상" k="l4.desktop.remote.default" scope="user" apply="now">
            <Input
              size="sm"
              aria-label="원격 대상"
              defaultValue="build-box"
              disabled={disabled}
              containerClassName="w-60 font-mono"
            />
          </SettingRow>
        </SettingSection>
      );
    case "appearance":
      return (
        <SettingSection title="창">
          <SettingRow label="테마" k="l4.desktop.theme" scope="user" apply="now">
            <RadioGroup
              aria-label="테마"
              orientation="horizontal"
              defaultValue="system"
              className="min-h-7 gap-5"
            >
              <RadioGroupItem value="system">시스템</RadioGroupItem>
              <RadioGroupItem value="light">라이트</RadioGroupItem>
              <RadioGroupItem value="dark">다크</RadioGroupItem>
            </RadioGroup>
          </SettingRow>
          <SettingRow label="글자 크기" k="l4.desktop.fontSize" scope="user" apply="now">
            <Select size="sm" aria-label="글자 크기" defaultValue="13" className="w-32">
              <SelectOption value="12">12px</SelectOption>
              <SelectOption value="13">13px</SelectOption>
              <SelectOption value="14">14px</SelectOption>
            </Select>
          </SettingRow>
        </SettingSection>
      );
    default:
      return (
        <EmptyState
          size="sm"
          surface="none"
          title="이 탭 항목은 파일에서만 바꿔요"
          actions={
            <Button size="sm" tone="neutral" variant="outline">
              파일로 보기
            </Button>
          }
        />
      );
  }
}
