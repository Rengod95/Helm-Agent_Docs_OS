import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  IconButton,
  Input,
  Menu,
  MenuItem,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Switch,
} from "@caustic/react";
import { Ellipsis, Lock, Plus, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { AccountEntry, RotationState } from "@fresnel/client";
import type { KeyField } from "@fresnel/client/settings";
import type { ModelEntry } from "@fresnel/contracts/wire";
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { modelOptionsOf, tokenCountText } from "../../model-usage.ts";
import {
  FIELD_WIDTH,
  FORM_CONTROL_SIZE,
  SettingRow,
  SettingSection,
} from "../settings/settings-section.tsx";
import { CheckSteps, type CheckStep } from "../shared/check-steps.tsx";
import { ModelPicker, modelMetaText } from "../shared/model-picker.tsx";
import { OrderedList, type OrderedItem } from "../shared/ordered-list.tsx";
import { providerHostOf, providerMarkOf, providerNameOf } from "../shared/provider-names.ts";
import {
  foldOf,
  modelAccessGroupsOf,
  type ModelAccessRow,
  type ProviderCard,
  type ProviderCheckResult,
  type ProviderPool,
  type ProviderStatus,
  type UsageTotals,
} from "./providers-model.ts";

// 설정 "모델과 계정" 구역의 그림(P-11, DP-83·DP-84 [결정: 2026-11-11 사용자]). 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 직접 그린다).
//   제공자      카드 격자(폭 520 이상 두 열). 카드 = 글자 표지 · 이름 · 스위치 / 상태 점과 글 / 누적 사용량 / 키 넣기 · 시험 · ⋯.
//               시험을 누르면 카드 아래에 점검 줄(키 저장 → 제공자 연결 → 모델 목록)이 펼쳐진다. 빈 상태는 알려진 제공자 고르기 격자다.
//   키 연결     대화 상자 하나: 붙여 넣기 또는 저장된 키 고르기 → 저장하고 시험 → 점검 줄. 키 값은 DOM에만 있고 `KeyField.take`가 읽는 즉시 비운다.
//   계정 풀     회전 줄(무엇이 도는지 보조 글로) + 제공자별 계정 순서 목록. 추가는 대화 상자.
//   쓸 모델     기본 모델 고르기 + 모델 목록 스위치(끄면 막음) + 고른 모델만 쓰기 규칙.

// ── 공용 조각 ────────────────────────────────────────────────────────────

/** 읽을 수 없는 값의 안내. 그 항목은 고칠 수 없고 파일로 본다 */
function UnreadableNote(props: { readonly message: string }): ReactNode {
  return (
    <Alert tone="warning" variant="outline" size="sm">
      {props.message}
    </Alert>
  );
}

/** 잠긴 이유의 한 줄: 자물쇠 아이콘과 글 하나 */
function LockLine(props: { readonly text: string }): ReactNode {
  return (
    <p className="m-0 flex min-w-0 items-center gap-1.5 text-ui text-text-tertiary">
      <Lock aria-hidden className="size-icon-xs flex-none" />
      <span>{props.text}</span>
    </p>
  );
}

/** 키 등록 실패의 문장 한 쌍. `text`는 원인, `fix`는 고치는 법 한 문장이다(알려진 원인만). 값은 없다 */
export interface KeyErrorText {
  readonly text: string;
  readonly fix?: string | undefined;
}

/** 오류 한 줄(13 danger). 고치는 법이 있으면 그 밑에 한 줄(13 tertiary)을 둔다 */
export function ErrorLine(props: {
  readonly text: string | null;
  readonly fix?: string | undefined;
}): ReactNode {
  if (props.text === null) return null;
  const alert = (
    <p role="alert" className="m-0 text-ui text-danger-text">
      {props.text}
    </p>
  );
  if (props.fix === undefined) return alert;
  return (
    <div className="grid gap-1">
      {alert}
      <p className="m-0 text-ui text-text-tertiary">{props.fix}</p>
    </div>
  );
}

/** 글자 표지 28×28. 로고 대신 이름 첫 글자다(DP-83) */
function ProviderMark(props: { readonly mark: string }): ReactNode {
  return (
    <span
      aria-hidden
      className="flex size-7 flex-none items-center justify-center rounded-md bg-neutral-soft text-ui font-semibold text-text-secondary"
    >
      {props.mark}
    </span>
  );
}

const STATUS_DOT: Readonly<Record<ProviderStatus, string>> = {
  connected: "bg-success-text",
  noKey: "bg-warning-text",
  noModels: "bg-warning-text",
  missingKey: "bg-danger-text",
  off: "bg-text-tertiary",
};

function providerStatusText(card: Pick<ProviderCard, "status" | "modelCount">): string {
  switch (card.status) {
    case "connected":
      return t("desktop.providers.status.connected", { count: card.modelCount });
    case "noKey":
      return t("desktop.providers.status.noKey");
    case "missingKey":
      return t("desktop.providers.status.missingKey");
    case "noModels":
      return t("desktop.providers.status.noModels");
    case "off":
      return t("desktop.providers.status.off");
    default:
      return assertNever(card.status, "ProviderStatus");
  }
}

function usdText(usd: number): string {
  if (usd > 0 && usd < 0.01) return "< $0.01";
  return `$${usd.toFixed(2)}`;
}

/** 누적 사용량 한 줄: "지금까지 1.2M 토큰 · $3.40 · 120회" */
export function usageLineOf(usage: UsageTotals): string {
  return t("desktop.providers.usage.line", {
    tokens: tokenCountText(usage.tokens),
    usd: usdText(usage.usd),
    requests: usage.requests,
  });
}

// ── 연결 시험 줄 ─────────────────────────────────────────────────────────

const CHECK_LABEL = {
  stored: "desktop.providers.check.stored",
  linked: "desktop.providers.check.linked",
  models: "desktop.providers.check.models",
} as const;

/** 시험 결과를 점검 줄 단계로. 고치는 동작은 키 넣기(저장·연결 실패)와 켜기(꺼짐)다 */
export function providerStepsOf(
  results: readonly ProviderCheckResult[],
  actions: { readonly onKey: () => void; readonly onEnable: () => void },
): readonly CheckStep[] {
  return results.map((result): CheckStep => {
    const label = t(CHECK_LABEL[result.id]);
    if (result.state !== "passed" && result.state !== "failed") {
      return { id: result.id, label, state: result.state };
    }
    const base = {
      id: result.id,
      label,
      state: result.state,
      ...(result.elapsedMs === undefined ? {} : { elapsedMs: result.elapsedMs }),
    };
    const reason = result.reason;
    switch (reason.kind) {
      case "stored":
        return {
          ...base,
          detail:
            reason.length === null
              ? t("desktop.providers.check.detail.storedPlain")
              : t("desktop.providers.check.detail.stored", { length: reason.length }),
        };
      case "linked":
        return { ...base, detail: t("desktop.providers.check.detail.linked") };
      case "models":
        return {
          ...base,
          detail: t("desktop.providers.check.detail.models", { count: reason.count }),
        };
      case "noKey":
      case "missing":
      case "notLinked":
        return {
          ...base,
          detail: t(
            reason.kind === "noKey"
              ? "desktop.providers.check.detail.noKey"
              : reason.kind === "missing"
                ? "desktop.providers.check.detail.missing"
                : "desktop.providers.check.detail.notLinked",
          ),
          fix: t("desktop.providers.check.fix.key"),
          action: { label: t("desktop.providers.key.add"), onAction: actions.onKey },
        };
      case "undecryptable":
        return {
          ...base,
          detail: t("desktop.providers.check.detail.undecryptable"),
          fix: t("desktop.providers.check.fix.undecryptable"),
          action: { label: t("desktop.providers.key.change"), onAction: actions.onKey },
        };
      case "off":
        return {
          ...base,
          detail: t("desktop.providers.check.detail.off"),
          fix: t("desktop.providers.check.fix.off"),
          action: { label: t("desktop.providers.check.enable"), onAction: actions.onEnable },
        };
      case "noModels":
        return {
          ...base,
          detail: t("desktop.providers.check.detail.noModels"),
          fix: t("desktop.providers.check.fix.noModels"),
        };
      case "error":
        return {
          ...base,
          detail: reason.text,
          ...(reason.fix === undefined ? {} : { fix: reason.fix }),
        };
      default:
        return assertNever(reason, "ProviderCheckReason");
    }
  });
}

// ── 제공자 카드 ─────────────────────────────────────────────────────────

interface ProviderCardHandlers {
  readonly onToggle: (id: string, enabled: boolean) => void;
  readonly onKey: (id: string) => void;
  readonly onTest: (id: string) => void;
  readonly onBaseUrl: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

function ProviderCardView(props: {
  readonly card: ProviderCard;
  readonly editable: boolean;
  /** 이 카드의 시험 줄. 시험하지 않았으면 null */
  readonly steps: readonly CheckStep[] | null;
  readonly handlers: ProviderCardHandlers;
}): ReactNode {
  const { card, editable, handlers } = props;
  const hasKey = card.secretName !== null;
  // 마지막 점검이 떨어졌으면 그 사유를 상태 줄에 보인다(아래 점검 줄과 같은 문장). 점검을 다시 통과하면 상태로 돌아간다
  const failure = props.steps?.find((step) => step.state === "failed")?.detail ?? null;
  return (
    <article
      data-slot="provider-card"
      data-provider={card.id}
      data-status={card.status}
      aria-label={card.name}
      className="grid min-w-0 content-start gap-3 rounded-xl bg-surface-base px-4 py-3 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProviderMark mark={card.mark} />
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-ui font-semibold text-text-primary">{card.name}</span>
          {card.custom ? (
            <span className="truncate font-mono text-mono-sm text-text-tertiary">
              {card.baseUrl ?? card.id}
            </span>
          ) : null}
        </div>
        <Switch
          size={FORM_CONTROL_SIZE}
          aria-label={t("desktop.providers.enabled", { name: card.name })}
          checked={card.enabled}
          disabled={!editable}
          onCheckedChange={(next) => {
            handlers.onToggle(card.id, next);
          }}
        />
      </div>
      <div className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-ui text-text-secondary">
          <span
            aria-hidden
            className={`size-1.5 flex-none rounded-full ${STATUS_DOT[card.status]}`}
          />
          <span className="min-w-0 truncate">{failure ?? providerStatusText(card)}</span>
        </span>
        {card.usage === null ? null : (
          <span className="truncate ps-3 text-ui-sm text-text-tertiary tabular-nums">
            {usageLineOf(card.usage)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          size={FORM_CONTROL_SIZE}
          variant="outline"
          disabled={!editable}
          onClick={() => {
            handlers.onKey(card.id);
          }}
        >
          {t(hasKey ? "desktop.providers.key.change" : "desktop.providers.key.add")}
        </Button>
        <Button
          size={FORM_CONTROL_SIZE}
          variant="ghost"
          disabled={!editable || props.steps?.some((step) => step.state === "running") === true}
          onClick={() => {
            handlers.onTest(card.id);
          }}
        >
          {t("desktop.check.run")}
        </Button>
        <span className="flex-1" />
        <Menu
          align="end"
          trigger={
            <IconButton
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              label={t("desktop.providers.menu", { name: card.name })}
              disabled={!editable}
            >
              <Ellipsis />
            </IconButton>
          }
        >
          <MenuItem
            onSelect={() => {
              handlers.onBaseUrl(card.id);
            }}
          >
            {t("desktop.providers.menu.baseUrl")}
          </MenuItem>
          <MenuItem
            tone="danger"
            onSelect={() => {
              handlers.onRemove(card.id);
            }}
          >
            {t("desktop.providers.menu.remove")}
          </MenuItem>
        </Menu>
      </div>
      {props.steps === null ? null : (
        <div className="border-t border-border-subtle pt-3">
          <CheckSteps
            label={t("desktop.providers.check.label", { name: card.name })}
            steps={props.steps}
            disabled={!editable}
          />
        </div>
      )}
    </article>
  );
}

/** 알려진 제공자 고르기 카드(빈 상태와 추가 대화 상자). 누르는 카드라 hover에 테두리만 한 단계 올린다(DP-66) */
function ProviderPickCard(props: {
  readonly id: string | null;
  readonly disabled: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const name = props.id === null ? t("desktop.providers.custom.title") : providerNameOf(props.id);
  const sub =
    props.id === null ? t("desktop.providers.custom.sub") : (providerHostOf(props.id) ?? props.id);
  return (
    <button
      type="button"
      data-slot="provider-pick"
      disabled={props.disabled}
      onClick={props.onPick}
      className="flex min-h-14 min-w-0 items-center gap-2 rounded-lg bg-surface-base px-3 py-2 text-start shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] transition-shadow outline-none hover:shadow-[inset_0_0_0_1px_var(--cs-color-border-strong)] focus-visible:focus-ring disabled:opacity-50"
    >
      {props.id === null ? (
        <span
          aria-hidden
          className="flex size-7 flex-none items-center justify-center rounded-md bg-neutral-soft text-text-secondary"
        >
          <Plus className="size-icon-sm" />
        </span>
      ) : (
        <ProviderMark mark={providerMarkOf(props.id)} />
      )}
      <span className="grid min-w-0">
        <span className="truncate text-ui font-medium text-text-primary">{name}</span>
        <span className="truncate text-ui-sm text-text-tertiary">{sub}</span>
      </span>
    </button>
  );
}

function PickGrid(props: {
  readonly addable: readonly string[];
  readonly disabled: boolean;
  readonly onPick: (id: string) => void;
  readonly onCustom: () => void;
}): ReactNode {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-2 @[30rem]:grid-cols-2">
        {props.addable.map((id) => (
          <ProviderPickCard
            key={id}
            id={id}
            disabled={props.disabled}
            onPick={() => {
              props.onPick(id);
            }}
          />
        ))}
        <ProviderPickCard id={null} disabled={props.disabled} onPick={props.onCustom} />
      </div>
    </div>
  );
}

export interface ProvidersViewProps {
  readonly cards: readonly ProviderCard[] | null;
  /** 읽을 수 없는 값의 안내. 있으면 카드 대신 이것만 */
  readonly unreadable: string | null;
  readonly editable: boolean;
  readonly lockedText: string | null;
  readonly error: string | null;
  readonly addable: readonly string[];
  readonly steps: Readonly<Record<string, readonly CheckStep[]>>;
  readonly handlers: ProviderCardHandlers & {
    readonly onAdd: () => void;
    readonly onPick: (id: string) => void;
    readonly onCustom: () => void;
  };
}

/** 제공자 구역: 머리 + 카드 격자(빈 상태면 고르기 격자) */
export function ProvidersView(props: ProvidersViewProps): ReactNode {
  const { cards, editable, handlers } = props;
  const empty = cards !== null && cards.length === 0;
  const headingId = useId();
  // 카드 격자는 카드 안 카드가 되지 않게 바깥 카드 없이 둔다. 머리는 SettingSection과 같은 모양이다(DP-79, DP-83)
  const end =
    empty || props.unreadable !== null ? undefined : (
      <Button
        size={FORM_CONTROL_SIZE}
        variant="ghost"
        disabled={!editable}
        onClick={handlers.onAdd}
      >
        <Plus aria-hidden />
        {t("desktop.providers.add")}
      </Button>
    );
  return (
    <section data-slot="setting-section" aria-labelledby={headingId} className="pt-10 first:pt-0">
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <h2 id={headingId} className="m-0 min-w-0 flex-1 text-title-2 text-text-primary">
          {t("desktop.providers.title")}
        </h2>
        {end}
      </div>
      <div data-slot="providers-body" className="grid gap-2">
        {props.unreadable !== null ? <UnreadableNote message={props.unreadable} /> : null}
        {props.unreadable === null && empty ? (
          <div data-slot="providers-empty" className="grid gap-3">
            <p className="m-0 text-ui text-text-secondary">{t("desktop.providers.empty.lead")}</p>
            <PickGrid
              addable={props.addable}
              disabled={!editable}
              onPick={handlers.onPick}
              onCustom={handlers.onCustom}
            />
          </div>
        ) : null}
        {props.unreadable === null && cards !== null && cards.length > 0 ? (
          <div className="@container">
            <div
              data-slot="provider-grid"
              className="grid grid-cols-1 items-start gap-2 @[32rem]:grid-cols-2"
            >
              {cards.map((card) => (
                <ProviderCardView
                  key={card.id}
                  card={card}
                  editable={editable}
                  steps={props.steps[card.id] ?? null}
                  handlers={handlers}
                />
              ))}
            </div>
          </div>
        ) : null}
        {props.lockedText === null ? null : <LockLine text={props.lockedText} />}
        <ErrorLine text={props.error} />
      </div>
    </section>
  );
}

// ── 제공자 추가 대화 상자 ─────────────────────────────────────────────────

export interface AddProviderDialogProps {
  readonly open: boolean;
  /** 고르기 대신 다른 제공자 칸을 보이는가 */
  readonly custom: boolean;
  readonly addable: readonly string[];
  readonly draftId: string;
  readonly draftBaseUrl: string;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onPick: (id: string) => void;
  readonly onCustom: () => void;
  readonly onDraftId: (text: string) => void;
  readonly onDraftBaseUrl: (text: string) => void;
  readonly onSubmitCustom: () => void;
  readonly onClose: () => void;
}

export function AddProviderDialog(props: AddProviderDialogProps): ReactNode {
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.providers.add")}
      description={
        props.custom ? t("desktop.providers.custom.lead") : t("desktop.providers.addLead")
      }
    >
      {props.custom ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitCustom();
          }}
        >
          <Field label={t("desktop.providers.custom.id")} size={FORM_CONTROL_SIZE}>
            <Input
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.medium}
              className="font-mono"
              value={props.draftId}
              placeholder={t("desktop.providers.custom.idPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={props.busy}
              onValueChange={props.onDraftId}
            />
          </Field>
          <Field label={t("desktop.providers.baseUrl.label")} size={FORM_CONTROL_SIZE}>
            <Input
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.full}
              className="font-mono"
              value={props.draftBaseUrl}
              placeholder="https://"
              autoComplete="off"
              spellCheck={false}
              disabled={props.busy}
              onValueChange={props.onDraftBaseUrl}
            />
          </Field>
          <ErrorLine text={props.error} />
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              disabled={props.busy}
              onClick={props.onClose}
            >
              {t("desktop.providers.cancel")}
            </Button>
            <Button type="submit" size={FORM_CONTROL_SIZE} variant="solid" loading={props.busy}>
              {t("desktop.providers.custom.submit")}
            </Button>
          </div>
        </form>
      ) : (
        <PickGrid
          addable={props.addable}
          disabled={props.busy}
          onPick={props.onPick}
          onCustom={props.onCustom}
        />
      )}
    </Dialog>
  );
}

// ── 키 넣기 (붙여 넣기 또는 저장된 키) ────────────────────────────────────

/** 키 칸의 방식. 붙여 넣기는 새 시크릿을 만들고, 저장된 키는 있는 시크릿을 가리킨다 */
export type KeySource = "paste" | "pick";

/**
 * 키 입력 칸. 붙여 넣기 칸은 비제어 password 입력이라 값은 DOM에만 있다. 제출하면 `take()`가 읽는 즉시 비운다.
 * 저장된 키가 있으면 위에 [붙여 넣기 | 저장된 키] 고르기가 있다.
 */
function KeyInput(props: {
  readonly source: KeySource;
  readonly secretName: string;
  readonly secrets: readonly string[];
  readonly picked: string | null;
  readonly busy: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onSource: (source: KeySource) => void;
  readonly onPicked: (name: string) => void;
}): ReactNode {
  // 입력 참조는 따로 꺼낸다. props째로 들고 있으면 다른 props를 읽는 것도 참조 읽기로 본다(react refs 규칙)
  const { inputRef, busy } = props;
  return (
    <div className="grid gap-3">
      {props.secrets.length === 0 ? null : (
        <SegmentedControl
          size={FORM_CONTROL_SIZE}
          aria-label={t("desktop.providers.key.source")}
          value={props.source}
          className="justify-self-start"
          onValueChange={(value) => {
            props.onSource(value === "pick" ? "pick" : "paste");
          }}
        >
          <SegmentedControlItem value="paste">
            {t("desktop.providers.key.paste")}
          </SegmentedControlItem>
          <SegmentedControlItem value="pick">
            {t("desktop.providers.key.pick")}
          </SegmentedControlItem>
        </SegmentedControl>
      )}
      {props.source === "paste" ? (
        <Field
          label={t("desktop.providers.key.valueLabel")}
          size={FORM_CONTROL_SIZE}
          hint={t("desktop.providers.key.where", { secret: props.secretName })}
        >
          <Input
            ref={inputRef}
            size={FORM_CONTROL_SIZE}
            type="password"
            containerClassName={FIELD_WIDTH.full}
            placeholder={t("desktop.providers.key.placeholder")}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            defaultValue=""
            disabled={busy}
          />
        </Field>
      ) : (
        <Field label={t("desktop.providers.key.pickLabel")} size={FORM_CONTROL_SIZE}>
          <Select
            size={FORM_CONTROL_SIZE}
            className={FIELD_WIDTH.medium}
            value={props.picked ?? ""}
            placeholder={t("desktop.providers.key.pickPlaceholder")}
            disabled={busy}
            onValueChange={props.onPicked}
          >
            {props.secrets.map((name) => (
              <SelectOption key={name} value={name}>
                {name}
              </SelectOption>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}

/** 키 연결 대화 상자의 단계 */
export type KeyDialogPhase =
  | { readonly kind: "entry"; readonly error: KeyErrorText | null }
  /** 호스트가 자기 창에서 값을 받는다. 다 넣으면 시험한다 */
  | { readonly kind: "hostWindow" }
  | { readonly kind: "checking"; readonly steps: readonly CheckStep[] };

export interface KeyDialogProps {
  readonly open: boolean;
  readonly providerName: string;
  readonly secretName: string;
  readonly phase: KeyDialogPhase;
  readonly source: KeySource;
  readonly secrets: readonly string[];
  readonly picked: string | null;
  readonly busy: boolean;
  readonly onSource: (source: KeySource) => void;
  readonly onPicked: (name: string) => void;
  readonly onSubmitPaste: (field: KeyField) => void;
  readonly onSubmitPick: () => void;
  readonly onHostDone: () => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

export function KeyDialog(props: KeyDialogProps): ReactNode {
  const input = useRef<HTMLInputElement | null>(null);
  const { phase } = props;
  const clear = (): void => {
    if (input.current !== null) input.current.value = "";
  };
  const close = (): void => {
    clear();
    props.onClose();
  };
  const running = phase.kind === "checking" && phase.steps.some((s) => s.state === "running");
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t("desktop.providers.keyDialog.title", { name: props.providerName })}
    >
      {phase.kind === "entry" ? (
        <form
          className="grid gap-3"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            if (props.source === "pick") {
              props.onSubmitPick();
              return;
            }
            props.onSubmitPaste({
              take: () => {
                const typed = input.current?.value ?? "";
                clear();
                return typed;
              },
            });
          }}
        >
          <KeyInput
            source={props.source}
            secretName={props.secretName}
            secrets={props.secrets}
            picked={props.picked}
            busy={props.busy}
            inputRef={input}
            onSource={props.onSource}
            onPicked={props.onPicked}
          />
          <ErrorLine text={phase.error?.text ?? null} fix={phase.error?.fix} />
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              disabled={props.busy}
              onClick={close}
            >
              {t("desktop.providers.cancel")}
            </Button>
            <Button
              type="submit"
              size={FORM_CONTROL_SIZE}
              variant="solid"
              loading={props.busy}
              disabled={props.source === "pick" && props.picked === null}
            >
              {t("desktop.providers.key.submit")}
            </Button>
          </div>
        </form>
      ) : null}
      {phase.kind === "hostWindow" ? (
        <div className="grid gap-3">
          <p className="m-0 text-ui text-text-secondary">{t("desktop.providers.key.hostWindow")}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size={FORM_CONTROL_SIZE} variant="ghost" onClick={close}>
              {t("desktop.providers.cancel")}
            </Button>
            <Button
              size={FORM_CONTROL_SIZE}
              variant="solid"
              loading={props.busy}
              onClick={props.onHostDone}
            >
              {t("desktop.providers.key.hostDone")}
            </Button>
          </div>
        </div>
      ) : null}
      {phase.kind === "checking" ? (
        <div className="grid gap-4">
          <CheckSteps
            label={t("desktop.providers.check.label", { name: props.providerName })}
            steps={phase.steps}
            onRetry={props.onRetry}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button size={FORM_CONTROL_SIZE} variant="solid" disabled={running}>
                {t("desktop.providers.key.done")}
              </Button>
            </DialogClose>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ── 기본 URL, 빼기 ──────────────────────────────────────────────────────

export function BaseUrlDialog(props: {
  readonly open: boolean;
  readonly providerName: string;
  readonly draft: string;
  readonly error: string | null;
  readonly onDraft: (text: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.providers.baseUrl.title", { name: props.providerName })}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
      >
        <Field
          label={t("desktop.providers.baseUrl.label")}
          size={FORM_CONTROL_SIZE}
          hint={t("desktop.providers.baseUrl.hint")}
        >
          <Input
            size={FORM_CONTROL_SIZE}
            containerClassName={FIELD_WIDTH.full}
            className="font-mono"
            value={props.draft}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            onValueChange={props.onDraft}
          />
        </Field>
        <ErrorLine text={props.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size={FORM_CONTROL_SIZE} variant="ghost" onClick={props.onClose}>
            {t("desktop.providers.cancel")}
          </Button>
          <Button type="submit" size={FORM_CONTROL_SIZE} variant="solid">
            {t("desktop.providers.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoveProviderDialog(props: {
  readonly open: boolean;
  readonly providerName: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("desktop.providers.remove.title", { name: props.providerName })}
      description={t("desktop.providers.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button size={FORM_CONTROL_SIZE} variant="outline" autoFocus>
              {t("desktop.providers.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={props.onConfirm}>
            {t("desktop.providers.remove.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}

// ── 계정 풀과 회전 ───────────────────────────────────────────────────────

export interface RotationRowProps {
  /** null이면 엔진 카탈로그에 회전 키가 없다 */
  readonly state: RotationState | null;
  readonly notice: string;
  readonly pools: readonly ProviderPool[];
  readonly editable: boolean;
  readonly lockedText: string | null;
  readonly error: string | null;
  readonly asking: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 회전 줄의 보조 글: 무엇이 도는지. 꺼짐, 돌 계정 없음, "Anthropic 2개 · OpenAI 3개를 차례로 써요" */
export function rotationSummaryOf(
  state: RotationState | null,
  pools: readonly ProviderPool[],
): string {
  if (state !== "on") return t("desktop.providers.rotation.summary.off");
  const rotating = pools.filter((pool) => pool.accounts.length > 1);
  if (rotating.length === 0) return t("desktop.providers.rotation.summary.none");
  const list = rotating
    .map((pool) =>
      t("desktop.providers.rotation.summary.pool", {
        name: providerNameOf(pool.provider),
        count: pool.accounts.length,
      }),
    )
    .join(" · ");
  return t("desktop.providers.rotation.summary.on", { list });
}

/** 회전 줄: 이름표 + 정보 아이콘(위험 고지 전문) + 무엇이 도는지(보조 글), 오른쪽 스위치. 배지를 따로 두지 않는다 */
export function RotationRow(props: RotationRowProps): ReactNode {
  const title = t("desktop.providers.rotation.title");
  return (
    <>
      <SettingRow
        slot="rotation-row"
        label={title}
        info={[t("desktop.providers.rotation.help"), props.notice]}
        description={rotationSummaryOf(props.state, props.pools)}
        control={
          <Switch
            size={FORM_CONTROL_SIZE}
            aria-label={title}
            checked={props.state === "on"}
            disabled={!props.editable}
            onCheckedChange={props.onToggle}
          />
        }
        notes={
          props.lockedText !== null || props.error !== null ? (
            <>
              {props.lockedText === null ? null : <LockLine text={props.lockedText} />}
              <ErrorLine text={props.error} />
            </>
          ) : undefined
        }
      />
      <Dialog
        kind="alert"
        size="sm"
        tone="warning"
        open={props.asking}
        onOpenChange={(open) => {
          if (!open) props.onCancel();
        }}
        title={t("desktop.providers.rotation.confirm.title")}
        description={props.notice}
        footer={
          <>
            <DialogClose asChild>
              <Button size={FORM_CONTROL_SIZE} variant="outline" autoFocus>
                {t("desktop.providers.rotation.confirm.cancel")}
              </Button>
            </DialogClose>
            <Button size={FORM_CONTROL_SIZE} variant="solid" onClick={props.onConfirm}>
              {t("desktop.providers.rotation.confirm.accept")}
            </Button>
          </>
        }
      />
    </>
  );
}

export interface AccountPoolProps {
  readonly pools: readonly ProviderPool[];
  readonly expanded: ReadonlySet<string>;
  readonly editable: boolean;
  readonly onExpand: (provider: string) => void;
  readonly onMove: (provider: string, orderedIds: readonly string[]) => void;
  readonly onReserve: (entry: AccountEntry, reservePct: number) => void;
  readonly onRemove: (entry: AccountEntry) => void;
}

/** 계정 줄 끝: 예비 %(짧은 폭) · ⋯(빼기) */
function AccountEnd(props: {
  readonly entry: AccountEntry;
  readonly editable: boolean;
  readonly onReserve: (entry: AccountEntry, reservePct: number) => void;
  readonly onRemove: (entry: AccountEntry) => void;
}): ReactNode {
  const { entry } = props;
  return (
    <span className="flex items-center gap-2">
      <span className="text-ui text-text-tertiary">{t("desktop.providers.field.reservePct")}</span>
      <NumberField
        size={FORM_CONTROL_SIZE}
        unit="%"
        containerClassName={FIELD_WIDTH.short}
        aria-label={t("desktop.providers.pool.reserveLabel", { account: entry.accountId })}
        value={entry.reservePct}
        min={0}
        max={100}
        step={1}
        commitMode="release"
        disabled={!props.editable}
        onValueChange={(next) => {
          props.onReserve(entry, next);
        }}
      />
      <Menu
        align="end"
        trigger={
          <IconButton
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            label={t("desktop.providers.pool.menu", { account: entry.accountId })}
            disabled={!props.editable}
          >
            <Ellipsis />
          </IconButton>
        }
      >
        <MenuItem
          tone="danger"
          onSelect={() => {
            props.onRemove(entry);
          }}
        >
          {t("desktop.providers.pool.remove")}
        </MenuItem>
      </Menu>
    </span>
  );
}

/** 계정 목록: 제공자 묶음 머리(13/500 tertiary) 아래 순서 목록. 빈 풀은 한 줄 안내 */
export function AccountPool(props: AccountPoolProps): ReactNode {
  if (props.pools.length === 0) {
    return (
      <p data-slot="pool-empty" className="m-0 text-ui text-text-tertiary">
        {t("desktop.providers.pool.emptyLead")}
      </p>
    );
  }
  return (
    <div data-slot="account-pool" className="grid gap-4">
      {props.pools.map((pool) => {
        const fold = foldOf(pool.accounts, props.expanded.has(pool.provider));
        const items: OrderedItem[] = fold.shown.map((entry) => ({
          id: entry.accountId,
          title: entry.accountId,
          detail: (
            <span className="font-mono text-mono-sm text-text-tertiary">
              {entry.credential.replace(/^secret:\/\//, "")}
            </span>
          ),
          end: (
            <AccountEnd
              entry={entry}
              editable={props.editable}
              onReserve={props.onReserve}
              onRemove={props.onRemove}
            />
          ),
        }));
        return (
          <div key={pool.provider} className="grid gap-1">
            <span className="text-ui font-medium text-text-tertiary">
              {providerNameOf(pool.provider)}
            </span>
            <OrderedList
              label={t("desktop.providers.pool.listLabel", {
                provider: providerNameOf(pool.provider),
              })}
              items={items}
              editable={props.editable}
              numbered
              onMove={(order) => {
                props.onMove(pool.provider, order);
              }}
            />
            {fold.hidden === 0 ? null : (
              <div className="flex items-center gap-2">
                <span className="text-ui text-text-tertiary">
                  {t("desktop.providers.pool.hidden", { count: fold.hidden })}
                </span>
                <Button
                  size={FORM_CONTROL_SIZE}
                  variant="ghost"
                  onClick={() => {
                    props.onExpand(pool.provider);
                  }}
                >
                  {t("desktop.providers.pool.expand")}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface AddAccountDialogProps {
  readonly open: boolean;
  readonly providers: readonly string[];
  readonly provider: string | null;
  readonly accountId: string;
  readonly secretName: string;
  readonly source: KeySource;
  readonly secrets: readonly string[];
  readonly picked: string | null;
  readonly busy: boolean;
  readonly error: KeyErrorText | null;
  readonly onProvider: (id: string) => void;
  readonly onAccountId: (text: string) => void;
  readonly onSource: (source: KeySource) => void;
  readonly onPicked: (name: string) => void;
  readonly onSubmit: (field: KeyField) => void;
  readonly onClose: () => void;
}

/** 계정 추가: 제공자 · 계정 이름 · 키(붙여 넣기 또는 저장된 키) 한 상자 */
export function AddAccountDialog(props: AddAccountDialogProps): ReactNode {
  const input = useRef<HTMLInputElement | null>(null);
  const clear = (): void => {
    if (input.current !== null) input.current.value = "";
  };
  return (
    <Dialog
      kind="dialog"
      size="md"
      open={props.open}
      onOpenChange={(next) => {
        if (!next) {
          clear();
          props.onClose();
        }
      }}
      title={t("desktop.providers.pool.add")}
      description={t("desktop.providers.pool.addLead")}
    >
      <form
        className="grid gap-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit({
            take: () => {
              const typed = input.current?.value ?? "";
              clear();
              return typed;
            },
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("desktop.providers.field.provider")} size={FORM_CONTROL_SIZE}>
            <Select
              size={FORM_CONTROL_SIZE}
              className={FIELD_WIDTH.full}
              value={props.provider ?? ""}
              placeholder={t("desktop.providers.pool.providerPlaceholder")}
              disabled={props.busy}
              onValueChange={props.onProvider}
            >
              {props.providers.map((id) => (
                <SelectOption key={id} value={id}>
                  {providerNameOf(id)}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <Field label={t("desktop.providers.field.accountId")} size={FORM_CONTROL_SIZE}>
            <Input
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.full}
              value={props.accountId}
              placeholder={t("desktop.providers.pool.accountPlaceholder")}
              spellCheck={false}
              disabled={props.busy}
              onValueChange={props.onAccountId}
            />
          </Field>
        </div>
        <KeyInput
          source={props.source}
          secretName={props.secretName}
          secrets={props.secrets}
          picked={props.picked}
          busy={props.busy}
          inputRef={input}
          onSource={props.onSource}
          onPicked={props.onPicked}
        />
        <ErrorLine text={props.error?.text ?? null} fix={props.error?.fix} />
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={props.busy}
            onClick={() => {
              clear();
              props.onClose();
            }}
          >
            {t("desktop.providers.cancel")}
          </Button>
          <Button type="submit" size={FORM_CONTROL_SIZE} variant="solid" loading={props.busy}>
            {t("desktop.providers.pool.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── 쓸 모델 ─────────────────────────────────────────────────────────────

function ModelAccessLine(props: {
  readonly row: ModelAccessRow;
  readonly editable: boolean;
  readonly onUsable: (ref: string, usable: boolean) => void;
}): ReactNode {
  const { row } = props;
  const option = row.entry === null ? null : (modelOptionsOf([row.entry], null, null)[0] ?? null);
  const meta = option === null ? null : modelMetaText(option);
  const name = row.pattern ? t("desktop.models.list.pattern", { name: row.label }) : row.label;
  return (
    <li
      data-slot="model-access-row"
      data-usable={row.usable}
      className="flex min-h-9 min-w-0 items-center gap-3 rounded-md px-2 hover:bg-neutral-hover"
    >
      <span
        className={`min-w-0 flex-1 truncate text-ui ${row.usable ? "text-text-primary" : "text-text-tertiary"}`}
      >
        {name}
      </span>
      {meta === null ? null : (
        <span className="flex-none font-mono text-mono-sm text-text-tertiary tabular-nums">
          {meta}
        </span>
      )}
      {row.usable ? null : (
        <span className="flex-none text-ui-sm text-text-tertiary">
          {t("desktop.models.list.blocked")}
        </span>
      )}
      <Switch
        size={FORM_CONTROL_SIZE}
        aria-label={t("desktop.models.list.rowLabel", { name })}
        checked={row.usable}
        disabled={!props.editable}
        onCheckedChange={(next) => {
          props.onUsable(row.ref, next);
        }}
      />
    </li>
  );
}

/** 모델 목록: 위 찾기 칸, 제공자 묶음 머리 아래 줄(36). 최대 높이 320에서 스크롤 */
export function ModelAccessList(props: {
  readonly models: readonly ModelEntry[];
  readonly denied: readonly string[];
  readonly query: string;
  readonly editable: boolean;
  readonly onQuery: (text: string) => void;
  readonly onUsable: (ref: string, usable: boolean) => void;
}): ReactNode {
  const total = props.models.length + props.denied.length;
  if (total === 0) {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.models.list.empty")}</p>;
  }
  const groups = modelAccessGroupsOf(props.models, props.denied, props.query);
  return (
    <div className="grid gap-2">
      <Input
        type="search"
        size={FORM_CONTROL_SIZE}
        containerClassName={FIELD_WIDTH.full}
        aria-label={t("desktop.models.list.search")}
        placeholder={t("desktop.models.list.search")}
        value={props.query}
        spellCheck={false}
        onValueChange={props.onQuery}
      />
      {groups.length === 0 ? (
        <p role="status" className="m-0 px-2 text-ui text-text-tertiary">
          {t("desktop.models.list.noMatch")}
        </p>
      ) : (
        <div data-slot="model-access-list" className="-mx-2 grid max-h-80 gap-2 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.provider} className="grid">
              <span className="px-2 pb-1 text-ui-sm font-medium text-text-tertiary">
                {providerNameOf(group.provider)}
              </span>
              <ul className="m-0 grid list-none p-0">
                {group.rows.map((row) => (
                  <ModelAccessLine
                    key={row.ref}
                    row={row}
                    editable={props.editable}
                    onUsable={props.onUsable}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 허용 규칙(고른 모델만 쓰기): 규칙 칩 + 제공자 빠른 칩 + 직접 입력 */
export function AllowedRules(props: {
  readonly rules: readonly string[];
  /** 빠른 칩으로 보일 제공자(아직 규칙에 없는 것) */
  readonly quick: readonly string[];
  readonly draft: string;
  readonly error: string | null;
  readonly editable: boolean;
  readonly onDraft: (text: string) => void;
  readonly onAdd: (rule: string) => void;
  readonly onRemove: (rule: string) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      {props.rules.length === 0 ? (
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.models.allowed.all")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {props.rules.map((rule) => (
            <li
              key={rule}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-soft ps-2 pe-0.5 font-mono text-mono-sm text-text-primary"
            >
              {rule}
              <IconButton
                size="xs"
                variant="ghost"
                label={t("desktop.models.allowed.remove", { rule })}
                disabled={!props.editable}
                onClick={() => {
                  props.onRemove(rule);
                }}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex min-w-0 flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onAdd(props.draft);
        }}
      >
        <Input
          size={FORM_CONTROL_SIZE}
          containerClassName={FIELD_WIDTH.medium}
          className="font-mono"
          aria-label={t("desktop.models.allowed.inputLabel")}
          placeholder="provider/model"
          value={props.draft}
          spellCheck={false}
          disabled={!props.editable}
          onValueChange={props.onDraft}
        />
        <Button type="submit" size={FORM_CONTROL_SIZE} variant="outline" disabled={!props.editable}>
          {t("desktop.models.allowed.add")}
        </Button>
        {props.quick.map((id) => (
          <Button
            key={id}
            type="button"
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={!props.editable}
            onClick={() => {
              props.onAdd(`${id}/*`);
            }}
          >
            <Plus aria-hidden />
            {t("desktop.models.list.pattern", { name: providerNameOf(id) })}
          </Button>
        ))}
      </form>
      <ErrorLine text={props.error} />
    </div>
  );
}

/** 쓸 모델 카드: 기본 모델 · 모델 목록 · 고른 모델만 쓰기 */
export function ModelPolicyView(props: {
  readonly defaultModel: string | null;
  readonly models: readonly ModelEntry[];
  readonly editable: {
    readonly default: boolean;
    readonly denied: boolean;
    readonly allowed: boolean;
  };
  readonly onDefault: (ref: string) => void;
  readonly access: ReactNode;
  readonly allowed: ReactNode;
  readonly notes: ReactNode;
}): ReactNode {
  return (
    <SettingSection title={t("desktop.models.title")}>
      <SettingRow
        slot="model-default"
        label={t("desktop.models.default.label")}
        info={t("desktop.models.default.info")}
        control={
          <ModelPicker
            value={props.defaultModel}
            choices={props.models}
            label={t("desktop.models.default.label")}
            disabled={!props.editable.default}
            onChange={props.onDefault}
          />
        }
        notes={props.notes}
      />
      <SettingRow
        slot="model-access"
        layout="stacked"
        label={t("desktop.models.list.label")}
        info={t("desktop.models.list.info")}
        control={props.access}
      />
      <SettingRow
        slot="model-allowed"
        layout="stacked"
        label={t("desktop.models.allowed.label")}
        info={t("desktop.models.allowed.info")}
        control={props.allowed}
      />
    </SettingSection>
  );
}

/** 계정 풀 카드: 회전 줄 + 계정 목록 */
export function AccountsView(props: {
  readonly rotation: ReactNode;
  readonly pool: ReactNode;
  readonly editable: boolean;
  readonly unreadable: string | null;
  readonly error: string | null;
  readonly onAdd: () => void;
}): ReactNode {
  return (
    <SettingSection
      title={t("desktop.providers.pool.title")}
      end={
        <Button
          size={FORM_CONTROL_SIZE}
          variant="ghost"
          disabled={!props.editable}
          onClick={props.onAdd}
        >
          <Plus aria-hidden />
          {t("desktop.providers.pool.add")}
        </Button>
      }
    >
      {props.rotation}
      <div className="grid gap-2">
        {props.unreadable === null ? props.pool : <UnreadableNote message={props.unreadable} />}
        <ErrorLine text={props.error} />
      </div>
    </SettingSection>
  );
}
