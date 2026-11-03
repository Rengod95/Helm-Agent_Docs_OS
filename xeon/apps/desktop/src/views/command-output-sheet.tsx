import { t } from "@fresnel/client/i18n";
import { Button, Sheet, toast } from "@caustic/react";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useCommandOutput } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { copyTextOf, hasResultOf, resultJsonOf } from "./command-output-model.ts";

// 명령 결과 시트(O-03, spec §6.20). `command.run`이 `done`을 주면 오른쪽 시트에 메시지와 결과를 보인다.
// 결과 JSON은 접혀 있고 "펼치기"로 연다. 닫으면 `dismissCommandOutput`이 결과를 지운다.

export function CommandOutputSheet(): ReactNode {
  const output = useCommandOutput();
  const commands = useCommands();
  const [expanded, setExpanded] = useState(false);
  return (
    <Sheet
      side="right"
      open={output !== null}
      onOpenChange={(open) => {
        if (!open) {
          setExpanded(false);
          commands.dismissCommandOutput();
        }
      }}
      title={output === null ? "" : t("desktop.commandOutput.title", { name: output.name })}
      description={output?.message ?? undefined}
      footer={
        output === null ? null : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                detach(
                  copyOutput((text) => commands.copyText(text), copyTextOf(output)),
                  rethrow,
                );
              }}
            >
              {t("desktop.commandOutput.copy")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setExpanded(false);
                commands.dismissCommandOutput();
              }}
            >
              {t("desktop.commandOutput.close")}
            </Button>
          </>
        )
      }
    >
      {output === null || !hasResultOf(output.result) ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            {t(
              expanded
                ? "desktop.commandOutput.resultCollapse"
                : "desktop.commandOutput.resultExpand",
            )}
          </Button>
          {expanded ? (
            <pre
              aria-label={t("desktop.commandOutput.result")}
              className="max-h-96 overflow-auto rounded-md bg-control-raised p-3 font-mono text-caption whitespace-pre text-text-primary"
            >
              {resultJsonOf(output.result)}
            </pre>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/** 복사 결과를 알린다. 실패해도 화면은 그대로 둔다 */
async function copyOutput(copy: (text: string) => Promise<boolean>, text: string): Promise<void> {
  const copied = await copy(text);
  toast(
    copied
      ? { tone: "success", title: t("desktop.commandOutput.copied") }
      : { tone: "danger", title: t("desktop.commandOutput.copyFailed") },
  );
}
