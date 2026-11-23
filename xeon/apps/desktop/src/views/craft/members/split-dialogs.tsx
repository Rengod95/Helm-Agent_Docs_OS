// 멤버 따로 떼기와 플러그인 합치기 상자(m6Mb, AGE-33). 한 상자가 한 물음이다: 떼기는 "이 멤버를 어떤 새 플러그인으로 뗄까",
// 합치기는 "어느 플러그인들을 어떤 새 플러그인으로 묶을까". 둘 다 원본은 그대로 두고 새 폴더에 새 플러그인을 쓴 뒤 리뷰에 낸다.
// 원본을 지우지 않는다는 말은 정보 아이콘 뒤가 아니라 늘 보이는 줄이다. 끝나면 같은 상자가 결과(새 이름, 폴더, 엔진 알림)를 보인다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  Field,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
} from "@caustic/react";
import { detach, rethrow } from "@fresnel/contracts";
import type { DependencyKind, PluginCard } from "@fresnel/contracts/extensions";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { pickWorkspaceFolder } from "../../folder-pick.ts";
import { useFolderPick } from "../../folder-pick-context.ts";
import { KIND_WORD } from "../deps/deps-model.ts";
import { InfoTip } from "../info-tip.tsx";
import { NoticeLine } from "../review/review-parts.tsx";
import {
  childDirOf,
  defaultDetachName,
  MERGE_MAX,
  MERGE_MIN,
  mergeCandidatesOf,
  mergeDependentsOf,
  newNameProblemOf,
  PURPOSE_MAX,
  purposeProblemOf,
  siblingDirOf,
} from "./split-model.ts";
import type { SplitActions, SplitOutcome } from "./split-source.ts";

const KINDS: readonly DependencyKind[] = ["hard", "soft"];

type Done = Extract<SplitOutcome, { readonly ok: true }>;

// ── 공용 칸 ────────────────────────────────────────────────────────────

function NameField(props: {
  readonly value: string;
  readonly problem: MessageId | null;
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <Field
      label={t("desktop.craft.split.name")}
      {...(props.problem === null ? {} : { error: t(props.problem) })}
    >
      <Input
        size="sm"
        autoFocus
        value={props.value}
        invalid={props.problem !== null}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        onValueChange={(value) => {
          props.onChange(value.trim());
        }}
      />
    </Field>
  );
}

/** 새 폴더 칸. 고르기는 부모 폴더를 고르고 그 안에 새 이름의 폴더를 쓴다(새 폴더는 없거나 비어 있어야 한다) */
function DirField(props: {
  readonly value: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const folderPick = useFolderPick();
  const [pickFailed, setPickFailed] = useState(false);
  return (
    <Field
      label={
        <span className="inline-flex items-center gap-1">
          {t("desktop.craft.split.dir")}
          <InfoTip text={t("desktop.craft.split.dir.help")} />
        </span>
      }
      {...(pickFailed ? { error: t("desktop.workspace.pickFailed") } : {})}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Input
          size="sm"
          value={props.value}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          containerClassName="min-w-0 flex-1"
          onValueChange={props.onChange}
        />
        {folderPick !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              detach(
                pickWorkspaceFolder(folderPick).then((picked) => {
                  setPickFailed(!picked.ok);
                  if (picked.ok && picked.value !== undefined) {
                    props.onChange(childDirOf(picked.value, props.name));
                  }
                  return undefined;
                }),
                rethrow,
              );
            }}
          >
            {t("desktop.craft.split.dir.pick")}
          </Button>
        )}
      </div>
    </Field>
  );
}

function PurposeField(props: {
  readonly value: string;
  readonly placeholder: MessageId;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const problem = purposeProblemOf(props.value);
  return (
    <Field
      label={t("desktop.craft.split.purpose")}
      {...(problem === null ? {} : { error: t(problem) })}
    >
      <Input
        size="sm"
        value={props.value}
        maxLength={PURPOSE_MAX + 1}
        invalid={problem !== null}
        placeholder={t(props.placeholder)}
        onValueChange={props.onChange}
      />
    </Field>
  );
}

/** 끝난 뒤의 본문: 리뷰로 냈는지, 새 이름과 폴더, 엔진 알림 */
function SplitResult(props: { readonly done: Done }): ReactNode {
  const { done } = props;
  return (
    <div className="grid gap-3" data-split-result="">
      <div role="status" className="grid gap-1">
        {done.sendFailed === null ? (
          <NoticeLine tone="success">{t("desktop.craft.split.sent")}</NoticeLine>
        ) : (
          <NoticeLine tone="danger">{t(done.sendFailed)}</NoticeLine>
        )}
        {done.bundleItemId !== null && (
          <NoticeLine tone="success">{t("desktop.craft.split.bundle.sent")}</NoticeLine>
        )}
        {done.bundleFailed !== null && (
          <NoticeLine tone="danger">{t(done.bundleFailed)}</NoticeLine>
        )}
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui-sm">
        <dt className="text-text-tertiary">{t("desktop.craft.split.name")}</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-mono-sm text-text-primary">
          {done.name}
        </dd>
        <dt className="text-text-tertiary">{t("desktop.craft.split.dir")}</dt>
        <dd
          className="m-0 min-w-0 truncate font-mono text-mono-sm text-text-primary"
          title={done.outDir}
        >
          {done.outDir}
        </dd>
      </dl>
      {done.notes.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0" data-split-notes="">
          {done.notes.map((note) => (
            <NoticeLine key={note.text} as="li" tone={note.tone}>
              {t(note.text)}
            </NoticeLine>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultFooter(props: {
  readonly done: Done;
  readonly onOpen: (itemId: string) => void;
}): ReactNode {
  const { itemId } = props.done;
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" size="sm">
          {t("desktop.craft.split.close")}
        </Button>
      </DialogClose>
      {itemId !== null && (
        <Button
          size="sm"
          variant="solid"
          onClick={() => {
            props.onOpen(itemId);
          }}
        >
          {t("desktop.craft.members.send.open")}
        </Button>
      )}
    </>
  );
}

// ── 떼기 ───────────────────────────────────────────────────────────────

export interface DetachTarget {
  readonly id: string;
  readonly name: string;
}

export function DetachDialog(props: {
  /** 떼어 낼 멤버. null이면 닫힌다 */
  readonly member: DetachTarget | null;
  readonly rootName: string;
  readonly sourceDir: string;
  /** 설치된 이름(새 이름과 겹치면 안 된다) */
  readonly taken: readonly string[];
  readonly actions: SplitActions;
  readonly onClose: () => void;
}): ReactNode {
  const { member } = props;
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={member === null ? "" : t("desktop.craft.split.detach.heading", { name: member.name })}
      size="md"
    >
      {member !== null && <DetachBody key={member.id} {...props} member={member} />}
    </Dialog>
  );
}

function DetachBody(props: {
  readonly member: DetachTarget;
  readonly rootName: string;
  readonly sourceDir: string;
  readonly taken: readonly string[];
  readonly actions: SplitActions;
  readonly onClose: () => void;
}): ReactNode {
  const [name, setName] = useState(defaultDetachName(props.rootName, props.member.id));
  const [dir, setDir] = useState<string | null>(null);
  const [keep, setKeep] = useState(true);
  const [kind, setKind] = useState<DependencyKind>("soft");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const nameProblem = newNameProblemOf(name, props.taken);
  const outDir = dir ?? siblingDirOf(props.sourceDir, name);
  const ready =
    name !== "" &&
    nameProblem === null &&
    outDir.trim() !== "" &&
    purposeProblemOf(purpose) === null &&
    !busy;
  if (done !== null) {
    return (
      <>
        <SplitResult done={done} />
        <div className="mt-4 flex items-center justify-end gap-2">
          <ResultFooter
            done={done}
            onOpen={(itemId) => {
              props.onClose();
              props.actions.openReview(itemId);
            }}
          />
        </div>
      </>
    );
  }
  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const trimmed = purpose.trim();
    detach(
      props.actions
        .detach({
          dir: props.sourceDir,
          member: props.member.id,
          outDir: outDir.trim(),
          name,
          keepDependency: keep,
          ...(keep ? { dependencyKind: kind } : {}),
          ...(trimmed === "" ? {} : { purpose: trimmed }),
        })
        .then((outcome) => {
          setBusy(false);
          if (outcome.ok) setDone(outcome);
          else setFailure(outcome.text);
          return undefined;
        }),
      rethrow,
    );
  };
  return (
    <form
      className="grid gap-4"
      data-split="detach"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <NoticeLine tone="info">{t("desktop.craft.split.detach.keepsSource")}</NoticeLine>
      <NameField value={name} problem={nameProblem} onChange={setName} />
      <DirField value={outDir} name={name} onChange={setDir} />
      <div className="grid gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-ui text-text-primary">
          <Checkbox
            size="sm"
            checked={keep}
            onCheckedChange={(next) => {
              setKeep(next === true);
            }}
          />
          {t("desktop.craft.split.detach.keep", { name: props.rootName })}
          <InfoTip text={t("desktop.craft.split.detach.keep.help")} />
        </label>
        {keep && (
          <SegmentedControl
            size="sm"
            value={kind}
            aria-label={t("desktop.craft.deps.add.kind")}
            onValueChange={(value) => {
              const picked = KINDS.find((k) => k === value);
              if (picked !== undefined) setKind(picked);
            }}
            className="ms-6 justify-self-start"
          >
            {KINDS.map((k) => (
              <SegmentedControlItem key={k} value={k}>
                {t(KIND_WORD[k])}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        )}
      </div>
      <PurposeField
        value={purpose}
        placeholder="desktop.craft.split.detach.purposePlaceholder"
        onChange={setPurpose}
      />
      {failure !== null && (
        <div role="alert">
          <NoticeLine tone="danger">{t(failure)}</NoticeLine>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            {t("desktop.craft.members.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" variant="solid" disabled={!ready} loading={busy}>
          {t("desktop.craft.split.detach.confirm")}
        </Button>
      </div>
    </form>
  );
}

// ── 합치기 ─────────────────────────────────────────────────────────────

interface Candidate {
  readonly entry: ExtListEntry;
  readonly dir: string;
}

/** 처음 값(캔버스에서 판을 판 위에 놓아 연 합치기, cvMerge): 고른 플러그인(멤버 순서)과 새 이름 */
export interface MergeStart {
  readonly picked: readonly string[];
  readonly name: string;
}

export function MergeDialog(props: {
  readonly open: boolean;
  readonly entries: readonly ExtListEntry[];
  readonly actions: SplitActions;
  readonly onClose: () => void;
  readonly start?: MergeStart;
}): ReactNode {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("desktop.craft.split.merge.heading")}
      size="md"
    >
      {props.open && <MergeBody {...props} />}
    </Dialog>
  );
}

function MergeBody(props: {
  readonly entries: readonly ExtListEntry[];
  readonly actions: SplitActions;
  readonly onClose: () => void;
  readonly start?: MergeStart;
}): ReactNode {
  const { actions, entries } = props;
  const commands = useCommands();
  const [candidates, setCandidates] = useState<readonly Candidate[] | null>(null);
  // 고른 원본에 hard로 기대는 플러그인을 미리 알리려고 카드를 한 번 읽는다. 못 읽으면 알림 없이 둔다(엔진이 승인 때 다시 막는다)
  const [cards, setCards] = useState<readonly PluginCard[]>([]);
  const [picked, setPicked] = useState<readonly string[]>(props.start?.picked ?? []);
  const [name, setName] = useState(props.start?.name ?? "");
  const [dir, setDir] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let live = true;
    const shown = mergeCandidatesOf(entries);
    detach(
      actions.sources(shown.map((e) => e.name)).then((dirs) => {
        if (!live) return undefined;
        setCandidates(
          shown.flatMap((entry) => {
            const found = dirs.get(entry.name);
            return found === undefined ? [] : [{ entry, dir: found }];
          }),
        );
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [actions, entries]);

  useEffect(() => {
    let live = true;
    detach(
      commands.workbench.pluginCards().then((got) => {
        if (live && got.ok) setCards(got.value);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      live = false;
    };
  }, [commands]);

  if (done !== null) {
    return (
      <>
        <SplitResult done={done} />
        <div className="mt-4 flex items-center justify-end gap-2">
          <ResultFooter
            done={done}
            onOpen={(itemId) => {
              props.onClose();
              actions.openReview(itemId);
            }}
          />
        </div>
      </>
    );
  }
  if (candidates === null) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton height={24} />
        <Skeleton height={24} />
      </div>
    );
  }
  const chosen = picked.flatMap((n) => candidates.filter((c) => c.entry.name === n));
  const first = chosen[0];
  const titleOf = (plugin: string): string =>
    entries.find((entry) => entry.name === plugin)?.displayName ?? plugin;
  const blockers = mergeDependentsOf(
    chosen.map((c) => c.entry.name),
    cards,
  );
  const nameProblem = newNameProblemOf(
    name,
    entries.map((e) => e.name),
  );
  const outDir = dir ?? (first === undefined || name === "" ? "" : siblingDirOf(first.dir, name));
  const ready =
    chosen.length >= MERGE_MIN &&
    name !== "" &&
    nameProblem === null &&
    outDir.trim() !== "" &&
    purposeProblemOf(purpose) === null &&
    !busy;
  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const trimmedTitle = title.trim();
    const trimmedPurpose = purpose.trim();
    detach(
      actions
        .merge({
          dirs: chosen.map((c) => c.dir),
          outDir: outDir.trim(),
          name,
          ...(trimmedTitle === "" ? {} : { title: trimmedTitle }),
          ...(trimmedPurpose === "" ? {} : { purpose: trimmedPurpose }),
        })
        .then((outcome) => {
          setBusy(false);
          if (outcome.ok) setDone(outcome);
          else setFailure(outcome.text);
          return undefined;
        }),
      rethrow,
    );
  };
  return (
    <form
      className="grid gap-4"
      data-split="merge"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <NoticeLine tone="info">{t("desktop.craft.split.merge.keepsSource")}</NoticeLine>
      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="mb-1.5 flex items-center gap-1 p-0 text-ui-sm text-text-secondary">
          {t("desktop.craft.split.merge.pick", { min: MERGE_MIN })}
          <InfoTip text={t("desktop.craft.split.merge.pick.help")} />
        </legend>
        {candidates.length < MERGE_MIN ? (
          <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.split.merge.none")}</p>
        ) : (
          <ul className="m-0 grid max-h-56 list-none gap-0.5 overflow-y-auto p-0">
            {candidates.map((c) => {
              const on = picked.includes(c.entry.name);
              return (
                <li key={c.entry.name}>
                  <label
                    className="squircle flex h-control-md min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 hover:bg-neutral-hover"
                    data-merge-candidate={c.entry.name}
                  >
                    <Checkbox
                      size="sm"
                      checked={on}
                      disabled={!on && picked.length >= MERGE_MAX}
                      onCheckedChange={(next) => {
                        setPicked((now) =>
                          next === true
                            ? [...now.filter((n) => n !== c.entry.name), c.entry.name]
                            : now.filter((n) => n !== c.entry.name),
                        );
                      }}
                    />
                    <span className="min-w-0 truncate text-ui-md text-text-primary">
                      {c.entry.displayName}
                    </span>
                    {c.entry.displayName !== c.entry.name && (
                      <span className="shrink-0 font-mono text-mono-sm text-text-tertiary">
                        {c.entry.name}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      {blockers.length === 0 ? null : (
        <div className="grid gap-1" data-merge-dependents="">
          <NoticeLine tone="warning">{t("desktop.craft.split.merge.dependents")}</NoticeLine>
          <ul className="m-0 grid list-none gap-1 p-0">
            {blockers.map((line) => (
              <NoticeLine key={line.source} tone="warning" as="li">
                {t("desktop.craft.split.merge.dependent", {
                  source: titleOf(line.source),
                  dependents: line.dependents.map(titleOf).join(", "),
                })}
              </NoticeLine>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NameField value={name} problem={nameProblem} onChange={setName} />
        <Field
          label={
            <span className="inline-flex items-center gap-1">
              {t("desktop.craft.members.title")}
              <InfoTip text={t("desktop.craft.members.title.help")} />
            </span>
          }
        >
          <Input size="sm" value={title} maxLength={64} onValueChange={setTitle} />
        </Field>
      </div>
      <DirField value={outDir} name={name} onChange={setDir} />
      <PurposeField
        value={purpose}
        placeholder="desktop.craft.split.merge.purposePlaceholder"
        onChange={setPurpose}
      />
      {failure !== null && (
        <div role="alert">
          <NoticeLine tone="danger">{t(failure)}</NoticeLine>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="outline" size="sm">
            {t("desktop.craft.members.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" variant="solid" disabled={!ready} loading={busy}>
          {t("desktop.craft.split.merge.confirm")}
        </Button>
      </div>
    </form>
  );
}
