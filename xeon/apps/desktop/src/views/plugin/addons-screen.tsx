import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { extMessageOf } from "@fresnel/client/views/native";
import { assertNever } from "@fresnel/contracts";
import type { BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { Alert, Button, Chip, EmptyState } from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useShellActions } from "../../state/shell/index.ts";
import { useWorkbenchActions } from "../../state/workbench/index.ts";
import { ScreenHeader, HEADER_CONTROL_SIZE } from "../shell/screen-header.tsx";
import {
  addonCardsOf,
  openableScreensOf,
  type AddonCard,
  type AddonExtraKind,
  type AddonProblem,
  type AddonScreenRow,
} from "./addons-model.ts";
import { usePluginUiState } from "./plugin-context.tsx";
import { useAddonOpenRequest, usePluginPickRequest } from "./plugin-pick.ts";
import { PluginView } from "./plugin-view.tsx";

// "추가 기능" 화면(ADR-0021 §3.11, DP-72~74): 목록 → 플러그인 상세 → 화면 실행. 대화 영역 내비 항목 하나가 연다.
// 모델은 `addons-model.ts`(순수)이고 여기는 그리기와 이동 상태뿐이다. 실행 본문은 기존 `PluginView`다(보안 경계는 그대로).

const MUTED = "m-0 text-ui-dense text-text-secondary";
const SECTION_TITLE = "m-0 text-ui-dense font-medium text-text-primary";
const WIDTH = "mx-auto w-full max-w-[44rem] px-4";

type View =
  | { readonly kind: "list" }
  | { readonly kind: "detail"; readonly extension: string }
  | { readonly kind: "run"; readonly extension: string; readonly key: string };

const titleOf = (entry: ExtUiEntry): string =>
  extMessageOf(entry.messages, activeLocale(), entry.title);

const PROBLEM_TEXT: Readonly<Record<AddonProblem, MessageId>> = {
  off: "desktop.addons.problem.off",
  blocked: "desktop.addons.problem.blocked",
  invalid: "desktop.addons.problem.invalid",
};

const EXTRA_TEXT: Readonly<Record<AddonExtraKind, MessageId>> = {
  card: "desktop.addons.extras.card",
  status: "desktop.addons.extras.status",
  command: "desktop.addons.extras.command",
  settings: "desktop.addons.extras.settings",
};

const CAPABILITY_TEXT: Readonly<Record<BridgeCapability, MessageId>> = {
  files: "desktop.addons.access.cap.files",
  notify: "desktop.addons.access.cap.notify",
  settingsWrite: "desktop.addons.access.cap.settingsWrite",
  secrets: "desktop.addons.access.cap.secrets",
};

/** 이름 첫 글자 표지. 와이어에 아이콘이 없어 글자 하나를 중립 면에 둔다 */
function Mark(props: { readonly initial: string; readonly large?: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      className={`flex flex-none items-center justify-center rounded-md bg-surface-raised font-medium text-text-secondary ${
        props.large === true ? "size-12 text-[20px]" : "size-8 text-ui-dense"
      }`}
    >
      {props.initial}
    </span>
  );
}

function ProblemChip(props: { readonly problem: AddonProblem | null }): ReactNode {
  if (props.problem === null) return null;
  return (
    <Chip size="sm" tone={props.problem === "off" ? "neutral" : "warning"} variant="soft">
      {t(PROBLEM_TEXT[props.problem])}
    </Chip>
  );
}

function EmptyAddons(): ReactNode {
  const shell = useShellActions();
  const workbench = useWorkbenchActions();
  const toCraft = (): void => {
    shell.switchArea("workbench");
    shell.updatePlace({ screen: "extensions", scroll: 0 });
  };
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        size="md"
        surface="none"
        title={t("desktop.addons.empty.title")}
        description={t("desktop.addons.empty.body")}
        actions={
          <div className="flex gap-2">
            <Button size={HEADER_CONTROL_SIZE} variant="outline" onClick={toCraft}>
              {t("desktop.addons.empty.find")}
            </Button>
            <Button
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              onClick={() => {
                toCraft();
                workbench.requestBuilder(null);
              }}
            >
              {t("desktop.addons.empty.make")}
            </Button>
          </div>
        }
      />
    </div>
  );
}

function AddonList(props: {
  readonly cards: readonly AddonCard[];
  readonly onOpen: (extension: string) => void;
}): ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      <div className={`${WIDTH} flex flex-col gap-3 pt-2`}>
        <p className={MUTED}>{t("desktop.addons.list.intro")}</p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {props.cards.map((card) => (
            <li key={card.extension}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
                onClick={() => {
                  props.onOpen(card.extension);
                }}
              >
                <Mark initial={card.initial} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui-dense font-medium text-text-primary">
                    {card.extension}
                  </span>
                  <span className="truncate text-ui text-text-secondary">{card.summary}</span>
                </span>
                <ProblemChip problem={card.problem} />
                <span className="flex-none text-ui text-text-tertiary">
                  {t("desktop.addons.list.screens", { count: card.screens.length })}
                </span>
                <ChevronRight aria-hidden className="flex-none text-text-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function screenStateText(row: AddonScreenRow): MessageId {
  if (row.state === "invalid") return "desktop.addons.state.invalid";
  if (row.blocked) return "desktop.addons.state.blocked";
  if (row.off) return "desktop.addons.state.off";
  return "desktop.addons.state.ok";
}

function ScreenRow(props: {
  readonly row: AddonScreenRow;
  readonly onOpen: (key: string) => void;
}): ReactNode {
  const { row } = props;
  const openable = !row.off && !row.blocked && row.state === "ok";
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-dense text-text-primary">{row.title}</span>
        <span className="truncate text-ui text-text-tertiary">
          {t(row.mode === "app" ? "desktop.addons.screens.app" : "desktop.addons.screens.native")}
          {" · "}
          {t(screenStateText(row))}
        </span>
      </span>
      <Button
        size="xs"
        variant="outline"
        disabled={!openable}
        onClick={() => {
          props.onOpen(row.key);
        }}
      >
        {t("desktop.addons.detail.open")}
      </Button>
    </li>
  );
}

function statusTextOf(problem: AddonProblem | null): MessageId {
  if (problem === null) return "desktop.addons.status.healthy";
  switch (problem) {
    case "off":
      return "desktop.addons.status.off";
    case "blocked":
      return "desktop.addons.status.blocked";
    case "invalid":
      return "desktop.addons.status.invalid";
    default:
      return assertNever(problem, "statusTextOf");
  }
}

function AddonDetail(props: {
  readonly card: AddonCard;
  readonly onOpen: (key: string) => void;
}): ReactNode {
  const { card } = props;
  const shell = useShellActions();
  const workbench = useWorkbenchActions();
  const first = openableScreensOf(card)[0];
  const manage = (): void => {
    shell.switchArea("workbench");
    shell.updatePlace({ screen: "extensions", scroll: 0 });
    workbench.pickPlugin(card.extension);
    workbench.openDetail(card.extension);
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      <div className={`${WIDTH} flex flex-col gap-6 pt-2`}>
        <div className="flex items-center gap-3">
          <Mark initial={card.initial} large />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="m-0 truncate text-[16px] font-medium text-text-primary">
              {card.extension}
            </h2>
            <span className="truncate text-ui-dense text-text-secondary">{card.summary}</span>
            <span className="truncate text-ui text-text-tertiary">
              {t("desktop.addons.detail.meta", {
                version: card.version,
                trust: t(
                  `client.view.confirm.trust.${card.trust === "managed" ? "user" : card.trust}`,
                ),
              })}
            </span>
          </div>
          <Button size={HEADER_CONTROL_SIZE} variant="outline" onClick={manage}>
            {t("desktop.addons.detail.manage")}
          </Button>
          {first === undefined ? null : (
            <Button
              size={HEADER_CONTROL_SIZE}
              variant="solid"
              onClick={() => {
                props.onOpen(first.key);
              }}
            >
              {t("desktop.addons.detail.open")}
            </Button>
          )}
        </div>

        <Section title={t("desktop.addons.screens.title", { count: card.screens.length })}>
          <ul className="m-0 flex list-none flex-col p-0">
            {card.screens.map((row) => (
              <ScreenRow key={row.key} row={row} onOpen={props.onOpen} />
            ))}
          </ul>
        </Section>

        {card.extras.length === 0 ? null : (
          <Section title={t("desktop.addons.extras.title", { count: card.extras.length })}>
            <ul className="m-0 flex list-none flex-col p-0">
              {card.extras.map((extra) => (
                <li key={`${extra.kind}/${extra.id}`} className="flex items-baseline gap-3 py-1">
                  <span className="min-w-0 flex-1 truncate text-ui-dense text-text-primary">
                    {extra.title}
                  </span>
                  <span className="flex-none text-ui text-text-tertiary">
                    {t(EXTRA_TEXT[extra.kind])}
                  </span>
                </li>
              ))}
            </ul>
            <p className={MUTED}>{t("desktop.addons.extras.switchHint")}</p>
          </Section>
        )}

        <Section title={t("desktop.addons.access.title")}>
          {card.hasFrame ? (
            <>
              <p className={MUTED}>{t("desktop.addons.access.frame")}</p>
              {card.capabilities.length === 0 ? null : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-ui text-text-tertiary">
                    {t("desktop.addons.access.capabilities")}
                  </span>
                  {card.capabilities.map((name) => (
                    <Chip key={name} size="sm" tone="neutral" variant="soft">
                      {t(CAPABILITY_TEXT[name])}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className={MUTED}>{t("desktop.addons.access.none")}</p>
          )}
        </Section>

        <Section title={t("desktop.addons.status.title")}>
          {card.problem === null ? (
            <p className={MUTED}>{t(statusTextOf(null))}</p>
          ) : (
            <Alert tone={card.problem === "off" ? "neutral" : "warning"} layout="inline">
              {t(statusTextOf(card.problem))}
            </Alert>
          )}
          {card.issues > 0 ? (
            <p className={MUTED}>{t("desktop.addons.status.issues", { count: card.issues })}</p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

/** 추가 기능 화면. 사이드바 행(고른 화면)과 크래프트 상세(플러그인 하나)가 보낸 요청을 받아 바로 열린다 */
export function AddonsScreen(): ReactNode {
  const state = usePluginUiState();
  const cards = addonCardsOf(state, titleOf);
  const pick = usePluginPickRequest();
  const open = useAddonOpenRequest();
  const initial = (): View => {
    if (pick !== undefined) {
      const found = state.entries.find((entry) => `${entry.extension}/${entry.id}` === pick.key);
      if (found !== undefined) return { kind: "run", extension: found.extension, key: pick.key };
    }
    if (open !== undefined) return { kind: "detail", extension: open.extension };
    return { kind: "list" };
  };
  const [view, setView] = useState<View>(initial);
  const [seenPick, setSeenPick] = useState(pick?.seq);
  const [seenOpen, setSeenOpen] = useState(open?.seq);
  // 화면이 떠 있는 동안 온 새 요청은 마지막으로 온 것을 따른다
  if (pick !== undefined && pick.seq !== seenPick) {
    setSeenPick(pick.seq);
    const found = state.entries.find((entry) => `${entry.extension}/${entry.id}` === pick.key);
    if (found !== undefined) setView({ kind: "run", extension: found.extension, key: pick.key });
  }
  if (open !== undefined && open.seq !== seenOpen) {
    setSeenOpen(open.seq);
    setView({ kind: "detail", extension: open.extension });
  }
  const toList = (): void => {
    setView({ kind: "list" });
  };

  if (view.kind === "run") {
    const entry = state.entries.find((item) => `${item.extension}/${item.id}` === view.key);
    if (entry !== undefined) {
      return (
        <PluginView
          key={`${view.key}@${entry.version}`}
          entry={entry}
          back={{
            label: t("desktop.addons.run.back", { name: view.extension }),
            onClick: () => {
              setView({ kind: "detail", extension: view.extension });
            },
          }}
        />
      );
    }
  }
  const card =
    view.kind === "list" ? undefined : cards.find((item) => item.extension === view.extension);
  const detail = view.kind !== "list" && card !== undefined;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t("desktop.addons.title")}
        lead={
          detail ? (
            <Button size={HEADER_CONTROL_SIZE} variant="ghost" onClick={toList}>
              {t("desktop.addons.detail.back")}
            </Button>
          ) : undefined
        }
      />
      {cards.length === 0 ? (
        <EmptyAddons />
      ) : detail ? (
        <AddonDetail
          card={card}
          onOpen={(key) => {
            setView({ kind: "run", extension: card.extension, key });
          }}
        />
      ) : (
        <AddonList
          cards={cards}
          onOpen={(extension) => {
            setView({ kind: "detail", extension });
          }}
        />
      )}
    </section>
  );
}
