// 구성기의 프로필 보기(§6.28.3). 저장된 프로필을 고르거나 새로 만들고, 플러그인 목록에 넣을 것과 뺄 것을 정해 저장한다(`profile.put`).
// M5c-1부터 프로필은 플러그인 목록(순서가 있다)이다. 목록에 없는 플러그인은 꺼진 것이다(끄기 목록과 "그대로"는 없다).
// 삭제(`profile.delete`)는 확인을 거친다. 미리 보기(`profile.preview`)는 저장된 값으로 계산한 "적용했다면"이다. 적용은 열린 대화에 한다(`thread.setProfile`).
// 저장·삭제·적용은 엔진에 연결되어 있을 때만 켜진다. 프로필은 호스트 설정에 있어 어느 창에서 저장해도 같은 목록이다(U-5).
import { FolderArt } from "../illustrations/index.tsx";
import { t } from "@fresnel/client/i18n";
import {
  AUTO_DRIVER_PICK,
  coreLockedOf,
  driverChoicesOf,
  driverOfPick,
  driverPicksOf,
  hasPluginOf,
  profileDraftOf,
  profileDraftProblemOf,
  profileInputOf,
  profileUnsavedOf,
  withDriver,
  withPluginAdded,
  withPluginRemoved,
  type ProfileDraft,
  type TabLink,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry, Profile, ProfilePreviewResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands, type CommandError } from "../commands.ts";
import {
  DependencyLines,
  dependencyIssueLinesOf,
  type DependencyLine,
} from "../craft/deps/dependency-refusal.tsx";
import { disabledFixOf, requiredByCoreOf } from "../craft/deps/deps-model.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useTabRead } from "../workbench/tab-read.ts";
import { useWorkbenchController } from "../workbench/controller.ts";
import { profileTitleOf } from "../convo/profile-chip-model.ts";
import { CHOICE_TEXT, PROBLEM_TEXT, profileErrorText } from "./compose-text.ts";
import type { MessageId, MessageArgs } from "@fresnel/client/i18n";

const MUTED = "m-0 text-ui text-text-tertiary";
/** 플러그인 하나의 목록 칸: 프로필 목록에 넣었나(on)·뺐나(off) */
export type PluginChoice = "on" | "off";
const CHOICES: readonly PluginChoice[] = ["on", "off"];
const NEW_PROFILE = "\u0000new";

function run(job: Promise<void>): void {
  detach(job, rethrow);
}

type Notice = {
  readonly tone: "success" | "danger";
  readonly text: MessageId;
  /** 글에 넣을 인자(예: 대화 id) */
  readonly values?: MessageArgs;
  /** 알림 옆 설명 한 줄(InfoTip) */
  readonly info?: MessageId;
  /** 저장을 막은 의존 이슈 줄(AGE-33) */
  readonly lines?: readonly DependencyLine[];
  /** 꺼진 대상 때문에 막혔을 때의 두 길: 대상도 켜기, 기대는 것도 빼기 */
  readonly fix?: { readonly enable: readonly string[]; readonly drop: readonly string[] };
};

/** 저장 실패의 알림. 검사 이슈가 함께 왔으면 의존 줄과 고칠 길을 싣는다 */
function saveFailureOf(error: CommandError): Notice {
  const issues = error.kind === "rejected" ? (error.profileIssues ?? []) : [];
  return {
    tone: "danger",
    text: profileErrorText(error),
    lines: dependencyIssueLinesOf(issues),
    fix: disabledFixOf(issues),
  };
}

/** 확장 한 줄. 내장 코어(`locked`)는 목록 칸 자리 대신 잠금 표시만 보인다. 저장 값과 무관하게 잠긴다 */
export function ChoiceRow(props: {
  readonly entry: ExtListEntry;
  readonly choice: PluginChoice;
  readonly locked: boolean;
  /**
   * 엔진에서 이 플러그인을 필요로 하는 쪽(카드의 `requiredByCore`, AGE-33). 있고 목록에 들어 있으면 빼기를 미리 잠그고 누가
   * 필요로 하는지 정보 아이콘에 적는다. 목록에 없으면 넣을 수는 있다
   */
  readonly requiredBy?: readonly string[];
  readonly onChange: (choice: PluginChoice) => void;
}): ReactNode {
  const { entry } = props;
  const requiredBy = props.requiredBy ?? [];
  const requiredLock = !props.locked && requiredBy.length > 0 && props.choice === "on";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="min-w-0 truncate text-body text-text-primary">{entry.displayName}</span>
      {props.locked ? (
        <span className="flex items-center gap-1 text-ui text-text-tertiary">
          {t("desktop.compose.profile.locked")}
          <InfoTip text={t("desktop.compose.profile.locked.info")} />
        </span>
      ) : requiredLock ? (
        <span
          className="flex items-center gap-1 text-ui text-text-tertiary"
          data-required-by-core=""
        >
          {t("desktop.compose.profile.required")}
          <InfoTip
            text={t("desktop.compose.profile.required.info", { names: requiredBy.join(", ") })}
          />
        </span>
      ) : (
        <SegmentedControl
          aria-label={entry.displayName}
          size="xs"
          value={props.choice}
          onValueChange={(value) => {
            const next = CHOICES.find((item) => item === value);
            if (next !== undefined) props.onChange(next);
          }}
        >
          {CHOICES.map((choice) => (
            <SegmentedControlItem key={choice} value={choice}>
              {t(CHOICE_TEXT[choice])}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      )}
    </li>
  );
}

/**
 * drive 그룹 고르기. "자동"은 null이고, 나머지는 설치된 그룹과 프로필이 가진 이름(설치 해제된 그룹 포함)이다.
 * 바꾸면 적용 뒤 다음 경계에서 지금 drive 락을 회수한다(§6.28.3).
 */
export function DriverField(props: {
  readonly driver: string | null;
  readonly choices: readonly string[];
  readonly onChange: (driver: string | null) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("desktop.compose.profile.driver")}>
        <Select
          value={props.driver ?? AUTO_DRIVER_PICK}
          onValueChange={(value) => {
            props.onChange(driverOfPick(value));
          }}
        >
          {driverPicksOf(props.driver, props.choices).map((pick) => (
            <SelectOption key={pick} value={pick}>
              {pick === AUTO_DRIVER_PICK ? t("desktop.compose.profile.driver.auto") : pick}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <InfoTip text={t("desktop.compose.profile.driver.info")} />
    </div>
  );
}

/**
 * "새 Test run으로": 저장된 프로필로 새 시험 대화를 만든다. 저장하지 않은 바꿈이 있으면 누를 수 없고, 그 까닭은 정보 아이콘에 보인다.
 */
export function TestRunButton(props: {
  readonly online: boolean;
  readonly busy: boolean;
  readonly saved: Profile | null;
  readonly draft: ProfileDraft;
  readonly onRun: () => void;
}): ReactNode {
  const { saved, draft } = props;
  const unsaved = saved !== null && profileUnsavedOf(draft, saved);
  const disabled = !props.online || props.busy || saved === null || unsaved;
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onClick={props.onRun}>
        {t("desktop.compose.profile.testRun")}
      </Button>
      <InfoTip
        text={
          unsaved
            ? t("desktop.compose.profile.testRun.unsaved")
            : t("desktop.compose.profile.testRun.info")
        }
      />
    </>
  );
}

/** 미리 보기 줄. 해소된 플러그인(공통 묶음 먼저, 그다음 프로필), 이 프로필을 쓰는 대화 수, 검사 문제 수를 보인다 */
function PreviewBlock(props: { readonly preview: ProfilePreviewResult }): ReactNode {
  const { preview } = props;
  return (
    <section
      aria-label={t("desktop.compose.profile.preview.title")}
      className="grid gap-1 rounded-lg border border-border-subtle p-3"
    >
      <h3 className="m-0 text-title-3 text-text-primary">
        {t("desktop.compose.profile.preview.title")}
      </h3>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.enabled", {
          names: preview.resolved.map((plugin) => plugin.name).join(", ") || "-",
        })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.threads", { count: preview.threadsUsing })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.issues", { count: preview.issues.length })}
      </p>
      <DependencyLines lines={dependencyIssueLinesOf(preview.issues)} />
    </section>
  );
}

function DeleteDialog(props: {
  readonly profile: Profile | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.profile !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={t("desktop.compose.profile.delete.heading")}
      description={t("desktop.compose.profile.delete.body", {
        title: props.profile === null ? "" : profileTitleOf(props.profile.id, props.profile.title),
      })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={props.onConfirm}>
            {t("desktop.compose.profile.delete")}
          </DialogAction>
        </>
      }
    />
  );
}

/**
 * 프로필 패널. 구성기 화면을 지운 뒤(AGE-69) 그리는 곳이 없지만, 옮길 자리를 정할 때까지 지우지 않고 둔다.
 * @public
 */
export function ProfilePanel(props: {
  readonly link: TabLink;
  readonly entries: readonly ExtListEntry[];
}): ReactNode {
  const commands = useCommands();
  const controller = useWorkbenchController();
  const threadId = useOpenThreadId();
  const online = props.link === "live";
  const [version, setVersion] = useState(0);
  const load = useCallback(() => commands.workbench.profiles(), [commands]);
  const read = useTabRead(`compose-profiles:${version}`, props.link, load);
  const loadCards = useCallback(() => commands.workbench.pluginCards(), [commands]);
  const cardsRead = useTabRead(`compose-cards:${version}`, props.link, loadCards);
  const requiredBy = requiredByCoreOf(cardsRead.kind === "ready" ? cardsRead.value : []);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preview, setPreview] = useState<ProfilePreviewResult | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);

  const profiles = read.kind === "ready" ? read.value : [];
  const saved = draft === null ? null : (profiles.find((item) => item.id === draft.id) ?? null);
  const problem = draft === null ? null : profileDraftProblemOf(draft);

  const reload = (): void => {
    setVersion((current) => current + 1);
  };
  const pick = (value: string): void => {
    setNotice(null);
    setPreview(null);
    if (value === NEW_PROFILE) {
      setDraft(profileDraftOf(null));
      return;
    }
    const found = profiles.find((item) => item.id === value);
    setDraft(found === undefined ? null : profileDraftOf(found));
  };
  const save = async (next: ProfileDraft | null = draft): Promise<void> => {
    if (next === null || profileDraftProblemOf(next) !== null) return;
    setBusy(true);
    const done = await commands.workbench.putProfile(profileInputOf(next), next.baseRev);
    setBusy(false);
    if (!done.ok) {
      setNotice(saveFailureOf(done.error));
      return;
    }
    setDraft(profileDraftOf(done.value.profile));
    setPreview(null);
    setNotice({ tone: "success", text: "desktop.compose.profile.saved" });
    reload();
  };
  // 꺼진 대상 때문에 막혔을 때: 대상을 같이 켜거나 기대는 것을 같이 빼고 다시 저장한다
  const applyFix = (names: readonly string[], on: boolean): void => {
    if (draft === null) return;
    const next = names.reduce(
      (acc, name) => (on ? withPluginAdded(acc, name) : withPluginRemoved(acc, name)),
      draft,
    );
    setDraft(next);
    setNotice(null);
    run(save(next));
  };
  const remove = async (target: Profile): Promise<void> => {
    setDeleting(null);
    setBusy(true);
    const done = await commands.workbench.deleteProfile(target.id);
    setBusy(false);
    if (!done.ok) {
      setNotice({ tone: "danger", text: profileErrorText(done.error) });
      return;
    }
    setDraft(null);
    setPreview(null);
    setNotice({ tone: "success", text: "desktop.compose.profile.deleted" });
    reload();
  };
  // "새 Test run으로": 저장된 프로필로 새 시험 대화를 만든다. 대화 목록에 열린다(목록은 이 화면이 다시 읽지 않는다)
  const startTestRun = async (target: Profile): Promise<void> => {
    setBusy(true);
    const done = await commands.tests.createTestRun(target.id);
    setBusy(false);
    if (!done.ok) {
      setNotice({ tone: "danger", text: profileErrorText(done.error) });
      return;
    }
    setNotice({
      tone: "success",
      text: "desktop.compose.profile.testRun.created",
      values: { id: done.value },
      info: "desktop.compose.profile.testRun.listInfo",
    });
  };
  const showPreview = async (target: Profile): Promise<void> => {
    setBusy(true);
    const done = await commands.workbench.previewProfile(
      target.id,
      threadId === null ? undefined : threadId,
    );
    setBusy(false);
    if (!done.ok) {
      setNotice({ tone: "danger", text: profileErrorText(done.error) });
      return;
    }
    setNotice(null);
    setPreview(done.value);
  };

  if (read.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid gap-2">
        <span className="sr-only">{t("desktop.compose.loading")}</span>
        <Skeleton height={32} />
        <Skeleton height={32} />
      </div>
    );
  }
  if (read.kind === "offline") return <p className={MUTED}>{t("desktop.compose.offline")}</p>;
  if (read.kind === "error") {
    return (
      <Alert
        tone="danger"
        variant="soft"
        size="sm"
        action={
          <Button size="xs" variant="outline" onClick={reload}>
            {t("desktop.compose.retry")}
          </Button>
        }
      >
        {t("desktop.compose.profile.loadFailed")}
      </Alert>
    );
  }
  return (
    <div className="grid gap-3">
      {read.stale ? <p className={MUTED}>{t("desktop.compose.stale")}</p> : null}
      {notice === null ? null : (
        <Alert
          tone={notice.tone}
          variant="soft"
          size="sm"
          dismissible
          dismissLabel={t("desktop.compose.dismiss")}
          onDismiss={() => setNotice(null)}
        >
          {t(notice.text, notice.values)}
          {notice.info === undefined ? null : <InfoTip text={t(notice.info)} />}
        </Alert>
      )}
      {notice === null || (notice.lines ?? []).length === 0 ? null : (
        <div className="grid gap-2" data-slot="profile-dependency-issues">
          <DependencyLines lines={notice.lines ?? []} />
          {notice.fix === undefined ||
          (notice.fix.enable.length === 0 && notice.fix.drop.length === 0) ? null : (
            <div className="flex flex-wrap items-center gap-2 ps-6">
              {notice.fix.enable.length === 0 ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!online || busy}
                  onClick={() => applyFix(notice.fix?.enable ?? [], true)}
                >
                  {t("desktop.compose.profile.fix.enable")}
                </Button>
              )}
              {notice.fix.drop.length === 0 ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!online || busy}
                  onClick={() => applyFix(notice.fix?.drop ?? [], false)}
                >
                  {t("desktop.compose.profile.fix.drop")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("desktop.compose.profile.pick")}>
          <Select
            value={draft === null ? "" : saved === null ? NEW_PROFILE : draft.id}
            placeholder={t("desktop.compose.profile.pickPlaceholder")}
            onValueChange={pick}
          >
            {profiles.map((item) => (
              <SelectOption key={item.id} value={item.id}>
                {profileTitleOf(item.id, item.title)}
              </SelectOption>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={!online || busy}
          onClick={() => pick(NEW_PROFILE)}
        >
          {t("desktop.compose.profile.new")}
        </Button>
      </div>
      {profiles.length === 0 && draft === null ? (
        <EmptyState
          media={<FolderArt />}
          size="sm"
          surface="none"
          title={t("desktop.compose.profile.empty")}
        />
      ) : null}
      {draft === null ? null : (
        <>
          <div className="grid gap-4 compact:grid-cols-2">
            <Field label={t("desktop.compose.profile.id")}>
              <Input
                size="sm"
                variant="soft"
                value={draft.id}
                disabled={draft.baseRev !== null}
                onValueChange={(id) => setDraft({ ...draft, id })}
              />
            </Field>
            <Field label={t("desktop.compose.profile.title")}>
              <Input
                size="sm"
                variant="soft"
                value={draft.title}
                onValueChange={(title) => setDraft({ ...draft, title })}
              />
            </Field>
          </div>
          {problem === null || (draft.id === "" && draft.title === "") ? null : (
            <p role="alert" className="m-0 text-ui text-text-secondary">
              {t(PROBLEM_TEXT[problem])}
            </p>
          )}
          <DriverField
            driver={draft.driver}
            choices={driverChoicesOf(props.entries)}
            onChange={(driver) => setDraft(withDriver(draft, driver))}
          />
          <p className="m-0 flex items-center gap-1 text-title-3 text-text-primary">
            {t("desktop.compose.profile.extensions")}
            <InfoTip text={t("desktop.compose.profile.keepTip")} />
          </p>
          <ul
            aria-label={t("desktop.compose.profile.extensions")}
            className="m-0 grid list-none divide-y divide-border-subtle p-0"
          >
            {props.entries.map((entry) => {
              // 내장 코어는 잠금 표시만 한다. 선택 값을 바꾸는 길을 열지 않는다
              const locked = coreLockedOf(entry);
              return (
                <ChoiceRow
                  key={entry.name}
                  entry={entry}
                  choice={hasPluginOf(draft, entry.name) ? "on" : "off"}
                  locked={locked}
                  requiredBy={requiredBy.get(entry.name) ?? []}
                  onChange={(choice) => {
                    if (locked) return;
                    setDraft(
                      choice === "on"
                        ? withPluginAdded(draft, entry.name)
                        : withPluginRemoved(draft, entry.name),
                    );
                  }}
                />
              );
            })}
          </ul>
          {preview === null ? null : <PreviewBlock preview={preview} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!online || busy || problem !== null}
              onClick={() => run(save())}
            >
              {t("desktop.compose.profile.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!online || busy || saved === null}
              onClick={() => saved !== null && run(showPreview(saved))}
            >
              {t("desktop.compose.profile.preview")}
            </Button>
            <Button
              size="sm"
              variant="solid"
              disabled={!online || busy || saved === null || threadId === null}
              onClick={() => {
                if (saved !== null && threadId !== null) {
                  run(controller.applyProfile(saved.id, threadId).then(() => undefined));
                }
              }}
            >
              {t("desktop.compose.profile.apply")}
            </Button>
            {threadId === null ? (
              // 대화가 없으면 적용 단추는 잠긴다. 그 까닭은 정보 아이콘에 둔다(시안은 글 없이 잠근다)
              <InfoTip text={t("desktop.compose.profile.noThread")} />
            ) : null}
            <TestRunButton
              online={online}
              busy={busy}
              saved={saved}
              draft={draft}
              onRun={() => {
                if (saved !== null) run(startTestRun(saved));
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!online || busy || saved === null}
              onClick={() => setDeleting(saved)}
            >
              {t("desktop.compose.profile.delete")}
            </Button>
          </div>
        </>
      )}
      <DeleteDialog
        profile={deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) run(remove(deleting));
        }}
      />
    </div>
  );
}
