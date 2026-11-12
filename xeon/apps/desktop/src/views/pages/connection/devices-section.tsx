import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, Skeleton } from "@caustic/react";
import { Monitor, Smartphone } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { deviceRowOf, serverModeOf, sortDevices } from "../../../app/remote/remote-model.ts";
import type { RevokeTarget } from "../../../app/remote/remote-types.ts";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import { relativeAgeOf } from "../shared/relative-age.ts";
import { FORM_CONTROL_SIZE, RowNote, SettingSection } from "../settings/settings-section.tsx";
import type { SectionContext } from "./connection-sections.ts";

// "등록된 기기"(시안 §6.5). 줄 = 아이콘 16(휴대폰·브라우저 / 데스크톱) · 이름 13/500 · 오른쪽 곁 정보 12 tertiary(마지막으로 본 때 · 주소 mono)
// · [끊기] ghost sm. 머리 끝 [모두 끊기](2대 이상). 끊기는 확인 대화 상자를 거친다. 빈 상태 한 줄, 읽기 실패는 RowNote + 다시 읽기.
// 다른 기기 접속이 꺼져 있으면(브라우저 화면이 아닐 때) 구역을 그리지 않는다: 붙을 수 있는 기기가 없고 켜기 줄이 바로 위에 있다.
// "이 기기" 표시는 하지 않는다: 브라우저 화면이 자기 기기 id를 알 길이 아직 없다.

/** 지금 고른 끊기 대상 */
export type PendingRevoke =
  | { readonly kind: "one"; readonly id: string; readonly name: string }
  | { readonly kind: "all"; readonly count: number };

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export function DevicesSection(props: SectionContext): ReactNode {
  const { remote } = props;
  if (remote === null) return null;
  const status = remote.state.status.kind === "ready" ? remote.state.status.value : null;
  const enabled = serverModeOf(status, props.state.service.kind === "running") === "service+remote";
  if (!enabled && !props.web) return null;
  return <DevicesView remote={remote} nowMs={props.nowMs} />;
}

export function DevicesView(props: {
  readonly remote: RemoteScreen;
  readonly nowMs: number;
  /** 대화 상자를 제자리에 그린다(시험용) */
  readonly inline?: boolean;
  /** 처음 열려 있는 끊기 확인(시험용) */
  readonly initialPending?: PendingRevoke | null;
}): ReactNode {
  const { remote, nowMs } = props;
  const [pending, setPending] = useState<PendingRevoke | null>(props.initialPending ?? null);
  const devices = remote.state.devices;
  const busy = remote.state.busy !== "none";
  const ready = devices.kind === "ready" ? sortDevices(devices.value) : null;
  const revokeFailed = remote.state.notice?.kind === "revokeFailed";
  return (
    <SettingSection
      title={t("desktop.connection.devices.title")}
      end={
        ready !== null && ready.length >= 2 ? (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPending({ kind: "all", count: ready.length });
            }}
          >
            {t("desktop.connection.devices.revokeAll")}
          </Button>
        ) : undefined
      }
    >
      {revokeFailed ? (
        <div data-slot="devices-revoke-failed">
          <RowNote tone="danger">{t("desktop.connection.devices.revokeFailed")}</RowNote>
        </div>
      ) : null}
      {devices.kind === "loading" ? (
        <div role="status" data-slot="devices-loading" className="grid gap-2">
          <span className="sr-only">{t("desktop.connection.devices.loading")}</span>
          <Skeleton width="60%" height={14} />
          <Skeleton width="45%" height={14} />
        </div>
      ) : null}
      {devices.kind === "failed" ? (
        <div data-slot="devices-failed">
          <RowNote
            tone="danger"
            actions={
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  run(remote.actions.reloadDevices());
                }}
              >
                {t("desktop.connection.devices.reload")}
              </Button>
            }
          >
            {t("desktop.connection.devices.loadFailed")}
          </RowNote>
        </div>
      ) : null}
      {ready !== null && ready.length === 0 ? (
        <p data-slot="devices-empty" className="m-0 text-ui text-text-secondary">
          {t("desktop.connection.devices.empty")}
        </p>
      ) : null}
      {(ready ?? []).map((device) => {
        const row = deviceRowOf(device, nowMs);
        const seen =
          row.lastSeenAt === null
            ? t("desktop.connection.devices.never")
            : (() => {
                const age = relativeAgeOf(row.lastSeenAt, nowMs);
                return t(age.id, age.args);
              })();
        const Icon = row.kind === "web" ? Smartphone : Monitor;
        return (
          <div
            key={row.id}
            data-slot="device-row"
            data-layout="inline"
            data-kind={row.kind}
            className="flex min-h-11 min-w-0 items-center gap-3 px-4 py-2 transition-colors hover:bg-neutral-hover"
          >
            <Icon
              aria-label={
                row.kind === "web"
                  ? t("desktop.connection.devices.kindWeb")
                  : t("desktop.connection.devices.kindDesktop")
              }
              className="size-icon-md flex-none text-text-tertiary"
            />
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
              {row.name}
            </span>
            <span className="flex flex-none items-center gap-1.5 text-ui-sm text-text-tertiary">
              <span>{seen}</span>
              {row.address === null ? null : (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono text-mono-sm">{row.address}</span>
                </>
              )}
            </span>
            <Button
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPending({ kind: "one", id: row.id, name: row.name });
              }}
            >
              {t("desktop.connection.devices.revoke")}
            </Button>
          </div>
        );
      })}
      {pending === null ? null : (
        <RevokeDialog
          pending={pending}
          inline={props.inline === true}
          onCancel={() => {
            setPending(null);
          }}
          onConfirm={(target) => {
            setPending(null);
            run(remote.actions.revoke(target));
          }}
        />
      )}
    </SettingSection>
  );
}

/** 끊기 확인의 본문 한 줄 */
export function RevokeDialogBody(props: { readonly pending: PendingRevoke }): ReactNode {
  const { pending } = props;
  return (
    <p data-slot="devices-revoke-body" className="m-0 text-ui text-text-secondary">
      {pending.kind === "one"
        ? t("desktop.connection.devices.revokeOneBody", { name: pending.name })
        : t("desktop.connection.devices.revokeAllBody", { count: pending.count })}
    </p>
  );
}

function RevokeDialog(props: {
  readonly pending: PendingRevoke;
  readonly inline: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (target: RevokeTarget) => void;
}): ReactNode {
  const { pending } = props;
  const target: RevokeTarget = pending.kind === "one" ? { id: pending.id } : { all: true };
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      inline={props.inline}
      open
      onOpenChange={(next) => {
        if (!next) props.onCancel();
      }}
      title={
        pending.kind === "one"
          ? t("desktop.connection.devices.revokeOneTitle")
          : t("desktop.connection.devices.revokeAllTitle")
      }
      footer={
        <>
          <Button variant="outline" size={FORM_CONTROL_SIZE} onClick={props.onCancel}>
            {t("desktop.connection.devices.cancel")}
          </Button>
          <Button
            variant="solid"
            size={FORM_CONTROL_SIZE}
            onClick={() => {
              props.onConfirm(target);
            }}
          >
            {pending.kind === "one"
              ? t("desktop.connection.devices.revoke")
              : t("desktop.connection.devices.revokeAll")}
          </Button>
        </>
      }
    >
      <RevokeDialogBody pending={pending} />
    </Dialog>
  );
}
