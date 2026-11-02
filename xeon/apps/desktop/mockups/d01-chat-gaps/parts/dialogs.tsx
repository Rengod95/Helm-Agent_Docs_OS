// N-45 대화 행 메뉴의 대화 상자: 이름 바꾸기(thread.rename), O-06 삭제 확인의 대화·예약 변형(thread.delete, schedule.delete),
// 계획에 없음 6 대화 내보내기(Markdown·JSON). 모두 caustic Dialog. 파괴 확인은 kind alert, 기본 초점 "취소"(§6.20).
// 참조와 영향은 ListDescription 한 목록(DP-12와 같은 규칙).
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  Input,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
} from "@caustic/react";
import { useState } from "react";
import { josa, CalendarClock, Download, Pencil, T, Trash2 } from "../../_shell";

const LIST = "rounded-none [--cs-size-list-term:6.5rem] [&_[data-slot=list-description-row]]:px-0";

export function RenameDialog({
  title,
  onSave,
  onClose,
}: {
  title: string;
  onSave: (t: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(title);
  const empty = v.trim() === "";
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      icon={<Pencil />}
      title="이름 바꾸기"
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline">
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" disabled={empty} onClick={() => onSave(v.trim())}>
            저장
          </Button>
        </>
      }
    >
      <Input
        size="sm"
        aria-label={`${T.thread} 이름`}
        value={v}
        onValueChange={setV}
        autoFocus
        invalid={empty}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !empty) onSave(v.trim());
        }}
      />
      {empty && <p className="m-0 text-ui-xs text-danger-text">이름을 비울 수 없어요</p>}
    </Dialog>
  );
}

export interface DeleteFacts {
  title: string;
  messages: number;
  attachments: number;
  schedules: number;
  forks: number;
  running: boolean;
}

/** O-06 대화 변형. 실행 중이면 지울 수 없고 "중단하고 지우기"가 아니라 닫기만 준다(턴 중단은 대화에서). */
export function DeleteThreadDialog({
  f,
  onConfirm,
  onClose,
}: {
  f: DeleteFacts;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      kind="alert"
      size="sm"
      tone="danger"
      onOpenChange={(o) => !o && onClose()}
      icon={<Trash2 />}
      title={
        f.running
          ? `‘${f.title}’ ${josa(T.thread, "은", "는")} 지울 수 없어요`
          : `‘${f.title}’ ${josa(T.thread, "을", "를")} 지울까요?`
      }
      description={
        f.running
          ? `${josa(T.turn, "이", "가")} 실행 중이에요. 대화에서 중단한 뒤 다시 해 주세요.`
          : "메시지와 첨부가 이 기기와 엔진 저장소에서 지워져요. 되돌릴 수 없어요."
      }
      footer={
        f.running ? (
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
            <Button size="sm" tone="danger" variant="solid" onClick={onConfirm}>
              지우기
            </Button>
          </>
        )
      }
    >
      {!f.running && (
        <ListDescription variant="ghost" size="xs" aria-label="지우면 사라지는 것" className={LIST}>
          <ListDescriptionRow term="메시지">{f.messages}개</ListDescriptionRow>
          <ListDescriptionRow term="첨부">{f.attachments}개</ListDescriptionRow>
          <ListDescriptionRow term={`${T.fork}한 ${T.thread}`}>
            {f.forks === 0 ? "없음" : `${f.forks}개 · 남아요`}
          </ListDescriptionRow>
          <ListDescriptionRow term={`${T.schedules}`}>
            {f.schedules === 0
              ? "없음"
              : `${f.schedules}개 · 남아요, 다음 실행은 새 ${josa(T.thread, "으로", "로")}`}
          </ListDescriptionRow>
        </ListDescription>
      )}
    </Dialog>
  );
}

/** O-06 예약 변형: 예약이 만든 대화의 행 메뉴 "예약 지우기" 또는 P-07에서. 지난 실행 대화는 남는다. */
export function DeleteScheduleDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      kind="alert"
      size="sm"
      tone="danger"
      onOpenChange={(o) => !o && onClose()}
      icon={<CalendarClock />}
      title="‘매일 정리’ 예약을 지울까요?"
      description="다음 실행부터 멈춰요. 지난 실행이 만든 대화는 그대로 남아요. 되돌릴 수 없어요."
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" autoFocus>
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="danger" variant="solid" onClick={onConfirm}>
            예약 지우기
          </Button>
        </>
      }
    >
      <ListDescription variant="ghost" size="xs" aria-label="예약 영향" className={LIST}>
        <ListDescriptionRow term="다음 실행">내일 09:00 · 취소돼요</ListDescriptionRow>
        <ListDescriptionRow term="지난 실행">14번 · 대화는 남아요</ListDescriptionRow>
        <ListDescriptionRow term="반복" mono>
          0 9 * * *
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}

export type ExportFormat = "md" | "json";
export type ExportPhase = "idle" | "saving" | "fail";

/** 대화 내보내기(계획에 없음 6). Markdown은 읽기용, JSON은 다시 가져오기·분석용(item 원형). 시크릿 값은 어떤 형식에도 없고 핸들만 남는다. */
export function ExportDialog({
  title,
  format,
  phase,
  onFormat,
  onSave,
  onClose,
}: {
  title: string;
  format: ExportFormat;
  phase: ExportPhase;
  onFormat: (f: ExportFormat) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [tools, setTools] = useState(true);
  const [runtime, setRuntime] = useState(false);
  const file = `${title}.${format === "md" ? "md" : "json"}`;
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      icon={<Download />}
      title={T.exportThread}
      description={`‘${title}’를 파일로 저장해요.`}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline">
              취소
            </Button>
          </DialogClose>
          <Button size="sm" tone="neutral" loading={phase === "saving"} onClick={onSave}>
            {phase === "fail" ? "다른 곳에 저장…" : "저장…"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <RadioGroup
          aria-label="형식"
          size="sm"
          value={format}
          onValueChange={(v) => onFormat(v === "json" ? "json" : "md")}
        >
          <RadioGroupItem value="md">
            <span className="grid">
              <span>Markdown</span>
              <span className="text-ui-xs text-text-tertiary">읽고 공유하기 좋아요</span>
            </span>
          </RadioGroupItem>
          <RadioGroupItem value="json">
            <span className="grid">
              <span>JSON</span>
              <span className="text-ui-xs text-text-tertiary">
                항목 원형 그대로 · 다른 도구에서 읽기
              </span>
            </span>
          </RadioGroupItem>
        </RadioGroup>
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-ui-sm text-text-primary">
            <Checkbox size="sm" checked={tools} onCheckedChange={(c) => setTools(c === true)} />
            도구 결과 포함
          </label>
          <label className="flex items-center gap-2 text-ui-sm text-text-primary">
            <Checkbox size="sm" checked={runtime} onCheckedChange={(c) => setRuntime(c === true)} />
            {T.runtime} 행 포함({T.lead}·{T.group} 전환)
          </label>
        </div>
        <ListDescription variant="ghost" size="xs" aria-label="내보낼 내용" className={LIST}>
          <ListDescriptionRow term="파일" mono>
            {file}
          </ListDescriptionRow>
          <ListDescriptionRow term="항목">메시지 18 · 도구 7 · 승인 2</ListDescriptionRow>
          <ListDescriptionRow term="시크릿">값은 넣지 않아요 · 핸들만</ListDescriptionRow>
        </ListDescription>
        {phase === "fail" && (
          <Alert tone="danger" size="sm">
            ~/Documents에 쓸 수 없어요 · 권한 없음(EACCES)
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
