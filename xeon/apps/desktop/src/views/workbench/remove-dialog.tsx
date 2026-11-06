// B-04 지우기 확인(위험 확인). 지우면 실행 중인 대화의 Turn에서도 이 플러그인이 바로 빠진다는 점을 본문에 적는다.
// 저장 데이터(`ext.removePreview`)는 상자를 열 때마다 읽는다. 읽지 못하면 한 줄과 "다시 확인"을, 비었으면 한 줄만 보인다.
// "저장된 데이터도 지우기" 칸은 표가 실제로 있을 때만 그리고 기본은 꺼짐이다. 저장 데이터를 지우다 실패하면 상자를 연 채 알린다.
// 영향 묶음은 두 줄이다: 이 확장을 쓰는 프로필(`profile.list`의 enable)과 플러그인 뷰(화면 항목 목록, 상태와 무관하게 이 확장의 것).
import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ExtRemovePreviewResult, ExtUiEntry, Profile } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
} from "@caustic/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CommandError } from "../commands.ts";
import {
  dropDataOf,
  placementTextOf,
  pluginViewsOf,
  profilesUsingOf,
  storageNoteOf,
  totalRowsOf,
  type PluginViewRow,
  type StoragePreview,
  type StorageTable,
} from "./remove-model.ts";

/** 저장 데이터 미리 보기를 읽는 함수. 명령 하나를 감싼 것이고 아무것도 바꾸지 않는다 */
type LoadPreview = (name: string) => Promise<Result<ExtRemovePreviewResult, CommandError>>;

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
  /** 저장 데이터까지 지우다 실패했나. 참이면 상자를 열어 두고 실패 줄을 보인다 */
  readonly dataFailed: boolean;
  readonly loadPreview: LoadPreview;
  readonly loadProfiles: LoadProfiles;
  /** 플러그인 화면 항목 전부(`usePluginUiState().entries`). 이 확장의 것만 골라 보인다 */
  /** 플러그인 화면 항목 전부(`usePluginUiState().entries`). 상태가 `ready`가 아니면 null이다 */
  readonly pluginEntries: readonly ExtUiEntry[] | null;
  /** 둘째 인자는 "저장된 데이터도 지우기" 칸의 값이다. 칸이 없으면 거짓이다 */
  readonly onConfirm: (name: string, dropData: boolean) => void;
  readonly onCancel: () => void;
}

export function RemoveDialog(props: RemoveDialogProps): ReactNode {
  // 상자마다 새로 읽는다. 이름을 키로 두어 다른 확장의 저장 데이터나 체크 상태가 잠깐도 보이지 않게 한다
  return <RemoveDialogOf key={props.name ?? ""} {...props} />;
}

function RemoveDialogOf(props: RemoveDialogProps): ReactNode {
  const { name, loadPreview, loadProfiles } = props;
  const [preview, setPreview] = useState<StoragePreview>({ kind: "loading" });
  const [profiles, setProfiles] = useState<ProfilesView>({ kind: "loading" });
  const [checked, setChecked] = useState(false);

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

  // 처음 열 때와 "다시 확인"에서 부른다. 이름은 상자마다 고정이라(키) 효과는 열 때 한 번 돈다
  const read = useCallback(
    (target: string): void => {
      detach(
        loadPreview(target).then((got) => {
          setPreview(got.ok ? { kind: "ready", tables: got.value.tables } : { kind: "failed" });
          return undefined;
        }),
        rethrow,
      );
    },
    [loadPreview],
  );

  useEffect(() => {
    if (name !== null) read(name);
  }, [name, read]);

  const tables: readonly StorageTable[] = preview.kind === "ready" ? preview.tables : [];
  const dropData = dropDataOf(checked, tables);
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
      description={t("desktop.workbench.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction
            disabled={props.busy}
            onClick={(event) => {
              // 확인 단추가 닫기를 먼저 하지 않는다: 지우는 동안 상자를 두고, 끝나면 부른 쪽이 닫는다
              event.preventDefault();
              if (name !== null) props.onConfirm(name, dropData);
            }}
          >
            {t("desktop.workbench.remove.confirm")}
          </DialogAction>
        </>
      }
    >
      <RemoveDialogBody
        preview={preview}
        impact={impact}
        checked={checked}
        busy={props.busy}
        dataFailed={props.dataFailed}
        onChecked={setChecked}
        onRetry={() => {
          if (name === null) return;
          setPreview({ kind: "loading" });
          read(name);
        }}
      />
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
              <span key={view.id}>
                {view.title}{" "}
                <span className="text-text-tertiary">
                  {`· ${t(placementTextOf(view.placement))}`}
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
 * 상자 본문: 영향 묶음, 저장 데이터 구역과 저장 데이터 지우기 실패 줄. 상자는 포털이라 서버 렌더 시험은 본문(`RemoveDialogBody`)을 본다.
 * 표가 있을 때만 칸을 그리고, 칸을 켜면 되돌릴 수 없다는 경고를 보인다
 */
export function RemoveDialogBody(props: {
  readonly preview: StoragePreview;
  readonly impact: RemoveImpact;
  readonly checked: boolean;
  readonly busy: boolean;
  readonly dataFailed: boolean;
  readonly onChecked: (checked: boolean) => void;
  readonly onRetry: () => void;
}): ReactNode {
  const { preview } = props;
  const note = storageNoteOf(preview);
  return (
    <div className="grid gap-3">
      <ImpactRows impact={props.impact} />
      <section aria-label={t("desktop.workbench.remove.storage.title")} className="grid gap-2">
        <h3 className="m-0 min-w-0 truncate text-ui-dense font-semibold text-text-primary">
          {t("desktop.workbench.remove.storage.title")}
        </h3>
        {note === null ? null : (
          <div className="flex items-center justify-between gap-2">
            <p
              role={preview.kind === "loading" ? "status" : undefined}
              className="m-0 text-ui-sm text-text-tertiary"
            >
              {t(note)}
            </p>
            {preview.kind === "failed" ? (
              <Button size="sm" variant="ghost" onClick={props.onRetry}>
                {t("desktop.workbench.remove.storage.retry")}
              </Button>
            ) : null}
          </div>
        )}
        {preview.kind === "loading" ? <Skeleton width="60%" height={12} /> : null}
        {preview.kind === "ready" && preview.tables.length > 0 ? (
          <StorageTables
            tables={preview.tables}
            checked={props.checked}
            busy={props.busy}
            onChecked={props.onChecked}
          />
        ) : null}
      </section>
      {props.dataFailed ? (
        <Alert tone="danger" layout="inline" size="sm" role="alert">
          {t("desktop.workbench.remove.dataFailed")}
        </Alert>
      ) : null}
    </div>
  );
}

/** 저장 테이블 목록(mono 이름과 행 수), 합계, "저장된 데이터도 지우기" 칸, 켜졌을 때의 경고 */
function StorageTables(props: {
  readonly tables: readonly StorageTable[];
  readonly checked: boolean;
  readonly busy: boolean;
  readonly onChecked: (checked: boolean) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      <ul className="m-0 grid list-none gap-1 p-0">
        {props.tables.map((table) => (
          <li key={table.name} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-mono-sm text-text-primary">
              {table.name}
            </span>
            <span className="shrink-0 text-ui-sm tabular-nums text-text-secondary">
              {t("desktop.workbench.remove.storage.rows", { count: table.rows })}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-ui-sm tabular-nums text-text-tertiary">
        {t("desktop.workbench.remove.storage.total", { count: totalRowsOf(props.tables) })}
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 text-ui-sm text-text-primary">
        <Checkbox
          size="sm"
          checked={props.checked}
          disabled={props.busy}
          onCheckedChange={(next) => {
            props.onChecked(next === true);
          }}
        />
        {t("desktop.workbench.remove.storage.drop")}
      </label>
      {props.checked ? (
        <Alert tone="warning" layout="inline" size="sm" role="status">
          {t("desktop.workbench.remove.storage.warning")}
        </Alert>
      ) : null}
    </div>
  );
}
