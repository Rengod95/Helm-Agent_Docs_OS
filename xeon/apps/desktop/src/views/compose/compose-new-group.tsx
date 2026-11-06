// 구성기의 "새 그룹" 시작 화면(§6.28.1, §6.29). 이름과 놓을 폴더, 시작점(`ext.kinds`)을 고르고 `ext.scaffold`로 뼈대를 만든 뒤 `ext.validate`로 검사한다.
// 만든 뒤에는 검사 다시 돌리기와 설치 묶음 만들기를 둔다. 디스크에 쓰므로 엔진에 연결되어 있을 때만 만들기를 켠다.
// 예약 이름 같은 거절은 호스트가 정하고, 화면은 그 문장을 그대로 보인다(`issue`). 부품은 `compose-new-group-form.tsx`와 `compose-new-group-result.tsx`에 있다.
import { t } from "@fresnel/client/i18n";
import {
  newGroupDraftOf,
  newGroupProblemOf,
  scaffoldInputOf,
  scaffoldInputWithComposition,
  startPointsOf,
  type NewGroupDraft,
  type TabLink,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { ExtensionKind, ScaffoldInput } from "@fresnel/contracts/services";
import { Button } from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useFolderPick } from "../folder-pick-context.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../folder-pick.ts";
import { useTabRead } from "../workbench/tab-read.ts";
import { MUTED, PlaceFields, StartPicker } from "./compose-new-group-form.tsx";
import {
  FailedNotice,
  MadeResult,
  type CreateResult,
  type DirCheck,
  type PackRead,
  type Working,
} from "./compose-new-group-result.tsx";

/** 새 그룹을 열 때 미리 채우는 값. 코드 보기의 "플러그인 빌더로 만들기"가 그룹 이름과 종류를 넘기고, 흐름 초안의 "새 그룹 만들기"는 구성 선언을 함께 넘긴다 */
export interface NewGroupPrefill {
  readonly name: string;
  readonly kind: ExtensionKind;
  /** 있으면 만들 때 `group.composition`으로 싣는다(플러그인 그룹일 때만) */
  readonly composition?: CompositionDecl;
}

/** 만들기 입력. 구성 선언이 있으면 그것을 싣고, 없으면 시작점만 본 입력이다 */
function createInputOf(
  draft: NewGroupDraft,
  composition: CompositionDecl | undefined,
): ScaffoldInput | null {
  return composition === undefined
    ? scaffoldInputOf(draft)
    : scaffoldInputWithComposition(draft, composition);
}

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

function draftOf(prefill: NewGroupPrefill | null): NewGroupDraft {
  const base = newGroupDraftOf();
  return prefill === null ? base : { ...base, name: prefill.name, kind: prefill.kind };
}

/** "새 그룹" 시작 화면. 쓰기는 `ext.scaffold`와 `ext.validate`, 묶음 만들기(`ext.package`)뿐이다 */
export function NewGroupScreen(props: {
  readonly link: TabLink;
  readonly prefill: NewGroupPrefill | null;
  readonly onBack: () => void;
}): ReactNode {
  const commands = useCommands();
  const folderPick = useFolderPick();
  const [draft, setDraft] = useState<NewGroupDraft>(() => draftOf(props.prefill));
  const [version, setVersion] = useState(0);
  const loadKinds = useCallback(() => commands.workbench.kinds(), [commands]);
  const kinds = useTabRead(`compose-kinds:${version}`, props.link, loadKinds);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const [pickFailed, setPickFailed] = useState(false);

  // 시작점은 읽힌 종류 가운데 고를 수 있는 것이어야 만들 수 있다
  const chosen =
    kinds.kind === "ready"
      ? startPointsOf(kinds.value).find((point) => point.id === draft.kind)
      : undefined;
  const ready =
    props.link === "live" && newGroupProblemOf(draft) === null && chosen?.selectable === true;

  // 입력이 바뀌면 지난 결과(만든 곳과 검사)는 더 이상 맞지 않으니 치운다
  const edit = (patch: Partial<NewGroupDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setResult(null);
  };

  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setPickFailed(true);
      return;
    }
    setPickFailed(false);
    if (picked.value !== undefined) edit({ parentDir: picked.value });
  };

  const create = async (): Promise<void> => {
    const input = createInputOf(draft, props.prefill?.composition);
    if (input === null) return;
    setWorking("create");
    setResult(null);
    const made = await commands.workbench.scaffold(input);
    if (!made.ok) {
      setWorking(null);
      setResult({
        kind: "failed",
        issue: made.error.kind === "rejected" ? (made.error.issue ?? null) : null,
      });
      return;
    }
    const checked = await commands.workbench.validateDir(made.value.dir);
    setWorking(null);
    setResult({
      kind: "made",
      dir: made.value.dir,
      files: made.value.files,
      check: checked.ok ? { kind: "done", issues: checked.value.issues } : { kind: "failed" },
      pack: { kind: "idle" },
    });
  };

  const recheck = async (dir: string): Promise<void> => {
    setWorking("recheck");
    const checked = await commands.workbench.validateDir(dir);
    setWorking(null);
    const check: DirCheck = checked.ok
      ? { kind: "done", issues: checked.value.issues }
      : { kind: "failed" };
    setResult((current) =>
      current !== null && current.kind === "made" && current.dir === dir
        ? { ...current, check }
        : current,
    );
  };

  const pack = async (dir: string): Promise<void> => {
    setWorking("pack");
    const packed = await commands.workbench.packDir(dir);
    setWorking(null);
    const next: PackRead = packed.ok ? { kind: "done", result: packed.value } : { kind: "failed" };
    setResult((current) =>
      current !== null && current.kind === "made" && current.dir === dir
        ? { ...current, pack: next }
        : current,
    );
  };

  return (
    <section aria-labelledby="compose-new-group-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="compose-new-group-title" className="m-0 flex items-center gap-1 text-text-primary">
          {t("desktop.compose.newGroup.title")}
          {props.prefill?.composition === undefined ? null : (
            <InfoTip text={t("desktop.compose.flow.draft.newGroupNote")} />
          )}
        </h2>
        <Button size="xs" variant="outline" onClick={props.onBack}>
          {t("desktop.compose.newGroup.back")}
        </Button>
      </div>
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-1 text-title-3 text-text-primary">
          {t("desktop.compose.newGroup.place.head")}
          <InfoTip text={t("desktop.compose.newGroup.place.info")} />
        </p>
        <PlaceFields
          draft={draft}
          onName={(name) => edit({ name })}
          onParent={(parentDir) => edit({ parentDir })}
          canPick={folderPick !== null}
          pickFailed={pickFailed}
          onPick={() => {
            if (folderPick !== null) run(pick(folderPick));
          }}
        />
      </div>
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-1 text-title-3 text-text-primary">
          {t("desktop.compose.newGroup.start.head")}
          <InfoTip text={t("desktop.compose.newGroup.start.info")} />
        </p>
        <StartPicker
          read={kinds}
          selected={draft.kind}
          onPick={(kind) => edit({ kind })}
          onRetry={() => {
            setVersion((current) => current + 1);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          loading={working === "create"}
          disabled={!ready || working !== null}
          onClick={() => run(create())}
        >
          {t("desktop.compose.newGroup.make")}
        </Button>
        {props.link !== "live" ? (
          <p className={MUTED}>{t("desktop.compose.newGroup.offline")}</p>
        ) : ready ? null : (
          <InfoTip text={t("desktop.compose.newGroup.hint")} />
        )}
      </div>
      {result === null ? null : result.kind === "failed" ? (
        <FailedNotice issue={result.issue} />
      ) : (
        <MadeResult
          made={result}
          working={working}
          onRecheck={() => run(recheck(result.dir))}
          onPack={() => run(pack(result.dir))}
        />
      )}
    </section>
  );
}
