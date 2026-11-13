import { t } from "@fresnel/client/i18n";
import { Chip } from "@caustic/react";
import { Image, Paperclip } from "@caustic/react/icons";
import type { ReactNode } from "react";
import type { BubbleAttachment } from "./attachment-bubble-model.ts";

// 보낸 메시지 말풍선 아래의 첨부 표시(W2, DP-142). 파일은 클립 칩, 이미지는 썸네일이다. 썸네일로 그릴 바이트가 없으면(호스트 자리표시이고
// 이 창에서 올린 기억도 없음, `image-thumbs.ts`) 이미지 아이콘과 이름의 칩이다.
// 칩 테두리는 말풍선과 같은 옅은 선(border-subtle)이다. caustic outline 칩의 기본 테두리(neutral-border)를 cn이 덮는다.
// 대화 안 첨부 칩 테두리는 대화 상자 테두리와 같은 단계(라이트 border.default, 다크 border.subtle, convo.css DP-139)
const CHIP_EDGE_CLASS = "shadow-[inset_0_0_0_1px_var(--convo-edge)]";

/** 같은 이름이 여러 번 나오면 몇 번째인지를 덧붙여 키를 만든다 */
function keyed(
  attachments: readonly BubbleAttachment[],
): readonly { readonly key: string; readonly attachment: BubbleAttachment }[] {
  const seen = new Map<string, number>();
  return attachments.map((attachment) => {
    const label = `${attachment.kind}:${attachment.name}`;
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return { key: `${label}#${count}`, attachment };
  });
}

export function MessageAttachments(props: {
  readonly attachments: readonly BubbleAttachment[];
}): ReactNode {
  if (props.attachments.length === 0) return null;
  return (
    <ul
      className="convo-attachments m-0 flex list-none flex-wrap justify-end gap-1.5 p-0"
      aria-label={t("desktop.item.attachments.label")}
    >
      {keyed(props.attachments).map(({ key, attachment }) => (
        <li key={key} className="min-w-0 max-w-full">
          {attachment.kind === "image" && attachment.src !== null ? (
            <img
              src={attachment.src}
              alt={attachment.name === "" ? t("desktop.item.imagePlaceholder") : attachment.name}
              className="block max-h-40 max-w-60 rounded-md object-cover shadow-[inset_0_0_0_1px_var(--convo-edge)]"
            />
          ) : (
            <Chip
              size="md"
              variant="outline"
              radius="md"
              className={CHIP_EDGE_CLASS}
              icon={attachment.kind === "image" ? <Image aria-hidden /> : <Paperclip aria-hidden />}
              title={
                attachment.kind === "file" ? (attachment.detail ?? attachment.name) : undefined
              }
            >
              {attachment.name === "" ? t("desktop.item.imagePlaceholder") : attachment.name}
            </Chip>
          )}
        </li>
      ))}
    </ul>
  );
}
