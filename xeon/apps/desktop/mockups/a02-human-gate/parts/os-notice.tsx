// 목업 전용: OS 알림(question_waiting) 미리보기. 실제로는 앱 밖(macOS 알림 센터 등)에 뜬다. 앱 화면이 아니라는 것을
// 알 수 있게 창 오른쪽 위에 "OS 알림" 머리를 단 작은 판으로만 그리고, 누르면 그 대화로 간다(flow §7.2, L4.desktop.spec 알림).
// 문구: 제목 = 앱 이름 · 대화 이름, 본문 = "<그룹>이 확인을 기다려요: <질문>". 비밀·명령 전문은 넣지 않는다.
import { Button } from "@caustic/react";
import { X } from "../../_shell";

export function OsNotice({
  title,
  body,
  onOpen,
  onClose,
}: {
  title: string;
  body: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="note"
      aria-label="OS 알림 미리보기(앱 밖)"
      className="fixed top-12 right-16 z-50 grid w-80 gap-1 rounded-2xl bg-surface-raised p-3 shadow-5 animate-rise"
    >
      <div className="flex items-center gap-2 text-ui-xs text-text-tertiary">
        <span className="grid size-5 place-items-center rounded-md bg-neutral-well font-mono text-mono-sm text-text-primary">
          X
        </span>
        <span>Xeon · 지금</span>
        <span className="ms-auto rounded-sm px-1 text-text-tertiary">OS 알림</span>
        <button
          type="button"
          aria-label="알림 닫기"
          onClick={onClose}
          className="grid size-5 place-items-center rounded-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring [&_svg]:size-icon-xs"
        >
          <X />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="grid gap-0.5 rounded-md text-start outline-none focus-visible:focus-ring"
      >
        <span className="text-ui-sm font-semibold text-text-primary">{title}</span>
        <span className="text-ui-sm text-text-secondary">{body}</span>
      </button>
      <div className="flex justify-end">
        <Button size="xs" tone="neutral" variant="ghost" onClick={onOpen}>
          열기
        </Button>
      </div>
    </div>
  );
}
