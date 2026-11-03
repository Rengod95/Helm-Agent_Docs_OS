// 개요와 확장 화면이 같이 쓰는 부품: 목록 상태 띠(읽는 중·오류·오프라인·자동 꺼짐)와 켜기 요청 + O-10. 찾기 막대와 개수 줄은 확장 화면이 쓴다.
import { t } from "@fresnel/client/i18n";
import { countsOf } from "@fresnel/client/workbench";
import { Alert, Input, Skeleton } from "@caustic/react";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { detachVoid, type WorkbenchController } from "./controller.ts";
import { needsTrustConfirm, TrustDialog } from "./trust-dialog.tsx";

/** 켜기 요청. 꺼져 있던 user·project 확장을 켜면 O-10을 먼저 보인다. `dialog`를 화면 어딘가에 그려야 한다 */
export function useToggleRequest(controller: WorkbenchController): {
  readonly request: (name: string, target: boolean) => void;
  readonly dialog: ReactNode;
} {
  const entries = useWorkbench((s) => s.entries);
  const [asking, setAsking] = useState<ExtListEntry | null>(null);
  return {
    request(name, target) {
      const entry = entries.find((e) => e.name === name);
      if (target && entry !== undefined && needsTrustConfirm(entry)) {
        setAsking(entry);
        return;
      }
      detachVoid(controller.toggle(name, target));
    },
    dialog: (
      <TrustDialog
        entry={asking}
        onCancel={() => {
          setAsking(null);
        }}
        onConfirm={(name) => {
          setAsking(null);
          detachVoid(controller.toggle(name, true));
        }}
      />
    ),
  };
}

export function CountsLine(): ReactNode {
  const counts = useWorkbench(countsOf);
  return (
    <p className="text-ui-sm text-text-tertiary">
      {t("desktop.workbench.counts", {
        total: counts.total,
        on: counts.on,
        auto: counts.autoDisabled,
      })}
    </p>
  );
}

export function SearchField(): ReactNode {
  const query = useWorkbench((s) => s.query);
  const actions = useWorkbenchActions();
  return (
    <Input
      size="sm"
      type="search"
      value={query}
      placeholder={t("desktop.workbench.search")}
      aria-label={t("desktop.workbench.search")}
      onValueChange={(value) => {
        actions.setQuery(value);
      }}
      containerClassName="w-60"
    />
  );
}

/** 목록이 아직 없거나 못 읽었을 때의 띠. 읽혔으면 null */
export function ListStatusBand(props: { readonly controller: WorkbenchController }): ReactNode {
  const list = useWorkbench((s) => s.list);
  const phase = useLinkPhase();
  if (phase !== "live" && list !== "ready") {
    return <Alert tone="warning">{t("desktop.workbench.offline")}</Alert>;
  }
  if (list === "loading" || list === "idle") {
    return (
      <div role="status" aria-label={t("desktop.workbench.loading")} className="grid gap-2 p-4">
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </div>
    );
  }
  if (list === "error") {
    return (
      <Alert
        tone="danger"
        actions={[
          {
            label: t("desktop.workbench.error.retry"),
            onClick: () => {
              detachVoid(props.controller.reload());
            },
          },
        ]}
      >
        {t("desktop.workbench.error.heading")}
      </Alert>
    );
  }
  return null;
}

/** 자동 꺼진 확장마다 한 줄 + "다시 켜기" */
export function AutoDisabledAlerts(props: { readonly controller: WorkbenchController }): ReactNode {
  const entries = useWorkbench((s) => s.entries);
  const broken = entries.filter((e) => e.autoDisabled);
  return broken.map((e) => (
    <Alert
      key={e.name}
      tone="danger"
      actions={[
        {
          label: t("desktop.workbench.reenable"),
          onClick: () => {
            detachVoid(props.controller.reenable(e.name));
          },
        },
      ]}
    >
      {t("desktop.workbench.autoDisabled", { name: e.displayName })}
    </Alert>
  ));
}
