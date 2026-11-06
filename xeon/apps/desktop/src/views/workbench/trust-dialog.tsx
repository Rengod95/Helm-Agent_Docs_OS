// O-10 확장 신뢰 확인: 사용자·프로젝트 위치의 확장을 켜기 전에 등급과 훅 수를 보인다. 기본 초점은 "취소"다.
// "처음 켜는" 기록이 없어서 지금은 꺼져 있던 user·project 확장을 켤 때마다 묻는다 [제안: 기본값].
import { t, type MessageId } from "@fresnel/client/i18n";
import { extNameOf } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Button, Dialog, DialogClose, ListDescription, ListDescriptionRow } from "@caustic/react";
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";

/** 설명 목록 자리: 줄 머리 8rem, 바깥 칸 없이 */
const LD = "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

const ORIGIN_TEXT: Readonly<Record<NonNullable<ExtListEntry["origin"]>, MessageId>> = {
  builtin: "desktop.workbench.origin.builtin",
  managed: "desktop.workbench.origin.managed",
  user: "desktop.workbench.origin.user",
  project: "desktop.workbench.origin.project",
};

export const originText = (origin: ExtListEntry["origin"]): string =>
  origin === undefined ? "-" : t(ORIGIN_TEXT[origin]);

/** 켜기 전에 확인이 필요한 확장인가 */
export function needsTrustConfirm(entry: ExtListEntry): boolean {
  return entry.origin === "user" || entry.origin === "project";
}

/**
 * 그룹이 하는 일을 목록 위에 본문 글로 보인다. 지금은 Helm만 있다. 비용 줄도 정보 아이콘 뒤에 숨기지 않고 글로 그대로 둔다.
 */
export function GroupAbout(props: { readonly name: string }): ReactNode {
  if (props.name !== "helm") return null;
  return (
    <div className="grid gap-1">
      <p className="m-0 text-ui-strong text-text-primary">
        {t("desktop.workbench.trust.about.helm.heading")}
      </p>
      <div className="grid gap-0.5 text-ui-dense text-text-secondary">
        <p className="m-0">{t("desktop.workbench.trust.about.helm.explore")}</p>
        <p className="m-0">{t("desktop.workbench.trust.about.helm.inject")}</p>
        <p className="m-0">{t("desktop.workbench.trust.about.helm.cost")}</p>
      </div>
    </div>
  );
}

/** 켜고 끄기 요청이 가는 길: 신뢰 확인, 끄기 확인, 바로. 확장이 목록에 없으면 바로다 */
export function toggleRouteOf(
  entry: ExtListEntry | undefined,
  target: boolean,
): "trust" | "off-confirm" | "direct" {
  if (entry === undefined) return "direct";
  if (target) return needsTrustConfirm(entry) ? "trust" : "direct";
  return entry.isGroup ? "off-confirm" : "direct";
}

export function TrustDialog(props: {
  readonly entry: ExtListEntry | null;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { entry } = props;
  return (
    <Dialog
      kind="alert"
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={entry === null ? "" : t("desktop.workbench.trust.heading", { name: extNameOf(entry) })}
      description={entry === null ? "" : t("desktop.workbench.trust.lead")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          {/* 켜기는 확인이라 중립 면으로 두고, 닫기는 Close가 맡는다(DialogAction은 위험 톤이라 쓰지 않는다) */}
          <DialogClose asChild>
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                if (entry !== null) props.onConfirm(entry.name);
              }}
            >
              {t("desktop.workbench.trust.confirm")}
            </Button>
          </DialogClose>
        </>
      }
    >
      {entry === null ? null : (
        <>
          <GroupAbout name={entry.name} />
          <ListDescription variant="ghost" size="xs" className={LD}>
            <ListDescriptionRow term={t("desktop.workbench.detail.origin")}>
              {originText(entry.origin)}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.workbench.detail.grade")}>
              {t("desktop.workbench.detail.grade.value", {
                requested: entry.requestedGrade,
                effective: entry.effectiveGrade,
              })}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.workbench.detail.tab.hooks")}>
              {t("desktop.install.parts.hooks", { count: entry.hookCount })}
              <InfoTip text={t("desktop.install.info.parts")} />
            </ListDescriptionRow>
          </ListDescription>
        </>
      )}
    </Dialog>
  );
}

/**
 * 그룹을 끌 때의 확인(끄기). 진행 중인 탐구나 작업은 멈추고 쌓인 기록은 남는다고 말한다. 기본 초점은 "취소"다.
 * 확인하면 `onConfirm`으로 끈다. 일반 확장은 이 대화 상자 없이 바로 끈다.
 */
export function OffConfirmDialog(props: {
  readonly entry: ExtListEntry | null;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { entry } = props;
  return (
    <Dialog
      kind="alert"
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={entry === null ? "" : t("desktop.workbench.off.heading", { name: extNameOf(entry) })}
      description={entry === null ? "" : t("desktop.workbench.off.lead")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          {/* 끄기도 중립 면이다. 기록은 지우지 않으므로 위험 톤을 쓰지 않는다 */}
          <DialogClose asChild>
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                if (entry !== null) props.onConfirm(entry.name);
              }}
            >
              {t("desktop.workbench.off.confirm")}
            </Button>
          </DialogClose>
        </>
      }
    />
  );
}
