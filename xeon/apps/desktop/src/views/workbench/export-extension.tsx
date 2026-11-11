// 확장 상세의 "내보내기": 설치한 확장을 `ext.package`로 묶어 폴더 하나로 만든다. OS 저장 창은 두지 않고 결과 경로를 보이고 복사 단추를 둔다.
// 상세 머리가 이 부품 하나만 그린다(`removableOf`가 거짓인 내장 확장에는 그리지 않는다).
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Button, Dialog } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { exportFailureDetail, exportOutOf } from "./export-model.ts";

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | {
      readonly kind: "done";
      readonly path: string;
      readonly files: number;
      readonly sha256: string;
    }
  | { readonly kind: "failed"; readonly detail: string | null };

export function ExportExtension(props: { readonly entry: ExtListEntry }): ReactNode {
  const { entry } = props;
  const commands = useCommands();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const start = async (): Promise<void> => {
    const out = exportOutOf(entry, new Date());
    if (out === null) {
      setPhase({ kind: "failed", detail: null });
      return;
    }
    setPhase({ kind: "working" });
    const packed = await commands.workbench.packDir(entry.location, out);
    setPhase(
      packed.ok
        ? {
            kind: "done",
            path: packed.value.path,
            files: packed.value.files.length,
            sha256: packed.value.sha256,
          }
        : { kind: "failed", detail: exportFailureDetail(packed.error) },
    );
  };
  const copy = async (path: string): Promise<void> => {
    setCopied(await commands.copyText(path));
  };
  const close = (): void => {
    setOpen(false);
    setPhase({ kind: "idle" });
    setCopied(false);
  };

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setOpen(true);
          detach(start(), rethrow);
        }}
      >
        {t("desktop.workbench.export.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && phase.kind !== "working") close();
        }}
        size="md"
        title={t("desktop.workbench.export.title", { name: entry.displayName })}
        description={t("desktop.workbench.export.subtitle")}
        footer={
          <>
            {phase.kind === "done" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  detach(copy(phase.path), rethrow);
                }}
              >
                {copied ? t("desktop.workbench.export.copied") : t("desktop.workbench.export.copy")}
              </Button>
            )}
            <Button size="sm" disabled={phase.kind === "working"} onClick={close}>
              {t("desktop.install.close")}
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          {phase.kind === "working" && (
            <span className="text-ui text-text-secondary">
              {t("desktop.workbench.export.working")}
            </span>
          )}
          {phase.kind === "done" && (
            <>
              <span className="text-ui-dense text-text-secondary">
                {t("desktop.workbench.export.done", { count: phase.files })}
              </span>
              <span
                aria-label={t("desktop.workbench.export.path")}
                className="break-all font-mono text-mono-sm text-text-primary"
              >
                {phase.path}
              </span>
              <span className="break-all font-mono text-mono-sm text-text-tertiary">
                {`sha256 ${phase.sha256}`}
              </span>
            </>
          )}
          {phase.kind === "failed" && (
            <Alert tone="danger">
              {t("desktop.workbench.export.failed")}
              {phase.detail === null ? null : <span className="font-mono"> {phase.detail}</span>}
            </Alert>
          )}
        </div>
      </Dialog>
    </>
  );
}
