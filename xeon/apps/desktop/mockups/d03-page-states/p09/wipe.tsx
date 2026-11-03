// d03(묶음 D): O-06 데이터 지우기 변형(계획에 없음 6). 지우는 것과 남는 것을 ListDescription 한 목록으로, 고를 것 둘(시크릿 값,
// 사용자 확장), 확인 글 입력. 진행 중 턴·예약이 있으면 지우지 않고 이유만 보인다. 기본 초점은 "취소"(§6.20).
// 지운 뒤 앱은 다시 시작해 첫 실행(P-01)으로 간다.
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  Input,
  ListDescription,
  ListDescriptionRow,
  Progress,
} from "@caustic/react";
import { useState } from "react";
import { josa, T } from "../../_shell";

const LIST = "rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0";
const WORD = "지우기";

export function WipeDialog({
  typed,
  blocked,
  onClose,
}: {
  typed: boolean;
  blocked: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState(typed ? WORD : "");
  const [secrets, setSecrets] = useState(false);
  const [exts, setExts] = useState(false);
  const [phase, setPhase] = useState<"confirm" | "wiping" | "done">("confirm");
  const go = () => {
    setPhase("wiping");
    window.setTimeout(() => setPhase("done"), 1800);
  };
  if (phase !== "confirm")
    return (
      <div
        role="status"
        className="fixed inset-0 z-[60] grid place-items-center bg-bg-app animate-enter"
      >
        <div className="grid justify-items-center gap-3">
          <p className="m-0 text-ui-sm text-text-secondary">
            {phase === "wiping"
              ? "데이터를 지우는 중이에요"
              : "다 지웠어요. 첫 실행 화면으로 다시 시작해요."}
          </p>
          {phase === "wiping" ? (
            <Progress decorative size="xs" className="w-40" />
          ) : (
            <Button size="sm" tone="neutral" onClick={onClose}>
              다시 시작
            </Button>
          )}
        </div>
      </div>
    );
  return (
    <Dialog
      open
      kind="alert"
      size="md"
      tone="danger"
      onOpenChange={(o) => !o && onClose()}
      title={blocked ? "지금은 데이터를 지울 수 없어요" : "이 기기의 데이터를 모두 지울까요?"}
      description={
        blocked
          ? `진행 중인 ${josa(T.turn, "과", "와")} 실행 중인 ${josa(T.schedules, "이", "가")} 있어요. 멈춘 뒤 다시 해 주세요.`
          : "되돌릴 수 없어요."
      }
      footer={
        blocked ? (
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              닫기
            </Button>
          </DialogClose>
        ) : (
          <>
            <Button size="sm" tone="neutral" variant="ghost" className="me-auto">
              먼저 내보내기…
            </Button>
            <DialogClose asChild>
              <Button size="sm" tone="neutral" variant="outline" autoFocus>
                취소
              </Button>
            </DialogClose>
            <Button size="sm" tone="danger" variant="solid" disabled={text !== WORD} onClick={go}>
              모두 지우기
            </Button>
          </>
        )
      }
    >
      {blocked ? (
        <ListDescription variant="ghost" size="xs" aria-label="먼저 멈출 것" className={LIST}>
          <ListDescriptionRow term={`진행 중 ${T.turn}`}>캐시 무효화 조사</ListDescriptionRow>
          <ListDescriptionRow term={T.schedules}>매일 정리 · 09:00 실행 중</ListDescriptionRow>
        </ListDescription>
      ) : (
        <div className="grid gap-3">
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label="지우는 것과 남는 것"
            className={LIST}
          >
            <ListDescriptionRow term="지워요">
              대화 42개 · 첨부 · 예약 5개 · 설정(사용자 범위)
            </ListDescriptionRow>
            <ListDescriptionRow term="지워요">{T.profile} 3개 · 기록과 측정</ListDescriptionRow>
            <ListDescriptionRow term="남아요">
              프로젝트 폴더의 .fresnel 설정 · 관리 설정
            </ListDescriptionRow>
            <ListDescriptionRow term="남아요">원격 대상(build-box)의 대화</ListDescriptionRow>
          </ListDescription>
          <div className="grid gap-1.5">
            <label className="flex items-center gap-2 text-ui-sm text-text-primary">
              <Checkbox
                size="sm"
                checked={secrets}
                onCheckedChange={(c) => setSecrets(c === true)}
              />
              시크릿 값도 지우기(OS 키체인 6개)
            </label>
            <label className="flex items-center gap-2 text-ui-sm text-text-primary">
              <Checkbox size="sm" checked={exts} onCheckedChange={(c) => setExts(c === true)} />
              사용자 {T.extension}도 지우기(3개)
            </label>
          </div>
          <label className="grid gap-1 text-ui-sm text-text-secondary">
            확인하려면 ‘{WORD}’를 입력해요
            <Input size="sm" value={text} onValueChange={setText} aria-label="확인 글" />
          </label>
          {secrets && (
            <Alert tone="warning" size="sm">
              시크릿 값을 지우면 다시 넣기 전까지 모델과 도구가 키를 못 써요.
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
