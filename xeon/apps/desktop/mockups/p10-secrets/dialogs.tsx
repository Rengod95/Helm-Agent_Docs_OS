// O-05 재인증, 시크릿 추가, O-06 삭제 확인. 모두 caustic Dialog. 파괴·열람 확인은 기본 초점이 "취소"(§6.20).
import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  TagInput,
} from "@caustic/react";
import type { Secret } from "./fixtures";

export function ReauthDialog({
  name,
  open,
  onOpenChange,
  onContinue,
}: {
  name: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <Dialog
      kind="alert"
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      title="다시 인증해 주세요"
      description={
        <>
          <span className="font-mono">{name}</span> 값을 30초 동안 보여요. 열람은 기록에 남아요.
        </>
      }
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" variant="solid" onClick={onContinue}>
            OS 인증으로 계속
          </Button>
        </>
      }
    />
  );
}

export function AddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      title="시크릿 추가"
      closeLabel="닫기"
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="ghost">
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" variant="solid">
            추가
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="이름">
          <Input size="sm" defaultValue="exa-api-key" className="font-mono" autoFocus />
        </Field>
        <Field label="값">
          <Input size="sm" type="password" defaultValue="exa_live_8d2f0c71" autoComplete="off" />
        </Field>
        <Field label="설명" optional optionalLabel="선택">
          <Input size="sm" defaultValue="Exa 웹 검색" />
        </Field>
        <Field label="허용 호스트">
          <TagInput size="sm" defaultValue={["api.exa.ai"]} placeholder="호스트 더하기" />
        </Field>
        <div className="grid grid-cols-2 items-start gap-3">
          <Field label="만료">
            <Select size="sm" defaultValue="none">
              <SelectOption value="none">없음</SelectOption>
              <SelectOption value="30">30일 뒤</SelectOption>
              <SelectOption value="90">90일 뒤</SelectOption>
            </Select>
          </Field>
          <Field label="승인" group>
            <RadioGroup defaultValue="never" className="gap-1.5">
              <RadioGroupItem value="never">묻지 않음</RadioGroupItem>
              <RadioGroupItem value="thread">대화마다 한 번</RadioGroupItem>
              <RadioGroupItem value="always">매번 묻기</RadioGroupItem>
            </RadioGroup>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

export function DeleteDialog({
  secret,
  inUse,
  open,
  onOpenChange,
}: {
  secret: Secret;
  inUse: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={open}
      onOpenChange={onOpenChange}
      title={
        inUse ? (
          <>
            <span className="font-mono">{secret.name}</span>은 지울 수 없어요
          </>
        ) : (
          <>
            <span className="font-mono">{secret.name}</span>을 지울까요?
          </>
        )
      }
      description={
        inUse
          ? "대화 ‘캐시 무효화 조사’가 쓰고 있어요. 턴이 끝나면 다시 해 주세요."
          : "되돌릴 수 없어요. 참조하는 설정은 값이 비어요."
      }
      footer={
        inUse ? (
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              닫기
            </Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button size="sm" tone="neutral" variant="outline" autoFocus>
                취소
              </Button>
            </DialogClose>
            <Button size="sm" tone="danger" variant="solid">
              삭제
            </Button>
          </>
        )
      }
    ></Dialog>
  );
}
