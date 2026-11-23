// 지우기 확인(위험 확인). 확인하면 지우기 요청(`plugin.requestRemove`)이 검토함에 올라간다. 본문은 그 사실을 적는다.
// 영향 묶음은 두 줄이다: 이 확장을 쓰는 프로필(`profile.list`의 plugins)과 플러그인 뷰(화면 항목 목록, 상태와 무관하게 이 확장의 것).
// 저장 데이터는 엔진에 목록도 지우기도 없어 이 상자는 다루지 않는다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ExtUiEntry, Profile } from "@fresnel/contracts/wire";
import {
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import type { CommandError, DependencyRefusalView } from "../commands.ts";
import { DependencyRefusal } from "../craft/deps/dependency-refusal.tsx";
import {
  placementTextOf,
  pluginViewsOf,
  profilesUsingOf,
  REMOVE_BODY_TEXT,
  type PluginViewRow,
} from "./remove-model.ts";

/** 프로필 목록을 읽는 함수(`profile.list`). 아무것도 바꾸지 않는다 */
type LoadProfiles = () => Promise<Result<readonly Profile[], CommandError>>;

/** 이 확장을 쓰는 프로필 칸의 상태. 읽지 못하면 실패 한 줄을 보인다 */
export type ProfilesView =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly titles: readonly string[] };

/** 지우기 상자의 영향 묶음 값 */
export interface RemoveImpact {
  readonly profiles: ProfilesView;
  /** 플러그인 뷰 목록. null이면 화면 항목을 아직 확인하지 못한 것이다(연결 없음, 읽는 중) */
  readonly views: readonly PluginViewRow[] | null;
}

interface RemoveDialogProps {
  /** 지우려는 확장의 이름. null이면 닫힌다 */
  readonly name: string | null;
  readonly busy: boolean;
  /** 꼭 기대는 쪽이 있어 엔진이 거절했으면 그 목록(AGE-33). 상자를 열어 두고 목록을 보인다 */
  readonly refusal?: DependencyRefusalView | null;
  readonly loadProfiles: LoadProfiles;
  /** 플러그인 화면 항목 전부(`usePluginUiState().entries`). 이 확장의 것만 골라 보인다. 상태가 `ready`가 아니면 null이다 */
  readonly pluginEntries: readonly ExtUiEntry[] | null;
  readonly onConfirm: (name: string) => void;
  readonly onCancel: () => void;
}

/** 지우기 단추를 끄나: 지우는 중이거나, 엔진이 의존 때문에 거절한 까닭이 상자에 보이는 동안(다시 눌러도 같은 거절이다) */
export function removeConfirmDisabled(
  busy: boolean,
  refusal: DependencyRefusalView | null,
): boolean {
  return busy || refusal !== null;
}

export function RemoveDialog(props: RemoveDialogProps): ReactNode {
  // 상자마다 새로 읽는다. 이름을 키로 두어 다른 확장의 프로필 칸이 잠깐도 보이지 않게 한다
  return <RemoveDialogOf key={props.name ?? ""} {...props} />;
}

function RemoveDialogOf(props: RemoveDialogProps): ReactNode {
  const { name, loadProfiles } = props;
  const [profiles, setProfiles] = useState<ProfilesView>({ kind: "loading" });

  // 프로필 목록은 상자를 열 때 한 번 읽는다. 읽지 못하면 그 칸만 실패 한 줄이다
  useEffect(() => {
    if (name === null) return;
    detach(
      loadProfiles().then((got) => {
        setProfiles(
          got.ok ? { kind: "ready", titles: profilesUsingOf(got.value, name) } : { kind: "failed" },
        );
        return undefined;
      }),
      rethrow,
    );
  }, [name, loadProfiles]);

  const impact: RemoveImpact = {
    profiles,
    views:
      name === null || props.pluginEntries === null
        ? null
        : pluginViewsOf(props.pluginEntries, name),
  };
  return (
    <Dialog
      kind="alert"
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={name === null ? "" : t("desktop.workbench.remove.heading", { name })}
      description={t(REMOVE_BODY_TEXT)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction
            disabled={removeConfirmDisabled(props.busy, props.refusal ?? null)}
            onClick={(event) => {
              // 확인 단추가 닫기를 먼저 하지 않는다: 보내는 동안 상자를 두고, 끝나면 부른 쪽이 닫는다
              event.preventDefault();
              if (name !== null) props.onConfirm(name);
            }}
          >
            {t("desktop.workbench.remove.confirm")}
          </DialogAction>
        </>
      }
    >
      <RemoveDialogBody impact={impact} refusal={props.refusal ?? null} />
    </Dialog>
  );
}

/** 영향 묶음의 두 줄: 이 확장을 쓰는 프로필, 플러그인 뷰. 값이 없으면 "없어요", 읽지 못하면 실패 한 줄 */
function ImpactRows(props: { readonly impact: RemoveImpact }): ReactNode {
  const { profiles, views } = props.impact;
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label={t("desktop.workbench.remove.impact.label")}
      className="rounded-none [--cs-size-list-term:9rem] [&_[data-slot=list-description-row]]:px-0"
    >
      <ListDescriptionRow term={t("desktop.workbench.remove.impact.profiles")}>
        {profiles.kind === "loading" ? (
          <span role="status" className="text-text-tertiary">
            {t("desktop.workbench.remove.impact.loading")}
          </span>
        ) : profiles.kind === "failed" ? (
          <span className="text-text-tertiary">
            {t("desktop.workbench.remove.impact.profilesFailed")}
          </span>
        ) : profiles.titles.length === 0 ? (
          <span className="text-text-tertiary">{t("desktop.workbench.remove.impact.none")}</span>
        ) : (
          profiles.titles.join(", ")
        )}
      </ListDescriptionRow>
      <ListDescriptionRow term={t("desktop.workbench.remove.impact.views")}>
        {views === null ? (
          <span className="text-text-tertiary">
            {t("desktop.workbench.remove.impact.viewsUnknown")}
          </span>
        ) : views.length === 0 ? (
          <span className="text-text-tertiary">{t("desktop.workbench.remove.impact.none")}</span>
        ) : (
          <span className="grid">
            {views.map((view) => (
              <span key={view.id} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0">{view.title}</span>{" "}
                <span className="flex-none text-text-tertiary">
                  {t(placementTextOf(view.placement))}
                </span>
              </span>
            ))}
          </span>
        )}
      </ListDescriptionRow>
    </ListDescription>
  );
}

/**
 * 상자 본문: 영향 묶음과, 엔진이 거절했을 때의 의존 목록. 상자는 포털이라 서버 렌더 시험은 본문(`RemoveDialogBody`)을 본다.
 */
export function RemoveDialogBody(props: {
  readonly impact: RemoveImpact;
  readonly refusal?: DependencyRefusalView | null;
}): ReactNode {
  return (
    <div className="grid gap-3">
      <ImpactRows impact={props.impact} />
      {props.refusal === undefined || props.refusal === null ? null : (
        <div role="alert">
          <DependencyRefusal refusal={props.refusal} />
        </div>
      )}
    </div>
  );
}
