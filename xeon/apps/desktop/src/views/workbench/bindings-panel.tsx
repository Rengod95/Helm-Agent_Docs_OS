// B-05 기능 연결 목록(`ext.bindings`): 기능 id마다 지금 바인딩된 공급자와 받는 확장. 받을 곳이 없는 기능은 위 경고에 id를 mono로 모은다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Alert, Button, Skeleton, Table, type TableColumn } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { bindingRowsOf, unmetCountOf, type BindingRowVM } from "./bindings-model.ts";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly rows: readonly BindingRowVM[] };

type BindingColumn = "capability" | "provider" | "consumers";

function columnOf(key: string): BindingColumn | undefined {
  return key === "capability" || key === "provider" || key === "consumers" ? key : undefined;
}

function providerText(row: BindingRowVM): string {
  return row.provider ?? t("desktop.workbench.bindings.noProvider");
}

function consumersText(row: BindingRowVM): string {
  const parts = [
    ...row.requires.map((id) => `${t("desktop.workbench.bindings.requires")} ${id}`),
    ...row.optional.map((id) => `${t("desktop.workbench.bindings.optional")} ${id}`),
  ];
  return parts.length === 0 ? "-" : parts.join(", ");
}

/** 표 아래 목록이 닫혀 있어도 미충족 경고는 보인다. 읽기에 실패하면 목록 상태는 그대로 두고 한 줄만 보인다 */
export function BindingsPanel(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let current = true;
    const read = (): void => {
      detach(
        commands.workbench.bindings().then((r) => {
          if (current) {
            setLoad(
              r.ok
                ? { kind: "ready", rows: bindingRowsOf(r.value.capabilities) }
                : { kind: "error" },
            );
          }
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    // 확장을 켜거나 끄거나 지우면 바인딩이 달라진다
    const off = commands.workbench.onChanged(read);
    return () => {
      current = false;
      off();
    };
  }, [commands, phase]);

  if (load.kind === "loading") return <Skeleton height={24} />;
  if (load.kind === "error") {
    return <Alert tone="danger">{t("desktop.workbench.bindings.failed")}</Alert>;
  }
  const { rows } = load;
  const unmet = rows.filter((row) => row.unmet);
  const columns: TableColumn[] = [
    { key: "capability", header: t("desktop.workbench.bindings.col.capability") },
    { key: "provider", header: t("desktop.workbench.bindings.col.provider") },
    { key: "consumers", header: t("desktop.workbench.bindings.col.consumers") },
  ];
  return (
    <section aria-label={t("desktop.workbench.bindings.title")} className="grid gap-2">
      {unmet.length > 0 && (
        <Alert tone="warning">
          {t("desktop.workbench.bindings.unmet", { count: unmetCountOf(rows) })}{" "}
          {unmet.map((row) => (
            <span key={row.capability} className="me-2 font-mono">
              {row.capability}
            </span>
          ))}
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <h2 className="m-0 min-w-0 truncate text-ui-dense font-semibold text-text-primary">
          {t("desktop.workbench.bindings.title")}
        </h2>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open
            ? t("desktop.workbench.bindings.hide")
            : t("desktop.workbench.bindings.show", { count: rows.length })}
        </Button>
      </div>
      {open && rows.length === 0 && (
        <p className="text-ui text-text-tertiary">{t("desktop.workbench.bindings.empty")}</p>
      )}
      {open && rows.length > 0 && (
        <Table
          columns={columns}
          rows={rows.map((row) => ({ id: row.capability }))}
          renderCell={(picked, column) => {
            const row = rows.find((r) => r.capability === picked.id);
            const name = columnOf(column.key);
            if (row === undefined || name === undefined) return null;
            if (name === "capability") return <span className="font-mono">{row.capability}</span>;
            return name === "provider" ? providerText(row) : consumersText(row);
          }}
        />
      )}
    </section>
  );
}
