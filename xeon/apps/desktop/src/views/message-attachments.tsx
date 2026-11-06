import { t } from "@fresnel/client/i18n";
import { Chip } from "@caustic/react";
import { Paperclip } from "@caustic/react/icons";
import type { ReactNode } from "react";
import type { BubbleAttachment } from "./attachment-bubble-model.ts";

// 보낸 메시지 말풍선 아래의 첨부 표시(W2). 파일은 칩, 이미지는 썸네일이다. 썸네일로 그릴 바이트가 없으면(호스트 자리표시자) 이미지 이름 칩이다.

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
      className="m-0 flex list-none flex-wrap justify-end gap-1.5 p-0"
      aria-label={t("desktop.item.attachments.label")}
    >
      {keyed(props.attachments).map(({ key, attachment }) => (
        <li key={key} className="min-w-0 max-w-full">
          {attachment.kind === "image" && attachment.src !== null ? (
            <img
              src={attachment.src}
              alt={attachment.name === "" ? t("desktop.item.imagePlaceholder") : attachment.name}
              className="max-h-40 max-w-60 rounded-md object-cover"
            />
          ) : (
            <Chip
              size="md"
              variant="outline"
              radius="md"
              icon={<Paperclip aria-hidden />}
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
