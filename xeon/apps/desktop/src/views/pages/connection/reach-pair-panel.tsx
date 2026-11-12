import { t } from "@fresnel/client/i18n";
import { Button, IconButton, Select, SelectOption } from "@caustic/react";
import { Copy } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import {
  isPairingExpired,
  pairingCodeDisplay,
  pairingRemainingLabel,
  pairingRemainingMs,
} from "../../../app/remote/remote-model.ts";
import type { PairingState } from "../../../app/remote/remote-state.ts";
import { QrCode } from "../shared/qr-code.tsx";
import { groupedValue } from "../shared/trust-box.tsx";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote } from "../settings/settings-section.tsx";
import { remoteErrorTextOf, SCOPE_TEXT, type PanelAddress } from "./reach-model.ts";

// 연결 패널(시안 §6.4). 두 열: 왼쪽 QR 168(흰 여백 8을 둘러 184), 오른쪽 열은 위에서부터 안내 13/500 · 주소 mono 12 + 닿는 범위 12 ·
// 연결 코드 mono 16 · 남은 시간 12 + [새 코드] · 인증서 확인 값(접힘). 코드가 없으면 QR 자리에 점선 사각과 [기기 연결] solid.
// 만료되면 QR을 흐리게(opacity .2) 두고 [새 코드]. 주소가 여럿이면 Select(medium)로 고른다. QR은 테마와 무관하게 흰 바탕이다.

/** 확인 값 미리보기에 보이는 4자 묶음 수 */
const TRUST_PREVIEW_GROUPS = 2;

export interface PairPanelProps {
  readonly addresses: readonly PanelAddress[];
  readonly pairing: PairingState;
  readonly nowMs: number;
  /** 쓰기 동작이 도는 중(코드 발급 잠금) */
  readonly busy: boolean;
  /** 자체 서명 인증서의 확인 값(`AB:12:…`). 보이지 않을 방식이면 null */
  readonly fingerprint: string | null;
  readonly onIssue: () => void;
  readonly copy: (text: string) => void;
}

export function PairPanel(props: PairPanelProps): ReactNode {
  const { addresses, pairing, nowMs, busy } = props;
  const [picked, setPicked] = useState(0);
  const address = addresses[picked] ?? addresses[0] ?? null;
  const code = pairing.kind === "issued" ? pairing.code : null;
  const expired = code !== null && isPairingExpired(code, nowMs);
  const qrValue = address?.link ?? null;
  return (
    <div data-slot="reach-pair-panel" className="@container grid min-w-0 gap-3">
      {/* 카드가 좁으면(휴대폰 브라우저) QR 아래로 글을 쌓는다 */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 @[30rem]:grid-cols-[auto_minmax(0,1fr)] @[30rem]:gap-6">
        {code !== null && qrValue !== null ? (
          <div
            data-slot="reach-qr"
            data-expired={expired ? "true" : "false"}
            className={`rounded-lg bg-[#fff] p-2 ${expired ? "opacity-20" : ""}`}
          >
            <QrCode value={qrValue} size={168} label={t("desktop.connection.reach.pair.qrLabel")} />
          </div>
        ) : (
          <div
            data-slot="reach-qr-empty"
            className="grid size-46 place-items-center rounded-lg border border-dashed border-border-default"
          >
            {code === null ? (
              <Button
                size={FORM_CONTROL_SIZE}
                variant="solid"
                loading={pairing.kind === "issuing"}
                disabled={busy || pairing.kind === "issuing"}
                onClick={props.onIssue}
              >
                {t("desktop.connection.reach.pair.issue")}
              </Button>
            ) : (
              <p className="m-0 px-4 text-center text-ui-sm text-text-tertiary">
                {t("desktop.connection.reach.pair.noQr")}
              </p>
            )}
          </div>
        )}
        <div className="grid min-w-0 content-start gap-2">
          <p className="m-0 text-ui font-medium text-text-primary">
            {t("desktop.connection.reach.pair.scan")}
          </p>
          <AddressLine addresses={addresses} picked={picked} onPick={setPicked} copy={props.copy} />
          {code === null ? (
            <p className="m-0 text-ui text-text-tertiary">
              {t("desktop.connection.reach.pair.noCode")}
            </p>
          ) : (
            <>
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="text-ui-sm text-text-tertiary">
                  {t("desktop.connection.reach.pair.codeLabel")}
                </span>
                <span
                  data-slot="reach-code"
                  className={`font-mono text-title-2 tabular-nums ${expired ? "text-text-tertiary" : "text-text-primary"}`}
                >
                  {pairingCodeDisplay(code.code)}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary">
                <span data-slot="reach-remaining" className="tabular-nums">
                  {expired
                    ? t("desktop.connection.reach.pair.expired")
                    : t("desktop.connection.reach.pair.remaining", {
                        time: pairingRemainingLabel(pairingRemainingMs(code, nowMs)),
                      })}
                </span>
                <span aria-hidden>·</span>
                <Button size="xs" variant="ghost" disabled={busy} onClick={props.onIssue}>
                  {t("desktop.connection.reach.pair.newCode")}
                </Button>
              </div>
            </>
          )}
          {props.fingerprint === null ? null : (
            <TrustValue value={props.fingerprint} copy={props.copy} />
          )}
        </div>
      </div>
      {pairing.kind === "failed" ? (
        <RowNote tone={pairing.error.kind === "remote-off" ? "warning" : "danger"}>
          {t(remoteErrorTextOf(pairing.error))}
        </RowNote>
      ) : null}
    </div>
  );
}

/** 주소 한 줄. 여럿이면 Select로 고르고, 복사는 코드가 든 링크(없으면 주소)를 쓴다 */
function AddressLine(props: {
  readonly addresses: readonly PanelAddress[];
  readonly picked: number;
  readonly onPick: (index: number) => void;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { addresses, picked } = props;
  const address = addresses[picked] ?? addresses[0];
  if (address === undefined) {
    return (
      <p data-slot="reach-address-none" className="m-0 text-ui text-text-tertiary">
        {t("desktop.connection.reach.pair.noAddress")}
      </p>
    );
  }
  return (
    <div data-slot="reach-address" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {addresses.length > 1 ? (
        <Select
          size={FORM_CONTROL_SIZE}
          className={FIELD_WIDTH.medium}
          aria-label={t("desktop.connection.reach.pair.addressLabel")}
          value={String(picked)}
          onValueChange={(next) => {
            const index = Number(next);
            if (Number.isInteger(index) && index >= 0 && index < addresses.length) {
              props.onPick(index);
            }
          }}
        >
          {addresses.map((item, index) => (
            <SelectOption key={item.base} value={String(index)}>
              {item.base}
            </SelectOption>
          ))}
        </Select>
      ) : (
        <span className="min-w-0 break-all font-mono text-mono-sm text-text-primary">
          {address.base}
        </span>
      )}
      <span className="text-ui-sm text-text-tertiary">{t(SCOPE_TEXT[address.scope])}</span>
      <IconButton
        size={addresses.length > 1 ? FORM_CONTROL_SIZE : "xs"}
        variant="ghost"
        label={
          address.link === null
            ? t("desktop.connection.reach.pair.copyAddress")
            : t("desktop.connection.reach.pair.copyLink")
        }
        onClick={() => {
          props.copy(address.link ?? address.base);
        }}
      >
        <Copy />
      </IconButton>
    </div>
  );
}

/** 인증서 확인 값. 앞 두 묶음만 보이고 "보기"로 펼친다. 복사는 전체 값이다 */
function TrustValue(props: {
  readonly value: string;
  readonly copy: (text: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const grouped = groupedValue(props.value);
  const preview = `${grouped.split(" ").slice(0, TRUST_PREVIEW_GROUPS).join(" ")} …`;
  return (
    <div data-slot="reach-trust" className="grid min-w-0 gap-1 text-ui-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span className="text-text-tertiary">{t("desktop.connection.reach.pair.trustLabel")}</span>
        {open ? null : (
          <span className="font-mono text-mono-sm text-text-secondary">{preview}</span>
        )}
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
        >
          {open
            ? t("desktop.connection.reach.pair.trustHide")
            : t("desktop.connection.reach.pair.trustShow")}
        </Button>
        {open ? (
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.connection.copy")}
            onClick={() => {
              props.copy(props.value);
            }}
          >
            <Copy />
          </IconButton>
        ) : null}
      </div>
      {open ? (
        <code className="font-mono text-mono-sm break-words text-text-primary">{grouped}</code>
      ) : null}
    </div>
  );
}
