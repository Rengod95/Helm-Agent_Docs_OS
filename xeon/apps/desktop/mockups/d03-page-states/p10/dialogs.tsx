// O-05 재인증, 시크릿 추가, O-06 삭제 확인. 모두 caustic Dialog. 파괴·열람 확인은 기본 초점이 "취소"(§6.20).
import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  TagInput,
} from "@caustic/react";
import { ShieldCheck, Trash2 } from "../../_shell";
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
      icon={<ShieldCheck />}
      title="다시 인증해 주세요"
      description={
        <>
          <span className="font-mono">{name}</span> 값을 30초 동안 보여요. 열람은
          기록(secret.revealed)에 남아요.
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
        <Field label="이름" hint="설정에서 secret://exa-api-key로 불러요.">
          <Input size="sm" defaultValue="exa-api-key" className="font-mono" autoFocus />
        </Field>
        <Field label="값" hint="비워 두면 OS 입력 창으로 넣어요. 값은 이 화면에 남지 않아요.">
          <Input size="sm" type="password" defaultValue="exa_live_8d2f0c71" autoComplete="off" />
        </Field>
        <Field label="설명" optional optionalLabel="선택">
          <Input size="sm" defaultValue="Exa 웹 검색" />
        </Field>
        <Field label="허용 호스트" hint="이 호스트로 가는 요청에만 값을 넣어요.">
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
      icon={<Trash2 />}
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
          ? "대화 ‘캐시 무효화 조사’의 활성 lease가 쓰고 있어요. 턴이 끝나면 다시 해 주세요."
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
    >
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="참조와 영향"
        className="rounded-none [--cs-size-list-term:6rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term="참조 설정" mono>
          {secret.refs.join(", ") || "없음"}
        </ListDescriptionRow>
        <ListDescriptionRow term="활성 lease">{secret.leases}</ListDescriptionRow>
        <ListDescriptionRow term="최근 대화">{secret.sessions}</ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}
