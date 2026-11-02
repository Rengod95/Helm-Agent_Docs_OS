// O-01 잠긴 대화: Dialog kind="alert". "관찰만 하기"를 고르면 입력창 자리에 관찰 띠가 선다.
import { Button, Dialog } from "@caustic/react";
import { useMock } from "./store";

export function LockedDialog() {
  const m = useMock();
  const close = () => m.setLockedOpen(false);
  return (
    <Dialog
      kind="alert"
      size="sm"
      open={m.lockedOpen}
      onOpenChange={m.setLockedOpen}
      title="이 대화는 다른 창에서 쓰고 있어요"
      footer={
        <>
          <Button size="sm" tone="neutral" variant="ghost" onClick={close}>
            닫기
          </Button>
          <span aria-hidden className="flex-1" />
          <Button
            size="sm"
            tone="neutral"
            variant="outline"
            onClick={() => {
              close();
              m.newThread();
            }}
          >
            분기해서 이어 쓰기
          </Button>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            autoFocus
            onClick={() => {
              close();
              m.setObserving(true);
            }}
          >
            관찰만 하기
          </Button>
        </>
      }
    />
  );
}
