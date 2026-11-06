import { t } from "@fresnel/client/i18n";
import { Alert, Button, Chip, Progress } from "@caustic/react";
import { Paperclip } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { failureText, formatBytes, type AttachChip } from "./attachment-model.ts";

// 입력 위의 첨부 칩 줄(U-03). 올리는 중은 칩 안의 Progress, 실패는 danger Alert와 "다시 시도"·"빼기"다.

export function AttachmentRow(props: {
  readonly chips: readonly AttachChip[];
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): ReactNode {
  if (props.chips.length === 0) return null;
  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-1.5 p-0"
      aria-label={t("desktop.composer.attach.list.label")}
    >
      {props.chips.map((chip) => (
        <li key={chip.id}>
          {chip.status === "failed" && chip.failure !== null ? (
            <Alert tone="danger" size="sm" radius="md" role="alert">
              <span>
                {t("desktop.composer.attach.failed", {
                  name: chip.name,
                  reason: failureText(chip.failure),
                })}
              </span>{" "}
              {chip.failure.kind === "tooLarge" ? null : (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      props.onRetry(chip.id);
                    }}
                  >
                    {t("desktop.composer.attach.retry")}
                  </Button>{" "}
                </>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  props.onRemove(chip.id);
                }}
              >
                {t("desktop.composer.attach.remove")}
              </Button>
            </Alert>
          ) : (
            <Chip
              size="md"
              variant="outline"
              radius="md"
              icon={<Paperclip aria-hidden />}
              removeLabel={t("desktop.composer.attach.remove")}
              onRemove={() => {
                props.onRemove(chip.id);
              }}
            >
              {chip.status === "uploading" ? (
                <>
                  {t("desktop.composer.attach.uploading", { name: chip.name })}
                  <Progress indeterminate size="xs" label={chip.name} />
                </>
              ) : chip.size === null ? (
                chip.name
              ) : (
                `${chip.name} (${formatBytes(chip.size)})`
              )}
            </Chip>
          )}
        </li>
      ))}
    </ul>
  );
}
