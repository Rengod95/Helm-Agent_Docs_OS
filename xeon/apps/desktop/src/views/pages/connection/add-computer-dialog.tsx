import type { TargetEntry } from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  Badge,
  Button,
  ChoiceGroup,
  ChoiceGroupItem,
  Dialog,
  Input,
  Skeleton,
  Stepper,
  type StepperStep,
} from "@caustic/react";
import { Check, ChevronDown, ChevronRight } from "@caustic/react/icons";
import { useEffect, useId, useReducer, useState, type KeyboardEvent, type ReactNode } from "react";
import type { SshHostsReply } from "../../../transport/ipc.ts";
import { useCommands } from "../../commands.ts";
import { isCommitEnter } from "../../ime-enter.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { CheckInline, CheckSteps, type CheckStep } from "../shared/check-steps.tsx";
import { CommandLine } from "../shared/copyable.tsx";
import { groupedValue, TrustBox } from "../shared/trust-box.tsx";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote } from "../settings/settings-section.tsx";
import {
  ADD_STEPS,
  addMethodOf,
  addReducer,
  canPair,
  canStart,
  checkRowsOf,
  initialAddState,
  parseSshInput,
  pinnedOf,
  probeNoticeOf,
  saveProblemOf,
  socketTextOk,
  sshSavedAddressOf,
  sshTargetOfDraft,
  webEndpointOf,
  type AddAction,
  type AddMethod,
  type AddState,
  type AddStep,
  type CheckRow,
  type Msg,
  type ProbeNotice,
} from "./add-computer-model.ts";
import { runPreflight } from "./connection-probe-container.tsx";
import {
  fingerprintFailureKeyOf,
  hostDisplayOf,
  pairFailureKeyOf,
  PAIR_DEVICE_NAME,
  stopLineOf,
  type ProbeRunArgs,
  type ProbeState,
} from "./connection-probe-model.ts";
import { stepperLive } from "../../thinking-indicator.tsx";

// "컴퓨터 추가" wizard(시안 §5.2, DP-115, DP-186). caustic Dialog(md) + 가로 Stepper(방식 · 점검 · 저장, 렌즈 마디). 본문은 최소 320px라서
// 단계가 바뀌어도 대화 상자 높이가 출렁이지 않는다. 점검을 통과하기 전에는 저장 단추가 없다.
//   방식  두 카드(2열). SSH면 ssh 설정 목록(listbox, 줄 36, 5줄까지 보이고 스크롤) + 직접 입력 한 칸 + 접힌 고급(서비스 주소).
//         웹이면 주소 한 칸.
//   점검  SSH: 사전 점검 여섯 줄(CheckSteps)이 실시간으로 바뀐다. 멈추면 그 아래 진행 패널 안에서 호스트 키 확인(TrustBox),
//         비밀번호만이면 ssh-copy-id 명령 한 줄, Fresnel 없음·버전 다름 문장. 통과하면 저장 단계로 넘어간다.
//         웹: 확인 값 재기(CheckInline) → 확인 값 상자 → 연결 코드 한 칸(5자 뒤 하이픈 자동) → [연결].
//   저장  통과 줄 + 이름 칸(제안 이름) + [저장만] [저장하고 연결].
// 본문(`AddComputerBody`)과 바닥(`AddComputerFooter`)은 상태와 콜백만 받는 그림이라 서버 렌더 시험이 직접 그린다.

/** ssh 설정 목록 읽기 */
export type HostsRead =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly reply: SshHostsReply }
  | { readonly kind: "failed" };

type SshHost = SshHostsReply["hosts"][number];

function hostsOf(read: HostsRead): readonly SshHost[] {
  return read.kind === "ready" ? read.reply.hosts : [];
}

function text(msg: Msg): string {
  return t(msg.key, msg.args);
}

const LABEL = "text-ui font-medium text-text-primary";
const SUB_HEAD = "text-ui-sm text-text-tertiary";

// ── 점검 패널(카드의 연결 시험도 쓴다) ───────────────────────────────────

function stepOf(row: CheckRow): CheckStep {
  return {
    id: row.id,
    label: text(row.label),
    state: row.state,
    detail: row.detail === null ? null : text(row.detail),
    fix: row.fix === null ? null : text(row.fix),
    elapsedMs: row.elapsedMs,
  };
}

/** 멈춘 자리의 안내. 호스트 키는 확인 값 상자와 믿기·바꾸기, 나머지는 문장과 복사할 명령이다 */
function ProbeNoticeView(props: {
  readonly notice: ProbeNotice;
  readonly busy: boolean;
  readonly onRun: (args: ProbeRunArgs) => void;
  readonly onCopy: (text: string) => void;
}): ReactNode {
  const { notice, busy, onRun, onCopy } = props;
  switch (notice.kind) {
    case "hostKey": {
      const { prompt } = notice;
      return (
        <TrustBox
          slot="host-key-box"
          tone={prompt.replace ? "danger" : "neutral"}
          message={t(
            prompt.replace
              ? "desktop.connection.add.hostKey.changed"
              : "desktop.connection.add.hostKey.new",
          )}
          valueLabel={t("desktop.connection.add.hostKey.label", { type: prompt.keyType })}
          value={prompt.fingerprint}
          actions={
            prompt.replace ? (
              <Button
                size={FORM_CONTROL_SIZE}
                variant="outline"
                disabled={busy}
                onClick={() => {
                  onRun({
                    trustHostKey: { fingerprint: prompt.fingerprint },
                    replaceChangedHostKey: true,
                  });
                }}
              >
                {t("desktop.connection.add.hostKey.replace")}
              </Button>
            ) : (
              <Button
                size={FORM_CONTROL_SIZE}
                variant="solid"
                disabled={busy}
                onClick={() => {
                  onRun({ trustHostKey: { fingerprint: prompt.fingerprint } });
                }}
              >
                {t("desktop.connection.add.hostKey.trust")}
              </Button>
            )
          }
        />
      );
    }
    case "passwordOnly":
      return (
        <div data-slot="password-only" className="grid gap-2">
          <p className="m-0 text-ui text-text-secondary">
            {t("desktop.connection.add.passwordOnly")}
          </p>
          {notice.commands.map((command) => (
            <CommandLine key={command} text={command} onCopy={onCopy} />
          ))}
        </div>
      );
    case "notInstalled":
      return (
        <p data-slot="not-installed" className="m-0 text-ui text-text-secondary">
          {t("desktop.connection.add.notInstalled")}
        </p>
      );
    case "version":
      return (
        <div data-slot="version-mismatch" className="grid gap-1">
          <p className="m-0 font-mono text-mono-sm text-text-primary">
            {t("desktop.connection.add.version.values", {
              local: notice.local,
              remote: notice.remote,
            })}
          </p>
          <p className="m-0 text-ui text-text-secondary">
            {t(
              notice.lower === "local"
                ? "desktop.connection.add.version.fixLocal"
                : "desktop.connection.add.version.fixRemote",
            )}
          </p>
        </div>
      );
    case "commands":
      return (
        <div className="grid gap-2">
          {notice.commands.map((command) => (
            <CommandLine key={command} text={command} onCopy={onCopy} />
          ))}
        </div>
      );
    case "requestFailed":
      return <RowNote tone="danger">{t("desktop.connection.computers.requestFailed")}</RowNote>;
    default:
      return assertNever(notice, "ProbeNotice");
  }
}

/**
 * 연결 시험 결과 패널. 점검 줄(CheckSteps, 머리에 요약과 "다시 시험")과 멈춘 자리의 안내다. 시험 전이면 아무것도 그리지 않는다.
 * `onRun`은 다시 돌리기다(호스트 키를 믿은 뒤에는 그 인자를 준다).
 */
export function ProbeView(props: {
  readonly probe: ProbeState;
  readonly label: string;
  readonly onRun: (args: ProbeRunArgs) => void;
  readonly onCopy: (text: string) => void;
  readonly disabled?: boolean | undefined;
}): ReactNode {
  const { probe, onRun, onCopy } = props;
  const rows = checkRowsOf(probe);
  const notice = probeNoticeOf(probe);
  if (rows.length === 0 && notice === null) return null;
  return (
    <div data-slot="probe-view" className="grid min-w-0 gap-3">
      {rows.length === 0 ? null : (
        <CheckSteps
          steps={rows.map(stepOf)}
          label={props.label}
          disabled={props.disabled}
          onRetry={() => {
            onRun({});
          }}
        />
      )}
      {notice === null ? null : (
        <ProbeNoticeView notice={notice} busy={probe.busy} onRun={onRun} onCopy={onCopy} />
      )}
    </div>
  );
}

// ── 방식 단계 ─────────────────────────────────────────────────────────

/** ssh 설정의 호스트 목록. 화살표로 옮기면 바로 고르고(고른 줄이 하나라 선택이 곧 포커스다), Enter는 점검 시작이다 */
function HostListbox(props: {
  readonly hosts: readonly SshHost[];
  readonly picked: string | null;
  readonly labelId: string;
  readonly onPick: (name: string) => void;
  readonly onEnter: () => void;
}): ReactNode {
  const { hosts, picked, onPick } = props;
  const baseId = useId();
  const index = hosts.findIndex((host) => host.name === picked);
  const optionId = (i: number): string => `${baseId}-${String(i)}`;
  const move = (event: KeyboardEvent<HTMLUListElement>): void => {
    const step: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const host = event.key === "Home" ? hosts[0] : hosts.at(-1);
      if (host !== undefined) onPick(host.name);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      props.onEnter();
      return;
    }
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = index < 0 ? 0 : Math.min(hosts.length - 1, Math.max(0, index + delta));
    const host = hosts[next];
    if (host === undefined) return;
    onPick(host.name);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  };
  return (
    <ul
      role="listbox"
      tabIndex={0}
      aria-labelledby={props.labelId}
      aria-activedescendant={index < 0 ? undefined : optionId(index)}
      onKeyDown={move}
      data-slot="ssh-host-list"
      className="m-0 grid max-h-45 list-none overflow-y-auto rounded-lg p-0 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--cs-color-border-strong)]"
    >
      {hosts.map((host, i) => {
        const selected = host.name === picked;
        return (
          <li
            key={host.name}
            id={optionId(i)}
            role="option"
            aria-selected={selected}
            onClick={() => {
              onPick(host.name);
            }}
            className={`flex h-9 min-w-0 flex-none cursor-default items-center gap-2 px-3 ${selected ? "bg-neutral-selected" : "hover:bg-neutral-hover"}`}
          >
            <span className="min-w-0 flex-none truncate text-ui font-medium text-text-primary">
              {host.name}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-tertiary">
              {hostDisplayOf(host)}
            </span>
            {host.proxyJump ? (
              <Badge size="sm" variant="soft">
                {t("desktop.connection.add.ssh.jump")}
              </Badge>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function HostsPart(props: {
  readonly hosts: HostsRead;
  readonly picked: string | null;
  readonly onPick: (name: string) => void;
  readonly onEnter: () => void;
}): ReactNode {
  const { hosts } = props;
  const labelId = useId();
  let body: ReactNode;
  if (hosts.kind === "loading") {
    body = (
      <div role="status" data-slot="ssh-hosts-loading" className="grid gap-2 py-1">
        <span className="sr-only">{t("desktop.connection.add.ssh.hostsLoading")}</span>
        {[72, 56, 64].map((width) => (
          <Skeleton key={width} width={`${String(width)}%`} height={14} />
        ))}
      </div>
    );
  } else if (hosts.kind === "failed" || hosts.reply.unreadable === "unreadable") {
    body = (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.add.ssh.unreadable")}</p>
    );
  } else if (hosts.reply.unreadable === "missing") {
    body = (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.add.ssh.missing")}</p>
    );
  } else if (hosts.reply.hosts.length === 0) {
    body = <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.add.ssh.none")}</p>;
  } else {
    body = (
      <HostListbox
        hosts={hosts.reply.hosts}
        picked={props.picked}
        labelId={labelId}
        onPick={props.onPick}
        onEnter={props.onEnter}
      />
    );
  }
  return (
    <div className="grid gap-1.5">
      <span id={labelId} className={SUB_HEAD}>
        {t("desktop.connection.add.ssh.hosts")}
      </span>
      {body}
    </div>
  );
}

function SshPart(props: {
  readonly state: AddState;
  readonly hosts: HostsRead;
  readonly dispatch: (action: AddAction) => void;
  readonly onStart: () => void;
}): ReactNode {
  const { state, hosts, dispatch, onStart } = props;
  const [advanced, setAdvanced] = useState(false);
  const typedId = useId();
  const socketId = useId();
  const advancedId = useId();
  const typed = state.ssh.typed;
  const typedBad = typed.trim() !== "" && !parseSshInput(typed).ok;
  const socketBad = !socketTextOk(state.ssh.socket);
  const shown = advanced || state.ssh.socket !== "";
  return (
    <div className="grid gap-4">
      <HostsPart
        hosts={hosts}
        picked={state.ssh.picked}
        onPick={(name) => {
          dispatch({ type: "pick", name });
        }}
        onEnter={onStart}
      />
      <div className="grid gap-1.5">
        <label htmlFor={typedId} className={SUB_HEAD}>
          {t("desktop.connection.add.ssh.typed")}
        </label>
        <Input
          id={typedId}
          size={FORM_CONTROL_SIZE}
          containerClassName={FIELD_WIDTH.full}
          className="font-mono"
          placeholder="user@host"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          invalid={typedBad}
          onValueChange={(value) => {
            dispatch({ type: "typed", text: value });
          }}
          onKeyDown={(event) => {
            if (!isCommitEnter(event)) return;
            event.preventDefault();
            onStart();
          }}
        />
        <span
          role={typedBad ? "alert" : undefined}
          className={`text-ui-sm ${typedBad ? "text-danger-text" : "text-text-tertiary"}`}
        >
          {t(
            typedBad
              ? "desktop.connection.add.ssh.typedInvalid"
              : "desktop.connection.add.ssh.typedHint",
          )}
        </span>
      </div>
      <div className="grid gap-2">
        <div>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            className="-ms-2"
            aria-expanded={shown}
            aria-controls={advancedId}
            onClick={() => {
              setAdvanced((open) => !open);
            }}
          >
            {shown ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <span className="text-text-secondary">{t("desktop.connection.add.ssh.advanced")}</span>
          </Button>
        </div>
        {shown ? (
          <div id={advancedId} className="grid gap-1.5">
            <span className="inline-flex items-center gap-1">
              <label htmlFor={socketId} className={LABEL}>
                {t("desktop.connection.add.ssh.socket")}
              </label>
              <InfoTip text={t("desktop.connection.add.ssh.socketInfo")} />
            </span>
            <Input
              id={socketId}
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.full}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={state.ssh.socket}
              invalid={socketBad}
              onValueChange={(value) => {
                dispatch({ type: "socket", text: value });
              }}
            />
            {socketBad ? (
              <span role="alert" className="text-ui-sm text-danger-text">
                {t("desktop.connection.add.ssh.socketInvalid")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WebPart(props: {
  readonly state: AddState;
  readonly dispatch: (action: AddAction) => void;
  readonly onStart: () => void;
}): ReactNode {
  const { state, dispatch, onStart } = props;
  const id = useId();
  const bad = state.web.trim() !== "" && webEndpointOf(state.web) === null;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {t("desktop.connection.add.web.address")}
      </label>
      <Input
        id={id}
        size={FORM_CONTROL_SIZE}
        containerClassName={FIELD_WIDTH.full}
        className="font-mono"
        placeholder="https://my-mac.tailnet.ts.net"
        autoComplete="off"
        spellCheck={false}
        value={state.web}
        invalid={bad}
        onValueChange={(value) => {
          dispatch({ type: "web", text: value });
        }}
        onKeyDown={(event) => {
          if (!isCommitEnter(event)) return;
          event.preventDefault();
          onStart();
        }}
      />
      <span
        role={bad ? "alert" : undefined}
        className={`text-ui ${bad ? "text-danger-text" : "text-text-tertiary"}`}
      >
        {t(
          bad
            ? "desktop.connection.add.web.addressInvalid"
            : "desktop.connection.add.web.addressHint",
        )}
      </span>
    </div>
  );
}

function MethodStep(props: {
  readonly state: AddState;
  readonly hosts: HostsRead;
  readonly dispatch: (action: AddAction) => void;
  readonly onStart: () => void;
}): ReactNode {
  const { state, dispatch } = props;
  return (
    <div data-slot="add-method" className="grid gap-5">
      <div className="radio-cards">
        <ChoiceGroup
          appearance="card"
          columns="2"
          size="sm"
          aria-label={t("desktop.connection.add.method.name")}
          value={state.method}
          onValueChange={(next) => {
            const method = typeof next === "string" ? addMethodOf(next) : undefined;
            if (method !== undefined) dispatch({ type: "method", method });
          }}
          className="grid-cols-2 [&_[data-slot=choice-group-item]]:gap-y-2 [&_[data-slot=choice-group-title]]:text-ui [&_[data-slot=choice-group-description]]:text-ui"
        >
          <ChoiceGroupItem
            value="ssh"
            title={t("desktop.connection.add.method.ssh.title")}
            description={t("desktop.connection.add.method.ssh.body")}
          />
          <ChoiceGroupItem
            value="web"
            title={t("desktop.connection.add.method.web.title")}
            description={t("desktop.connection.add.method.web.body")}
          />
        </ChoiceGroup>
      </div>
      {state.method === "ssh" ? (
        <SshPart {...props} />
      ) : (
        <WebPart state={state} dispatch={dispatch} onStart={props.onStart} />
      )}
    </div>
  );
}

// ── 점검 단계 ─────────────────────────────────────────────────────────

function fingerprintStepOf(state: AddState): CheckStep | null {
  const read = state.fingerprint;
  const label = t("desktop.connection.add.web.value");
  switch (read.kind) {
    case "idle":
      return null;
    case "reading":
      return {
        id: "fingerprint",
        label,
        state: "running",
        detail: t("desktop.connection.add.web.reading"),
      };
    case "read":
      return {
        id: "fingerprint",
        label,
        state: "passed",
        detail: t("desktop.connection.add.web.read"),
      };
    case "failed":
      return { id: "fingerprint", label, state: "failed", detail: t(read.key) };
    default:
      return assertNever(read, "FingerprintRead");
  }
}

function WebCheck(props: {
  readonly state: AddState;
  readonly dispatch: (action: AddAction) => void;
  readonly onReadFingerprint: () => void;
  readonly onPair: () => void;
}): ReactNode {
  const { state, dispatch } = props;
  const codeId = useId();
  const read = state.fingerprint;
  const pair = state.pair;
  return (
    <div data-slot="add-web-check" className="grid gap-4">
      <CheckInline
        runLabel={t("desktop.connection.add.web.reread")}
        result={fingerprintStepOf(state)}
        onRun={props.onReadFingerprint}
        disabled={pair.kind === "busy"}
      />
      {read.kind === "read" ? (
        <>
          <TrustBox
            slot="cert-box"
            message={t("desktop.connection.add.web.trust")}
            valueLabel={t("desktop.connection.add.web.valueLabel")}
            value={groupedValue(read.fingerprint)}
          />
          <div className="grid gap-1.5">
            <label htmlFor={codeId} className={LABEL}>
              {t("desktop.connection.add.web.code")}
            </label>
            <Input
              id={codeId}
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.medium}
              className="font-mono"
              placeholder="ABCDE-12345"
              maxLength={11}
              autoComplete="off"
              spellCheck={false}
              value={state.code}
              invalid={pair.kind === "failed"}
              disabled={pair.kind === "busy"}
              onValueChange={(value) => {
                dispatch({ type: "code", text: value });
              }}
              onKeyDown={(event) => {
                if (!isCommitEnter(event)) return;
                event.preventDefault();
                props.onPair();
              }}
            />
            {pair.kind === "failed" ? (
              <span role="alert" data-slot="pair-error" className="text-ui text-danger-text">
                {t(pair.key, pair.seconds === undefined ? undefined : { seconds: pair.seconds })}
              </span>
            ) : (
              <span className="text-ui-sm text-text-tertiary">
                {t("desktop.connection.add.web.codeHint")}
              </span>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── 저장 단계 ─────────────────────────────────────────────────────────

function SaveStep(props: {
  readonly state: AddState;
  readonly dispatch: (action: AddAction) => void;
  readonly onSave: (connectNow: boolean) => void;
}): ReactNode {
  const { state, dispatch } = props;
  const id = useId();
  const ready = state.ready;
  if (ready === null) return null;
  const meta = [
    ready.version,
    ready.ms === null ? null : `${String(Math.round(ready.ms))}ms`,
  ].filter((part): part is string => part !== null && part !== "");
  const save = state.save;
  return (
    <div data-slot="add-save" className="grid content-start gap-5">
      <p role="status" className="m-0 flex min-w-0 items-center gap-1.5 text-ui text-text-primary">
        <Check aria-hidden className="size-icon-sm flex-none text-success-text" />
        <span className="min-w-0 truncate">
          {t("desktop.connection.add.save.ready", { name: ready.suggested })}
        </span>
        {meta.map((part) => (
          <span key={part} className="flex-none font-mono text-mono-sm text-text-tertiary">
            · {part}
          </span>
        ))}
      </p>
      <div className="grid gap-1.5">
        <label htmlFor={id} className={LABEL}>
          {t("desktop.connection.add.save.name")}
        </label>
        <Input
          id={id}
          size={FORM_CONTROL_SIZE}
          containerClassName={FIELD_WIDTH.medium}
          value={state.label}
          invalid={save.kind === "failed"}
          disabled={save.kind === "saving"}
          autoFocus
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onValueChange={(value) => {
            dispatch({ type: "label", text: value });
          }}
          onKeyDown={(event) => {
            if (!isCommitEnter(event)) return;
            event.preventDefault();
            props.onSave(true);
          }}
        />
        {save.kind === "failed" ? (
          <span role="alert" data-slot="save-error" className="text-ui text-danger-text">
            {t(save.key)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── 본문과 바닥 ───────────────────────────────────────────────────────

export interface AddComputerBodyProps {
  readonly state: AddState;
  readonly hosts: HostsRead;
  readonly dispatch: (action: AddAction) => void;
  /** 방식 단계에서 점검 시작(Enter) */
  readonly onStart: () => void;
  /** SSH 점검을 다시 돌린다(호스트 키 확인 뒤에는 인자를 준다) */
  readonly onRun: (args: ProbeRunArgs) => void;
  readonly onReadFingerprint: () => void;
  readonly onPair: () => void;
  readonly onSave: (connectNow: boolean) => void;
  readonly onCopy: (text: string) => void;
}

const STEP_LABEL = {
  method: "desktop.connection.add.step.method",
  check: "desktop.connection.add.step.check",
  save: "desktop.connection.add.step.save",
} as const;

/** Stepper의 한 단계. 점검이 멈췄으면 그 단계를 실패로, 점검이 도는 동안은 살아 있는 지금 단계로 보인다(DP-186) */
function stepperStepOf(step: AddStep, failed: boolean, busy: boolean): StepperStep {
  const label = t(STEP_LABEL[step]);
  if (failed) return { id: step, label, status: "failed" };
  return busy ? { id: step, label, busy: true } : { id: step, label };
}

/** wizard 본문: 위에 가로 Stepper, 아래에 그 단계의 내용. 최소 높이 320 */
export function AddComputerBody(props: AddComputerBodyProps): ReactNode {
  const { state, hosts, dispatch } = props;
  const stepIndex = ADD_STEPS.indexOf(state.step);
  const sshTarget = sshTargetOfDraft(state.ssh, hostsOf(hosts));
  // 멈춘 줄이 실패일 때만 단계를 빨갛게 칠한다. 확인을 기다리는 멈춤(새 호스트 키)은 지금 단계 그대로다
  const probeStopped =
    state.step === "check" &&
    !state.probe.busy &&
    probeNoticeOf(state.probe) !== null &&
    stopLineOf(state.probe.steps)?.status === "fail";
  // 점검 단계에서 사전 점검, 확인 값 읽기, 웹 연결이 도는 동안
  const checking =
    state.step === "check" &&
    (state.probe.busy || state.fingerprint.kind === "reading" || state.pair.kind === "busy");
  return (
    <div data-slot="add-computer" data-step={state.step} className="grid content-start gap-5">
      <Stepper
        size="sm"
        orientation="horizontal"
        steps={ADD_STEPS.map((step, i) =>
          stepperStepOf(step, i === stepIndex && probeStopped, i === stepIndex && checking),
        )}
        value={stepIndex + 1}
        live={stepperLive}
      />
      <div className="grid min-h-80 content-start">
        {state.step === "method" ? (
          <MethodStep state={state} hosts={hosts} dispatch={dispatch} onStart={props.onStart} />
        ) : null}
        {state.step === "check" && state.method === "ssh" ? (
          <ProbeView
            probe={state.probe}
            label={t("desktop.connection.add.check.label", {
              name: sshTarget?.label ?? "",
            })}
            onRun={props.onRun}
            onCopy={props.onCopy}
          />
        ) : null}
        {state.step === "check" && state.method === "web" ? (
          <WebCheck
            state={state}
            dispatch={dispatch}
            onReadFingerprint={props.onReadFingerprint}
            onPair={props.onPair}
          />
        ) : null}
        {state.step === "save" ? (
          <SaveStep state={state} dispatch={dispatch} onSave={props.onSave} />
        ) : null}
      </div>
    </div>
  );
}

export interface AddComputerFooterProps {
  readonly state: AddState;
  readonly hosts: HostsRead;
  /** 지금 다른 컴퓨터로 바꿀 수 있는가(연결 진행이나 저장이 없을 때). 거짓이면 [저장하고 연결]을 잠근다 */
  readonly canConnectNow: boolean;
  readonly dispatch: (action: AddAction) => void;
  readonly onCancel: () => void;
  readonly onStart: () => void;
  readonly onPair: () => void;
  readonly onSave: (connectNow: boolean) => void;
}

/** 바닥 단추. 방식: [취소] [점검 시작 | 다음]. 점검: [뒤로] (+ 웹은 [연결]). 저장: [저장만] [저장하고 연결] */
export function AddComputerFooter(props: AddComputerFooterProps): ReactNode {
  const { state, dispatch } = props;
  if (state.step === "method") {
    return (
      <>
        <Button size={FORM_CONTROL_SIZE} variant="ghost" onClick={props.onCancel}>
          {t("desktop.connection.add.cancel")}
        </Button>
        <Button
          size={FORM_CONTROL_SIZE}
          variant="solid"
          disabled={!canStart(state, hostsOf(props.hosts))}
          onClick={props.onStart}
        >
          {t(
            state.method === "ssh" ? "desktop.connection.add.start" : "desktop.connection.add.next",
          )}
        </Button>
      </>
    );
  }
  if (state.step === "check") {
    const busy = state.probe.busy || state.pair.kind === "busy";
    return (
      <>
        <Button
          size={FORM_CONTROL_SIZE}
          variant="ghost"
          disabled={busy}
          onClick={() => {
            dispatch({ type: "back" });
          }}
        >
          {t("desktop.connection.add.back")}
        </Button>
        {state.method === "web" ? (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="solid"
            disabled={!canPair(state)}
            loading={state.pair.kind === "busy"}
            onClick={props.onPair}
          >
            {t("desktop.connection.add.web.pair")}
          </Button>
        ) : null}
      </>
    );
  }
  const saving = state.save.kind === "saving";
  return (
    <>
      <Button
        size={FORM_CONTROL_SIZE}
        variant="ghost"
        disabled={saving}
        onClick={() => {
          props.onSave(false);
        }}
      >
        {t("desktop.connection.add.save.only")}
      </Button>
      <Button
        size={FORM_CONTROL_SIZE}
        variant="solid"
        disabled={saving || !props.canConnectNow}
        loading={saving}
        onClick={() => {
          props.onSave(true);
        }}
      >
        {t("desktop.connection.add.save.connect")}
      </Button>
    </>
  );
}

// ── 대화 상자(명령을 부른다) ───────────────────────────────────────────

export interface AddComputerDialogProps {
  readonly open: boolean;
  /** 처음 고른 방식(빈 상태의 [SSH로 추가]·[웹 주소로 추가]) */
  readonly method: AddMethod;
  /** 저장한 컴퓨터(같은 주소 검사) */
  readonly items: readonly TargetEntry[];
  readonly canConnectNow: boolean;
  readonly onClose: () => void;
  /** 목록에 넣고 저장한다. `connectNow`면 저장한 뒤 그 컴퓨터로 바꾼다. 저장하면 참이다 */
  readonly onAdd: (
    entry: { readonly label: string; readonly address: string },
    connectNow: boolean,
  ) => Promise<boolean>;
  readonly onCopy: (text: string) => void;
}

/**
 * "컴퓨터 추가" 대화 상자. 열 때마다 새로 그린다(부르는 쪽이 `key`를 바꾼다). ssh 설정 목록은 처음 SSH 방식을 볼 때 한 번 읽는다.
 */
export function AddComputerDialog(props: AddComputerDialogProps): ReactNode {
  const connection = useCommands().connection;
  const [state, dispatch] = useReducer(addReducer, props.method, initialAddState);
  const [hosts, setHosts] = useState<HostsRead | null>(null);
  const wantsHosts = props.open && state.method === "ssh" && hosts === null;

  useEffect(() => {
    if (!wantsHosts) return undefined;
    let current = true;
    detach(
      connection.sshHosts().then((read) => {
        if (current) setHosts(read.ok ? { kind: "ready", reply: read.value } : { kind: "failed" });
        return undefined;
      }),
      rethrow,
    );
    return () => {
      current = false;
    };
  }, [wantsHosts, connection]);

  const hostList = hosts === null ? [] : hostsOf(hosts);

  const runSsh = (args: ProbeRunArgs): void => {
    const target = sshTargetOfDraft(state.ssh, hostList);
    if (target === null) return;
    const socket = state.ssh.socket;
    // 처음 시작은 "start"가 단계 줄을 비운다. 점검 단계에서 다시 돌릴 때만 여기서 비운다
    if (state.step === "check") dispatch({ type: "probe", action: { type: "begin" } });
    detach(
      runPreflight(connection, target.target, args, (action) => {
        dispatch({ type: "probe", action });
      }).then((passed) => {
        if (passed !== null) {
          dispatch({
            type: "passed",
            ready: {
              address: sshSavedAddressOf(passed.address, socket),
              suggested: target.label,
              version:
                passed.serviceVersion === "" ? passed.remoteVersion.cli : passed.serviceVersion,
              ms: passed.tunnelMs,
            },
          });
        }
        return undefined;
      }),
      rethrow,
    );
  };

  const readFingerprint = (): void => {
    const endpoint = webEndpointOf(state.web);
    if (endpoint === null) return;
    dispatch({ type: "fingerprint", read: { kind: "reading" } });
    detach(
      connection.fingerprintOf(endpoint.host, endpoint.port).then((result) => {
        dispatch({
          type: "fingerprint",
          read: result.ok
            ? { kind: "read", fingerprint: result.value }
            : {
                kind: "failed",
                key:
                  result.error.kind === "failed"
                    ? "desktop.connection.computers.requestFailed"
                    : fingerprintFailureKeyOf(result.error),
              },
        });
        return undefined;
      }),
      rethrow,
    );
  };

  const start = (): void => {
    if (!canStart(state, hostList)) return;
    dispatch({ type: "start" });
    if (state.method === "ssh") runSsh({});
    else readFingerprint();
  };

  const pairNow = (): void => {
    const endpoint = webEndpointOf(state.web);
    const read = state.fingerprint;
    if (endpoint === null || read.kind !== "read" || !canPair(state)) return;
    const pinned = pinnedOf(endpoint, read.fingerprint);
    if (pinned === null) {
      dispatch({
        type: "pair",
        read: { kind: "failed", key: "desktop.connection.computers.requestFailed" },
      });
      return;
    }
    dispatch({ type: "pair", read: { kind: "busy" } });
    detach(
      connection
        .pair({
          host: endpoint.host,
          port: endpoint.port,
          pin: pinned.pin,
          code: state.code,
          deviceName: PAIR_DEVICE_NAME,
        })
        .then((result) => {
          if (result.ok) {
            dispatch({ type: "pair", read: { kind: "idle" } });
            dispatch({
              type: "passed",
              ready: { address: pinned.address, suggested: endpoint.host, version: null, ms: null },
            });
            return undefined;
          }
          const failure =
            result.error.kind === "server" && result.error.code === "fingerprint_changed"
              ? { key: "desktop.connection.add.web.changed" as const }
              : pairFailureKeyOf(result.error);
          dispatch({ type: "pair", read: { kind: "failed", ...failure } });
          return undefined;
        }),
      rethrow,
    );
  };

  const saveNow = (connectNow: boolean): void => {
    const ready = state.ready;
    if (ready === null || state.save.kind === "saving") return;
    if (connectNow && !props.canConnectNow) return;
    const label = state.label.trim();
    const problem = saveProblemOf(props.items, label, ready.address);
    if (problem !== null) {
      dispatch({ type: "save", read: { kind: "failed", key: problem } });
      return;
    }
    dispatch({ type: "save", read: { kind: "saving" } });
    detach(
      props.onAdd({ label, address: ready.address }, connectNow).then((saved) => {
        if (saved) props.onClose();
        else
          dispatch({
            type: "save",
            read: { kind: "failed", key: "desktop.connection.add.save.failed" },
          });
        return undefined;
      }),
      rethrow,
    );
  };

  const readHosts: HostsRead = hosts ?? { kind: "loading" };
  return (
    <Dialog
      size="md"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("desktop.connection.add.title")}
      footer={
        <AddComputerFooter
          state={state}
          hosts={readHosts}
          canConnectNow={props.canConnectNow}
          dispatch={dispatch}
          onCancel={props.onClose}
          onStart={start}
          onPair={pairNow}
          onSave={saveNow}
        />
      }
    >
      <AddComputerBody
        state={state}
        hosts={readHosts}
        dispatch={dispatch}
        onStart={start}
        onRun={runSsh}
        onReadFingerprint={readFingerprint}
        onPair={pairNow}
        onSave={saveNow}
        onCopy={props.onCopy}
      />
    </Dialog>
  );
}
