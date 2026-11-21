import { Check, Clock } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import type { DriveInputRecord } from "../../state/engine/convo.ts";
import { UserBubble } from "./message-rows.tsx";

// Drive가 받은 사용자 말(lcM6a, L4 desktop-ux §6.6.1). 보낸 말은 사라지지 않는다: 플러그인이 이끄는 동안 보낸 말과
// 스타트 Drive 대화의 첫 말은 보낸 자리에 내 말풍선으로 바로 서고, 아래에 조용히 "전달 대기" → "전달됨"을 적는다.
// 기본 루프로 돌아간 말은 보통 대기 입력·턴이 되므로 이 줄이 아니다(거울의 `selectDriveInputs`가 뺀다).

export function DriveInputRow(props: { readonly input: DriveInputRecord }): ReactNode {
  const { input } = props;
  const status = input.settled
    ? t("desktop.driveInput.delivered")
    : t("desktop.driveInput.pending");
  if (input.text === null) return null;
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] justify-items-end gap-1"
      aria-label={t("desktop.driveInput.aria", { status })}
      data-drive-input={input.settled ? "delivered" : "pending"}
    >
      <UserBubble text={input.text} />
      <span role="status" className="flex items-center gap-1 pe-1 text-footnote text-text-tertiary">
        {input.settled ? (
          <Check aria-hidden className="size-3 shrink-0" />
        ) : (
          <Clock aria-hidden className="size-3 shrink-0" />
        )}
        {status}
      </span>
    </div>
  );
}
