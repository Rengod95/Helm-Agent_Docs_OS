// 플러그인 상세 "의존" 탭의 그림(m6Mb, AGE-33). 한 물음에 답한다: "이 플러그인은 무엇에 기대고, 무엇이 이 플러그인에 기대나".
// 두 구역이다. 기대는 플러그인(이 플러그인의 `dependsOn`, 원본 폴더가 있으면 고칠 수 있다)과 이 플러그인에 기대는 것(카드의
// `dependents`, 읽기만). 두 구역은 상세 칸이 넓으면 두 단으로 나란히 선다(plugTab, `TwoColumns`). 줄 하나는 구성원 탭의 줄과 같은 높이(32)이고,
// 이름, 건 쪽 멤버, 버전 범위, 문제, 종류 칩, 지우기 단추가 선다.
// 문제(설치본 기준, 엔진이 계산)는 주의 구슬과 글로 늘 보인다. 고친 것은 바로 원본 폴더에 쓰이고, 승인하기 전에는 승인본이 돈다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { Lock, Plus, Trash2 } from "@caustic/react/icons";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { DependencyKind } from "@fresnel/contracts/extensions";
import type { DependencyOp } from "@fresnel/contracts/services";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useCallback, useId, useState, type ReactNode } from "react";
import { DotOrb } from "../../effects/dot-orb.tsx";
import { TwoColumns } from "../../workbench/tab-body.tsx";
import { InfoTip } from "../info-tip.tsx";
import { sendStateOf, type SendState } from "../members/members-model.ts";
import { Chip, NoticeCard, NoticeLine } from "../review/review-parts.tsx";
import { PartyLabel } from "./dependency-refusal.tsx";
import {
  dependentRowsOf,
  dependsOnRowsOf,
  KIND_WORD,
  partyNameOf,
  RANGE_MAX,
  rangeProblemOf,
  splitRegistration,
  targetOptionsOf,
  type DependencyRow,
} from "./deps-model.ts";
import type { DepsData } from "./deps-source.ts";

const KINDS: readonly DependencyKind[] = ["hard", "soft"];

/** 원본 폴더가 없거나 고칠 수 없는 까닭 */
const LOCK_TEXT: Readonly<Record<"builtin" | "noSource" | "denied", MessageId>> = {
  builtin: "desktop.craft.deps.locked.builtin",
  noSource: "desktop.craft.deps.locked.noSource",
  denied: "desktop.craft.deps.locked.denied",
};

/** 뿌리 플러그인 전체를 고른 값(기대는 쪽 고르기) */
const WHOLE = "";

type Notice = { readonly kind: "failed"; readonly text: MessageId } | { readonly kind: "sent" };

interface Editor {
  readonly busy: boolean;
  readonly adding: boolean;
  readonly notice: Notice | null;
  readonly setAdding: (on: boolean) => void;
  readonly run: (ops: readonly DependencyOp[]) => Promise<boolean>;
  readonly send: () => void;
}

function useEditor(data: DepsData): Editor {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { edit, send: sendData } = data;
  const run = useCallback(
    async (ops: readonly DependencyOp[]): Promise<boolean> => {
      setBusy(true);
      const done = await edit(ops);
      setBusy(false);
      setNotice(done.ok ? null : { kind: "failed", text: done.text });
      return done.ok;
    },
    [edit],
  );
  const send = useCallback(() => {
    const go = async (): Promise<void> => {
      setBusy(true);
      const done = await sendData();
      setBusy(false);
      setNotice(done.ok ? { kind: "sent" } : { kind: "failed", text: done.text });
    };
    detach(go(), rethrow);
  }, [sendData]);
  return { busy, adding, notice, setAdding, run, send };
}

/** 문제 표시: 멈춘 주의 구슬(따뜻한 잉크). 뜻은 옆의 글이 말한다 */
function ProblemMark(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-icon-md shrink-0 items-center justify-center"
    >
      <DotOrb state="listening" tone="warm" size={14} kind="mark" live={false} />
    </span>
  );
}

function RangeText(props: { readonly range: string | null }): ReactNode {
  return props.range === null ? (
    <span className="shrink-0 text-ui text-text-tertiary">{t("desktop.craft.deps.range.any")}</span>
  ) : (
    <span className="shrink-0 font-mono text-mono text-text-tertiary">{props.range}</span>
  );
}

/** 의존 한 줄. `side`가 `dependsOn`이면 대상의 이름을, `dependents`면 기대는 쪽의 이름을 앞에 둔다 */
function DependencyRowView(props: {
  readonly row: DependencyRow;
  readonly side: "dependsOn" | "dependents";
  readonly entries: readonly ExtListEntry[];
  readonly removable: boolean;
  readonly busy: boolean;
  readonly onRemove: (row: DependencyRow) => void;
}): ReactNode {
  const { row, side } = props;
  const party = partyNameOf(side === "dependsOn" ? row.target : row.from, props.entries);
  const targetMember = splitRegistration(row.target).member;
  const note =
    side === "dependsOn"
      ? row.fromMember === null
        ? null
        : t("desktop.craft.deps.byMember", { id: row.fromMember })
      : targetMember === null
        ? null
        : t("desktop.craft.deps.onMember", { id: targetMember });
  return (
    <li
      data-dependency-row={row.key}
      className="squircle flex h-control-md min-w-0 items-center gap-2 rounded-lg px-1.5 hover:bg-neutral-hover"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 shrink text-ui-md font-medium">
          <PartyLabel name={party} />
        </span>
        {note !== null && (
          <span className="shrink-0 whitespace-nowrap text-ui text-text-tertiary">{note}</span>
        )}
        <RangeText range={row.range} />
        {row.problem !== null && (
          <span className="flex min-w-0 items-center gap-1.5 text-ui text-text-secondary">
            <ProblemMark />
            <span className="min-w-0 truncate">{t(row.problem)}</span>
          </span>
        )}
      </span>
      <Chip>{t(KIND_WORD[row.kind])}</Chip>
      {props.removable && (
        <IconButton
          size="sm"
          variant="ghost"
          disabled={props.busy}
          label={t("desktop.craft.deps.remove", { name: party.plugin })}
          onClick={() => {
            props.onRemove(row);
          }}
        >
          <Trash2 aria-hidden />
        </IconButton>
      )}
    </li>
  );
}

function AddForm(props: {
  readonly data: DepsData;
  readonly taken: (from: string) => readonly string[];
  readonly busy: boolean;
  readonly onAdd: (op: DependencyOp) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { data } = props;
  const [from, setFrom] = useState(WHOLE);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<DependencyKind>("soft");
  const [range, setRange] = useState("");
  const rangeField = useId();
  const fromId = from === WHOLE ? data.name : `${data.name}/${from}`;
  const options = targetOptionsOf(data.entries, data.name, props.taken(fromId));
  const problem = rangeProblemOf(range);
  const ready = target !== "" && problem === null && !props.busy;
  const submit = (): void => {
    if (!ready) return;
    const trimmed = range.trim();
    props.onAdd({
      kind: "add",
      ...(from === WHOLE ? {} : { from }),
      dependency: { plugin: target, kind, ...(trimmed === "" ? {} : { range: trimmed }) },
    });
  };
  return (
    <form
      data-dependency-add=""
      aria-label={t("desktop.craft.deps.add")}
      className="grid gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("desktop.craft.deps.add.target")}>
          <Select
            size="sm"
            value={target}
            placeholder={t("desktop.craft.deps.add.targetPlaceholder")}
            onValueChange={setTarget}
          >
            {options.map((option) => (
              <SelectOption key={option.value} value={option.value}>
                {option.name.member === null
                  ? option.name.plugin
                  : `${option.name.plugin} ${t("desktop.craft.deps.member", { id: option.name.member })}`}
              </SelectOption>
            ))}
          </Select>
        </Field>
        {data.members.length > 0 ? (
          <Field label={t("desktop.craft.deps.add.from")}>
            <Select size="sm" value={from} onValueChange={setFrom}>
              <SelectOption value={WHOLE}>{t("desktop.craft.deps.add.fromWhole")}</SelectOption>
              {data.members.map((id) => (
                <SelectOption key={id} value={id}>
                  {t("desktop.craft.deps.member", { id })}
                </SelectOption>
              ))}
            </Select>
          </Field>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-1.5">
          <span className="flex items-center gap-1 text-ui text-text-secondary">
            {t("desktop.craft.deps.add.kind")}
            <InfoTip
              text={[
                t("desktop.craft.deps.kind.hard.help"),
                t("desktop.craft.deps.kind.soft.help"),
              ]}
            />
          </span>
          <SegmentedControl
            size="sm"
            value={kind}
            aria-label={t("desktop.craft.deps.add.kind")}
            onValueChange={(value) => {
              const picked = KINDS.find((k) => k === value);
              if (picked !== undefined) setKind(picked);
            }}
            className="justify-self-start"
          >
            {KINDS.map((k) => (
              <SegmentedControlItem key={k} value={k}>
                {t(KIND_WORD[k])}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <label htmlFor={rangeField} className="grid content-start gap-1.5">
          <span className="flex items-center gap-1 text-ui text-text-secondary">
            {t("desktop.craft.deps.add.range")}
            <InfoTip text={t("desktop.craft.deps.add.range.help")} />
          </span>
          <Input
            id={rangeField}
            size="sm"
            value={range}
            maxLength={RANGE_MAX + 1}
            invalid={problem !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder="^1.0.0"
            className="font-mono"
            aria-describedby={problem === null ? undefined : `${rangeField}-problem`}
            onValueChange={setRange}
          />
          {problem !== null && (
            <span id={`${rangeField}-problem`} role="alert" className="text-ui text-danger-text">
              {t(problem)}
            </span>
          )}
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
          {t("desktop.craft.members.cancel")}
        </Button>
        <Button type="submit" size="sm" variant="solid" disabled={!ready}>
          {t("desktop.craft.members.add.confirm")}
        </Button>
      </div>
    </form>
  );
}

function SendNotice(props: {
  readonly state: SendState;
  readonly editable: boolean;
  readonly editor: Editor;
  readonly onOpen: (itemId: string) => void;
}): ReactNode {
  const { state, editor } = props;
  switch (state.kind) {
    case "clean":
      return null;
    case "changed":
      if (!props.editable) return null;
      return (
        <NoticeCard
          tone="info"
          name="deps-changed"
          title={t("desktop.craft.deps.send.changed")}
          description={t("desktop.craft.deps.send.changedBody")}
          actionLabel={t(
            editor.busy ? "desktop.craft.members.send.sending" : "desktop.craft.members.send",
          )}
          onAction={() => {
            if (!editor.busy) editor.send();
          }}
        />
      );
    case "inReview":
      return (
        <NoticeCard
          tone="neutral"
          live={editor.notice?.kind === "sent"}
          name="deps-in-review"
          title={t(
            editor.notice?.kind === "sent"
              ? "desktop.craft.members.send.sent"
              : "desktop.craft.members.send.waiting",
          )}
          description={t("desktop.craft.members.send.waitingBody")}
          actionLabel={t("desktop.craft.members.send.open")}
          onAction={() => {
            props.onOpen(state.itemId);
          }}
        />
      );
    default:
      return assertNever(state, "deps SendNotice");
  }
}

/** 구역 머리: 제목, 설명 아이콘, 오른쪽 끝 칸. 오른쪽 안 여백은 줄의 px-1.5와 같아 단추 끝이 줄의 지우기 단추와 한 세로줄에 선다 */
function SectionHead(props: {
  readonly id: string;
  readonly title: MessageId;
  readonly info: MessageId;
  readonly end?: ReactNode;
}): ReactNode {
  return (
    <div className="flex h-control-sm items-center gap-1 pr-1.5">
      <h3 id={props.id} className="m-0 text-title-2 text-text-primary">
        {t(props.title)}
      </h3>
      <InfoTip text={t(props.info)} />
      <span aria-hidden className="flex-1" />
      {props.end}
    </div>
  );
}

export function DepsView(props: { readonly data: DepsData }): ReactNode {
  const { data } = props;
  const editor = useEditor(data);
  const headA = useId();
  const headB = useId();
  const { load } = data;
  if (load.status === "loading") {
    return (
      <div className="grid max-w-176 gap-2" aria-busy="true">
        <Skeleton height={24} />
        <Skeleton height={24} />
      </div>
    );
  }
  if (load.status === "failed") {
    return <Alert tone="danger">{t("desktop.craft.deps.load.failed")}</Alert>;
  }
  if (load.status === "offline") {
    return (
      <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.members.load.offline")}</p>
    );
  }
  const editable = load.access.kind === "editable" && load.source !== null;
  const lockText = load.access.kind === "locked" ? LOCK_TEXT[load.access.reason] : null;
  const dependsOn = dependsOnRowsOf(load.card.dependsOn, load.source);
  const dependents = dependentRowsOf(load.card.dependents);
  const state = sendStateOf({
    matchesReviewed: load.matchesReviewed,
    pending: load.pending,
    editedSinceSend: data.editedSinceSend,
  });
  const taken = (from: string): readonly string[] =>
    dependsOn.filter((row) => row.from === from).map((row) => row.target);
  const onRemove = (row: DependencyRow): void => {
    const op: DependencyOp = {
      kind: "remove",
      ...(row.fromMember === null ? {} : { from: row.fromMember }),
      plugin: row.target,
    };
    detach(
      editor.run([op]).then(() => undefined),
      rethrow,
    );
  };
  const end =
    lockText !== null ? (
      <span className="inline-flex items-center gap-1 text-ui text-text-tertiary">
        <Lock aria-hidden className="size-icon-md" />
        {t("desktop.craft.members.readOnly")}
        <InfoTip text={t(lockText)} />
      </span>
    ) : editable ? (
      <Button
        size="sm"
        variant="ghost"
        disabled={editor.busy || editor.adding}
        onClick={() => {
          editor.setAdding(true);
        }}
      >
        <Plus aria-hidden />
        {t("desktop.craft.deps.add")}
      </Button>
    ) : null;
  return (
    <div className="rv-root grid content-start gap-8 pt-4" data-deps="">
      <SendNotice state={state} editable={editable} editor={editor} onOpen={data.openReview} />
      <TwoColumns
        start={
          <section className="grid gap-4" aria-labelledby={headA} data-deps-section="dependsOn">
            <SectionHead
              id={headA}
              title="desktop.craft.deps.dependsOn"
              info="desktop.craft.deps.dependsOn.help"
              end={end}
            />
            {editor.notice?.kind === "failed" && (
              <div role="alert">
                <NoticeLine tone="danger">{t(editor.notice.text)}</NoticeLine>
              </div>
            )}
            {dependsOn.length === 0 && !editor.adding ? (
              <p className="m-0 text-ui text-text-secondary">
                {t("desktop.craft.deps.dependsOn.empty")}
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-0.5 p-0" aria-labelledby={headA}>
                {dependsOn.map((row) => (
                  <DependencyRowView
                    key={row.key}
                    row={row}
                    side="dependsOn"
                    entries={data.entries}
                    removable={editable}
                    busy={editor.busy}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
            )}
            {editor.adding && (
              <AddForm
                data={data}
                taken={taken}
                busy={editor.busy}
                onCancel={() => {
                  editor.setAdding(false);
                }}
                onAdd={(op) => {
                  detach(
                    editor.run([op]).then((ok) => {
                      if (ok) editor.setAdding(false);
                      return undefined;
                    }),
                    rethrow,
                  );
                }}
              />
            )}
          </section>
        }
        end={
          <section className="grid gap-4" aria-labelledby={headB} data-deps-section="dependents">
            <SectionHead
              id={headB}
              title="desktop.craft.deps.dependents"
              info="desktop.craft.deps.dependents.help"
            />
            {dependents.length === 0 ? (
              <p className="m-0 text-ui text-text-secondary">
                {t("desktop.craft.deps.dependents.empty")}
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-0.5 p-0" aria-labelledby={headB}>
                {dependents.map((row) => (
                  <DependencyRowView
                    key={row.key}
                    row={row}
                    side="dependents"
                    entries={data.entries}
                    removable={false}
                    busy={editor.busy}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
            )}
          </section>
        }
      />
    </div>
  );
}
