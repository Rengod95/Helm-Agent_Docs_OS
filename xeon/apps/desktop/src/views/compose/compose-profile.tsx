// 구성기의 프로필 보기(§6.28.3). 저장된 프로필을 고르거나 새로 만들고, 확장마다 켜기·끄기·그대로를 정해 저장한다(`profile.put`).
// 삭제(`profile.delete`)는 확인을 거친다. 미리 보기(`profile.preview`)는 저장된 값으로 계산한 "적용했다면"이다. 적용은 열린 대화에 한다.
// 저장·삭제·적용은 엔진에 연결되어 있을 때만 켜진다. 프로필은 호스트 설정에 있어 어느 창에서 저장해도 같은 목록이다(U-5).
import { t } from "@fresnel/client/i18n";
import {
  choiceOf,
  profileDraftOf,
  profileDraftProblemOf,
  profileInputOf,
  withChoice,
  type ProfileChoice,
  type ProfileDraft,
  type TabLink,
} from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtListEntry, Profile, ProfilePreviewResult } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
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
import { Plus } from "@caustic/react/icons";
import { useCallback, useState, type ReactNode } from "react";
import { useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useTabRead } from "../workbench/tab-read.ts";
import { useWorkbenchController } from "../workbench/controller.ts";
import { CHOICE_TEXT, PROBLEM_TEXT, profileErrorText } from "./compose-text.ts";
import type { MessageId } from "@fresnel/client/i18n";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
const CHOICES: readonly ProfileChoice[] = ["on", "off", "keep"];
const NEW_PROFILE = "\u0000new";

function run(job: Promise<void>): void {
  detach(job, rethrow);
}

type Notice = { readonly tone: "success" | "danger"; readonly text: MessageId };

function ChoiceRow(props: {
  readonly entry: ExtListEntry;
  readonly choice: ProfileChoice;
  readonly onChange: (choice: ProfileChoice) => void;
}): ReactNode {
  const { entry } = props;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-ui-sm text-text-primary">{entry.displayName}</span>
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
    </li>
  );
}

function PreviewBlock(props: { readonly preview: ProfilePreviewResult }): ReactNode {
  const { preview } = props;
  return (
    <section
      aria-label={t("desktop.compose.profile.preview.title")}
      className="grid gap-1 rounded-lg border border-border-subtle p-3"
    >
      <h3 className="m-0 text-ui-sm font-semibold text-text-primary">
        {t("desktop.compose.profile.preview.title")}
      </h3>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.enabled", { names: preview.enabled.join(", ") || "-" })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.disabled", {
          names: preview.disabled.join(", ") || "-",
        })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.holder", { name: preview.expectedHolder ?? "-" })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.hooks", { count: preview.hookCount })}
      </p>
      <p className={MUTED}>
        {t("desktop.compose.profile.preview.overrides", { count: preview.overrides.length })}
      </p>
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
      description={t("desktop.compose.profile.delete.body", { title: props.profile?.title ?? "" })}
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
  const save = async (): Promise<void> => {
    if (draft === null || problem !== null) return;
    setBusy(true);
    const done = await commands.workbench.putProfile(profileInputOf(draft), draft.baseRev);
    setBusy(false);
    if (!done.ok) {
      setNotice({ tone: "danger", text: profileErrorText(done.error) });
      return;
    }
    setDraft(profileDraftOf(done.value.profile));
    setPreview(null);
    setNotice({ tone: "success", text: "desktop.compose.profile.saved" });
    reload();
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
          dismissible
          dismissLabel={t("desktop.compose.dismiss")}
          onDismiss={() => setNotice(null)}
        >
          {t(notice.text)}
        </Alert>
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
                {item.title}
              </SelectOption>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="outline"
          iconStart={<Plus />}
          disabled={!online || busy}
          onClick={() => pick(NEW_PROFILE)}
        >
          {t("desktop.compose.profile.new")}
        </Button>
      </div>
      {profiles.length === 0 && draft === null ? (
        <EmptyState size="sm" surface="none" title={t("desktop.compose.profile.empty")} />
      ) : null}
      {draft === null ? null : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("desktop.compose.profile.id")}>
              <Input
                size="sm"
                value={draft.id}
                disabled={draft.baseRev !== null}
                onValueChange={(id) => setDraft({ ...draft, id })}
              />
            </Field>
            <Field label={t("desktop.compose.profile.title")}>
              <Input
                size="sm"
                value={draft.title}
                onValueChange={(title) => setDraft({ ...draft, title })}
              />
            </Field>
          </div>
          {problem === null || (draft.id === "" && draft.title === "") ? null : (
            <p role="alert" className="m-0 text-ui-sm text-text-secondary">
              {t(PROBLEM_TEXT[problem])}
            </p>
          )}
          <p className="m-0 flex items-center gap-1 text-ui-sm font-semibold text-text-primary">
            {t("desktop.compose.profile.extensions")}
            <InfoTip text={t("desktop.compose.profile.keepTip")} />
          </p>
          <ul
            aria-label={t("desktop.compose.profile.extensions")}
            className="m-0 grid list-none divide-y divide-border-subtle p-0"
          >
            {props.entries.map((entry) => (
              <ChoiceRow
                key={entry.name}
                entry={entry}
                choice={choiceOf(draft, entry.name)}
                onChange={(choice) => setDraft(withChoice(draft, entry.name, choice))}
              />
            ))}
          </ul>
          {preview === null ? null : <PreviewBlock preview={preview} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
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
              variant="outline"
              disabled={!online || busy || saved === null || threadId === null}
              onClick={() => {
                if (saved !== null && threadId !== null) {
                  run(controller.applyProfile(saved.id, threadId).then(() => undefined));
                }
              }}
            >
              {t("desktop.compose.profile.apply")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!online || busy || saved === null}
              onClick={() => setDeleting(saved)}
            >
              {t("desktop.compose.profile.delete")}
            </Button>
            {threadId === null ? (
              <Badge size="xs" variant="outline">
                {t("desktop.compose.profile.noThread")}
              </Badge>
            ) : null}
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
