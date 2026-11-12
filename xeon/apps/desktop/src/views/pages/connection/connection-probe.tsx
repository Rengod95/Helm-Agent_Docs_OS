import {
  preflightActionKey,
  preflightCauseKey,
  preflightFixKey,
  preflightHintKey,
  preflightOkKey,
  preflightStepKey,
} from "@fresnel/client";
import { t, type MessageId } from "@fresnel/client/i18n";
import { Badge, Button } from "@caustic/react";
import type { ReactNode } from "react";
import type { RemoteTestOutcome, SshHostsReply } from "../../../transport/ipc.ts";
import {
  hostDisplayOf,
  hostKeyPromptOf,
  pickEmptyKeyOf,
  stopLineOf,
  type HostKeyPrompt,
  type ProbeRunArgs,
  type ProbeState,
  type StepLine,
} from "./connection-probe-model.ts";

// 연결 시험의 그림: 사전 점검 단계 줄, 주소 시험 한 줄, SSH 호스트 고르기 목록. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이
// 이 부품을 직접 그린다). 고치는 명령은 고정폭 한 줄과 복사 단추로 준다. 호스트 키 확인과 다시 해 보기는 `onRun`으로 다시 돌린다.

/** 고르기 목록의 한 줄 */
export type SshHost = SshHostsReply["hosts"][number];

/** 고르기 목록의 상태. 닫힘, 읽는 중, 읽음(목록이나 빈 자리 문장), 읽지 못함이다 */
export type PickerState =
  | { readonly kind: "closed" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly reply: SshHostsReply }
  | { readonly kind: "failed" };

/** 고침 명령 한 줄. 고정폭으로 보이고 복사 단추가 붙는다 */
function CommandLine(props: {
  readonly command: string;
  readonly onCopy: (text: string) => void;
}): ReactNode {
  const { command, onCopy } = props;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 rounded-lg bg-bg-inset px-3 py-2 font-mono text-ui break-all text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
        {command}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          onCopy(command);
        }}
      >
        {t(preflightActionKey("copy_command"))}
      </Button>
    </div>
  );
}

/** 호스트 키 확인 자리: 처음 보는 호스트(또는 바뀐 키)와 지문. 지문은 고정폭으로 그대로 보인다 */
function HostKeyBlock(props: { readonly prompt: HostKeyPrompt }): ReactNode {
  const { prompt } = props;
  return (
    <div className="grid gap-1">
      <span className="text-ui text-text-primary">
        {t("desktop.connection.fingerprint.hostKeyPrompt", { host: prompt.hostname })}
      </span>
      <span className="text-ui-strong text-text-secondary">
        {t("desktop.connection.fingerprint.label", { type: prompt.keyType })}
      </span>
      <code className="font-mono text-ui break-all text-text-primary">{prompt.fingerprint}</code>
    </div>
  );
}

/** 단계 한 줄. 통과는 확인 문장과 걸린 시간, 실패와 조치는 원인과 고치는 법(그리고 힌트와 명령)을 잇는다 */
function StepRow(props: {
  readonly line: StepLine;
  readonly stop: boolean;
  readonly busy: boolean;
  readonly onRun: (args: ProbeRunArgs) => void;
  readonly onCopy: (text: string) => void;
}): ReactNode {
  const { line, stop, busy, onRun, onCopy } = props;
  const name = t(preflightStepKey(line.step));
  if (line.status === "running") {
    return (
      <li className="flex min-w-0 items-center gap-2">
        <span className="text-text-primary">{name}</span>
        <span className="text-text-tertiary">{t("desktop.connection.test.running")}</span>
      </li>
    );
  }
  const passed = line.status === "pass";
  // 통과한 마지막 단계는 그 자리에서 걸린 시간을 글에 이미 넣으므로 시간 줄을 따로 두지 않는다
  const tookShown = line.durationMs > 0 && !(passed && line.step === "tunnel");
  const ms = Math.round(line.durationMs);
  const hintKey = line.fix?.hint === undefined ? null : preflightHintKey(line.fix.hint);
  const prompt = stop ? hostKeyPromptOf(line) : null;
  const actions = stop ? line.actions : [];
  return (
    <li className="grid gap-1.5">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span aria-hidden className={passed ? "text-success-text" : "text-danger-text"}>
          {passed ? "✓" : "✗"}
        </span>
        <span className="text-ui-strong text-text-primary">{name}</span>
        {tookShown ? (
          <span className="text-ui text-text-tertiary">
            {t("desktop.connection.preflight.took", { ms })}
          </span>
        ) : null}
      </span>
      {passed ? (
        <span className="pl-5 text-ui text-text-secondary">
          {t(preflightOkKey(line.step), { ms })}
        </span>
      ) : (
        <div className="grid gap-1.5 pl-5">
          <span className="text-ui text-danger-text">{t(preflightCauseKey(line.code))}</span>
          <span className="text-ui text-text-secondary">{t(preflightFixKey(line.code))}</span>
          {hintKey === null ? null : (
            <span className="text-ui text-text-tertiary">{t(hintKey)}</span>
          )}
          {(line.fix?.commands ?? []).map((command) => (
            <CommandLine key={command} command={command} onCopy={onCopy} />
          ))}
          {prompt === null ? null : <HostKeyBlock prompt={prompt} />}
          {stop && (prompt !== null || actions.includes("retry")) ? (
            <div className="flex flex-wrap items-center gap-2">
              {prompt === null ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant={prompt.replace ? "outline" : "soft"}
                  disabled={busy}
                  onClick={() => {
                    onRun(
                      prompt.replace
                        ? {
                            trustHostKey: { fingerprint: prompt.fingerprint },
                            replaceChangedHostKey: true,
                          }
                        : { trustHostKey: { fingerprint: prompt.fingerprint } },
                    );
                  }}
                >
                  {t(preflightActionKey(prompt.replace ? "replace_host_key" : "trust_host_key"))}
                </Button>
              )}
              {actions.includes("retry") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    onRun({});
                  }}
                >
                  {t(preflightActionKey("retry"))}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * 연결 시험의 결과 줄. 사전 점검(SSH)은 단계 줄을 펼치고, 주소 시험(wss, unix)은 한 줄이다. 시험 중이면 진행 글을 보인다.
 * 셸 명령이 실패했으면 요청 실패 글을 보인다.
 */
export function ProbeLines(props: {
  readonly probe: ProbeState;
  readonly onRun: (args: ProbeRunArgs) => void;
  readonly onCopy: (text: string) => void;
}): ReactNode {
  const { probe, onRun, onCopy } = props;
  if (probe.tested !== null) return <TestLine tested={probe.tested} />;
  if (probe.failed) {
    return <p className="m-0 text-ui text-danger-text">{t("desktop.connection.actionFailed")}</p>;
  }
  if (probe.steps.length === 0) {
    return probe.busy ? (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.test.running")}</p>
    ) : null;
  }
  const stop = stopLineOf(probe.steps);
  return (
    <ol
      aria-label={t("desktop.connection.test.action")}
      className="m-0 grid list-none content-start gap-3 p-0"
    >
      {probe.steps.map((line) => (
        <StepRow
          key={line.step}
          line={line}
          stop={stop === line}
          busy={probe.busy}
          onRun={onRun}
          onCopy={onCopy}
        />
      ))}
    </ol>
  );
}

/** 주소 시험의 한 줄: 통과는 걸린 시간, 실패는 원인과 고치는 법이다 */
function TestLine(props: { readonly tested: RemoteTestOutcome }): ReactNode {
  const { tested } = props;
  if (tested.ok) {
    return (
      <p className="m-0 text-ui text-success-text">
        {t("desktop.connection.test.ok", { ms: Math.round(tested.durationMs) })}
      </p>
    );
  }
  return (
    <p className="m-0 text-ui">
      <span className="text-danger-text">{t(preflightCauseKey(tested.code))}</span>{" "}
      <span className="text-text-secondary">{t(preflightFixKey(tested.code))}</span>
    </p>
  );
}

/** SSH 호스트 고르기 목록. 읽는 중, 읽지 못함, 빈 자리 문장, 목록 순서다. 고른 한 줄은 `onPick`으로 준다 */
export function SshHostList(props: {
  readonly picker: PickerState;
  readonly disabled: boolean;
  readonly onPick: (host: SshHost) => void;
}): ReactNode {
  const { picker, disabled, onPick } = props;
  if (picker.kind === "closed") return null;
  if (picker.kind === "loading") {
    return (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.targets.loading")}</p>
    );
  }
  if (picker.kind === "failed") {
    return (
      <p className="m-0 text-ui text-danger-text">{t("desktop.connection.hosts.unreadable")}</p>
    );
  }
  const empty: MessageId | null = pickEmptyKeyOf(picker.reply);
  if (empty !== null) return <p className="m-0 text-ui text-text-tertiary">{t(empty)}</p>;
  return (
    <ul aria-label={t("desktop.connection.hosts.pick")} className="m-0 grid list-none gap-1 p-0">
      {picker.reply.hosts.map((host) => (
        <li key={host.name}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-auto w-full justify-start py-1.5 text-left"
            disabled={disabled}
            onClick={() => {
              onPick(host);
            }}
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ui-strong text-text-primary">{host.name}</span>
                {host.proxyJump ? (
                  <Badge size="xs" className="bg-neutral-track text-text-secondary">
                    {t("desktop.connection.hosts.jump")}
                  </Badge>
                ) : null}
              </span>
              <span className="truncate font-mono text-ui-sm font-normal text-text-tertiary">
                {hostDisplayOf(host)}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
