// O-08 예약 편집 시트(caustic Sheet side="right"). P-07의 상태(S2~S8)로 둔다.
// 트리거 편집 부품이 caustic에 없어(gap C-13) SegmentedControl + 종류별 입력 조합으로 만든다.
import {
  Alert,
  Button,
  DatePicker,
  Field,
  Input,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Sheet,
  Switch,
  TagInput,
  Textarea,
} from "@caustic/react";
import { useState } from "react";
import { triggerLabel, type TriggerKind } from "./fixtures";

export interface SheetMode {
  trigger: TriggerKind;
  error?: "interval_too_short";
  saving?: boolean;
  duplicate?: boolean;
  /** d03: 있는 예약 고치기(schedule.update). */
  edit?: boolean;
}

function TriggerFields({ kind, error }: { kind: TriggerKind; error?: string | undefined }) {
  switch (kind) {
    case "interval":
      return (
        <Field label="간격" size="sm" error={error}>
          <NumberField
            size="sm"
            aria-label="간격(초)"
            unit="초"
            min={1}
            max={31536000}
            defaultValue={error !== undefined ? 60 : 86400}
            invalid={error !== undefined}
          />
        </Field>
      );
    case "at":
      return (
        <div className="flex gap-2">
          <Field label="날짜" size="sm" className="min-w-0 flex-1">
            <DatePicker size="sm" today="2026-10-30" defaultValue="2026-11-03" />
          </Field>
          <Field label="시간" size="sm" className="w-28">
            <Input size="sm" type="time" defaultValue="10:00" />
          </Field>
        </div>
      );
    case "fileWatch":
      return (
        <>
          <Field label="감시 경로" size="sm">
            <TagInput size="sm" defaultValue={["src/**", "test/**"]} placeholder="경로 더하기" />
          </Field>
          <Field label="debounce" size="sm">
            <NumberField size="sm" aria-label="debounce(밀리초)" unit="ms" defaultValue={2000} />
          </Field>
        </>
      );
    case "remote":
      return (
        <p className="m-0 text-ui-sm font-normal text-text-secondary">
          연결 화면에서 원격 예약을 켜야 해요.
        </p>
      );
    case "loop":
      return (
        <>
          <div className="flex gap-2">
            <Field label="간격" size="sm" className="min-w-0 flex-1">
              <NumberField size="sm" aria-label="루프 간격(초)" unit="초" defaultValue={600} />
            </Field>
            <Field label="최대 반복" size="sm" className="min-w-0 flex-1">
              <NumberField
                size="sm"
                appearance="stepper"
                aria-label="최대 반복"
                min={1}
                defaultValue={10}
              />
            </Field>
          </div>
          <Field label="만료" size="sm">
            <DatePicker size="sm" today="2026-10-30" defaultValue="2026-11-06" />
          </Field>
        </>
      );
  }
}

export function ScheduleSheet({
  mode,
  open,
  onOpenChange,
}: {
  mode: SheetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<TriggerKind>(mode.trigger);
  const error =
    mode.error === "interval_too_short" && kind === "interval" ? "최소 300초예요" : undefined;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode.edit ? "예약 고치기" : mode.duplicate ? "예약 복제" : "새 예약"}
      closeLabel="닫기"
      size="sm"
      footer={
        <>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button size="sm" variant="solid" disabled={mode.saving}>
            {mode.saving ? "서비스 켜는 중" : "저장"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="제목" size="sm">
          <Input
            size="sm"
            defaultValue={
              mode.edit ? "주간 보고" : mode.duplicate ? "매일 정리 (복제)" : "매일 정리"
            }
          />
        </Field>
        <Field label="트리거" size="sm" group>
          <SegmentedControl
            size="xs"
            aria-label="트리거 종류"
            value={kind}
            onValueChange={(v) => setKind(v as TriggerKind)}
          >
            {(Object.keys(triggerLabel) as TriggerKind[]).map((k) => (
              <SegmentedControlItem key={k} value={k}>
                {triggerLabel[k]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Field>
        <TriggerFields kind={kind} error={error} />
        <Field label="프롬프트" size="sm">
          <Textarea size="sm" rows={3} defaultValue="오래된 브랜치를 정리하고 결과를 요약해 줘" />
        </Field>
        <Field label="작업 폴더" size="sm">
          <Select size="sm" defaultValue="~/code/fresnel" aria-label="작업 폴더">
            <SelectOption value="~/code/fresnel">~/code/fresnel</SelectOption>
            <SelectOption value="~/notes">~/notes</SelectOption>
          </Select>
        </Field>
        <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
          <span className="flex-1">{mode.edit ? "저장하고 다시 켜기" : "만들고 바로 켜기"}</span>
          <Switch size="sm" defaultChecked aria-label="만들고 바로 켜기" />
        </label>
        <Alert tone="warning" size="sm">
          {mode.saving
            ? "서비스를 켜고 있어요. 켜지면 예약을 저장해요."
            : "서비스 모드가 꺼져 있어요. 저장하면 서비스를 켜려고 해요."}
        </Alert>
      </div>
    </Sheet>
  );
}
