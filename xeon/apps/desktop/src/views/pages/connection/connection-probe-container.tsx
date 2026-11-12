import {
  parseTargetAddress,
  pinAddress,
  pinOfAddress,
  sshTargetOfAddress,
  type TargetEntry,
} from "@fresnel/client";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Button, Field, Input } from "@caustic/react";
import { useReducer, useState, type ReactNode } from "react";
import { useCommands, type ConnectionCommands } from "../../commands.ts";
import { isCommitEnter } from "../../ime-enter.ts";
import { FIELD_TEXT } from "./host-address-field.tsx";
import { ProbeLines, SshHostList, type PickerState, type SshHost } from "./connection-probe.tsx";
import {
  fingerprintFailureKeyOf,
  pairFailureKeyOf,
  PAIR_CODE_MAX,
  PAIR_DEVICE_NAME,
  PROBE_IDLE,
  pickedSshFields,
  preflightTargetOf,
  probeReducer,
  type ProbeAction,
  type ProbeRunArgs,
  type RowProbe,
} from "./connection-probe-model.ts";
import {
  composeFields,
  fieldsOfAddress,
  type HostFields,
  type HostFormValue,
  type SshFields,
  type WssFields,
} from "./host-address.ts";

// 연결 시험의 명령 쪽: 추가 칸의 SSH 사전 점검과 호스트 고르기, 웹 주소의 지문 확인과 쌍 맺기, 저장된 호스트 줄의 시험.
// 명령은 `ConnectionCommands`로만 부르고, 결과는 `connection-probe-model.ts`의 상태로 바꿔 `connection-probe.tsx`가 그린다.
// 저장된 호스트 줄의 시험 상태는 한 번에 한 줄만 쓰므로 화면(`connection-screen.tsx`)이 `useRowProbe`로 든다.

/** 사전 점검을 돌린다. 단계는 `dispatch`로 받고, 통과하면 저장할 주소를 돌려준다. 멈추거나 실패하면 `null`이다 */
async function runPreflight(
  connection: ConnectionCommands,
  target: string,
  args: ProbeRunArgs,
  dispatch: (action: ProbeAction) => void,
): Promise<string | null> {
  const outcome = await connection.preflight({ target, ...args }, (event) => {
    dispatch({ type: "step", event });
  });
  if (!outcome.ok) {
    dispatch({ type: "failed" });
    return null;
  }
  if (!outcome.value.ok) {
    dispatch({ type: "stopped", outcome: outcome.value });
    return null;
  }
  dispatch({ type: "finished" });
  return outcome.value.address;
}

/** 주소 시험(wss, unix)을 한 번 돌린다 */
async function testAddress(
  connection: ConnectionCommands,
  address: string,
  dispatch: (action: ProbeAction) => void,
): Promise<void> {
  const tested = await connection.testTarget(address);
  if (!tested.ok) {
    dispatch({ type: "failed" });
    return;
  }
  dispatch({ type: "tested", outcome: tested.value });
}

interface SshProbeProps {
  readonly fields: SshFields;
  readonly busy: boolean;
  readonly onFill: (fields: HostFields) => void;
  readonly onCopy: (text: string) => void;
}

/** SSH 칸의 시험: 호스트 고르기 목록, 연결 시험(사전 점검 단계 줄), 통과하면 주소 칸 채우기 */
function SshProbe(props: SshProbeProps): ReactNode {
  const { fields, busy, onFill, onCopy } = props;
  const connection = useCommands().connection;
  const [probe, dispatch] = useReducer(probeReducer, PROBE_IDLE);
  const [picker, setPicker] = useState<PickerState>({ kind: "closed" });
  const target = preflightTargetOf(fields);
  const locked = busy || probe.busy;

  const run = (args: ProbeRunArgs): void => {
    if (target === null || locked) return;
    dispatch({ type: "begin" });
    detach(
      runPreflight(connection, target, args, dispatch).then((address) => {
        if (address !== null) {
          const parsed = fieldsOfAddress(address);
          if (parsed.ok) onFill(parsed.fields);
        }
        return undefined;
      }),
      rethrow,
    );
  };

  /** 고르기 목록을 여닫는다. 열 때 설정 파일의 호스트를 읽는다 */
  const togglePicker = (): void => {
    if (picker.kind !== "closed") {
      setPicker({ kind: "closed" });
      return;
    }
    setPicker({ kind: "loading" });
    detach(
      connection.sshHosts().then((read) => {
        setPicker(read.ok ? { kind: "ready", reply: read.value } : { kind: "failed" });
        return undefined;
      }),
      rethrow,
    );
  };

  /** 고른 호스트를 칸에 채운다. 목록은 닫는다 */
  const choose = (host: SshHost): void => {
    setPicker({ kind: "closed" });
    onFill({ kind: "ssh", ...pickedSshFields(host, fields) });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="soft" disabled={locked} onClick={togglePicker}>
          {t("desktop.connection.hosts.pick")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="soft"
          disabled={locked || target === null}
          loading={probe.busy}
          onClick={() => {
            run({});
          }}
        >
          {t("desktop.connection.test.action")}
        </Button>
      </div>
      <SshHostList picker={picker} disabled={locked} onPick={choose} />
      <ProbeLines probe={probe} onRun={run} onCopy={onCopy} />
    </div>
  );
}

/** 웹 주소의 호스트와 포트. 주소 칸이 맞지 않으면 null이다 */
function wssEndpointOf(fields: WssFields): { readonly host: string; readonly port: number } | null {
  const parsed = parseTargetAddress(composeFields({ kind: "wss", ...fields }));
  if (!parsed.ok || parsed.target.kind !== "wss") return null;
  return { host: parsed.target.host, port: parsed.target.port };
}

type FingerprintState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly fingerprint: string }
  | { readonly kind: "failed"; readonly key: MessageId };

type PairState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly key: MessageId; readonly seconds?: number };

/**
 * 웹 주소의 지문 확인과 연결 코드. 지문을 재서 보이고, 사용자가 맞다고 하면 주소에 `/pin/<sha256>`을 붙여 칸에 채운다.
 * 연결 코드는 고정한 지문에 대해 `pair`로 보내고, 성공하면 토큰은 셸이 보관한다. 코드 칸은 성공이나 실패 뒤 비운다.
 */
function WssProbe(props: {
  readonly fields: WssFields;
  readonly busy: boolean;
  readonly onFill: (fields: HostFields) => void;
}): ReactNode {
  const { fields, busy, onFill } = props;
  const connection = useCommands().connection;
  const [reading, setReading] = useState<FingerprintState>({ kind: "idle" });
  const [pair, setPair] = useState<PairState>({ kind: "idle" });
  const [code, setCode] = useState("");
  const endpoint = wssEndpointOf(fields);
  const pin = pinOfAddress(composeFields({ kind: "wss", ...fields }));
  const reads = reading.kind === "reading";
  const pairing = pair.kind === "busy";
  const canPair = !busy && !pairing && endpoint !== null && pin !== null && code.trim() !== "";

  const read = (): void => {
    if (endpoint === null || busy || reads) return;
    setReading({ kind: "reading" });
    detach(
      connection.fingerprintOf(endpoint.host, endpoint.port).then((result) => {
        setReading(
          result.ok
            ? { kind: "read", fingerprint: result.value }
            : { kind: "failed", key: fingerprintFailureKeyOf(result.error) },
        );
        return undefined;
      }),
      rethrow,
    );
  };

  /** 확인한 지문을 주소에 고정해 칸에 채운다. 지문 형식이 틀리면 요청 실패로 본다 */
  const accept = (fingerprint: string): void => {
    const base = composeFields({ kind: "wss", address: fields.address, pin: "" });
    const pinned = pinAddress(base, fingerprint);
    if (!pinned.ok) {
      setReading({ kind: "failed", key: "desktop.connection.actionFailed" });
      return;
    }
    const parsed = fieldsOfAddress(pinned.address);
    if (parsed.ok) onFill(parsed.fields);
  };

  const pairNow = (): void => {
    if (endpoint === null || pin === null || !canPair) return;
    setPair({ kind: "busy" });
    detach(
      connection
        .pair({
          host: endpoint.host,
          port: endpoint.port,
          pin,
          code: code.trim(),
          deviceName: PAIR_DEVICE_NAME,
        })
        .then((result) => {
          setCode("");
          setPair(
            result.ok ? { kind: "done" } : { kind: "failed", ...pairFailureKeyOf(result.error) },
          );
          return undefined;
        }),
      rethrow,
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="soft"
          disabled={busy || endpoint === null}
          loading={reads}
          onClick={read}
        >
          {t("desktop.connection.fingerprint.read")}
        </Button>
      </div>
      {reading.kind === "read" ? (
        <div className="grid gap-2">
          <span className="text-ui-strong text-text-secondary">
            {t("desktop.connection.server.row.fingerprint")}
          </span>
          <code className="rounded-lg bg-bg-inset px-3 py-2 font-mono text-ui break-all text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
            {reading.fingerprint}
          </code>
          <div>
            <Button
              type="button"
              size="sm"
              variant="soft"
              disabled={busy}
              onClick={() => {
                accept(reading.fingerprint);
              }}
            >
              {t("desktop.connection.fingerprint.confirm")}
            </Button>
          </div>
        </div>
      ) : null}
      {reading.kind === "failed" ? (
        <span role="alert" className="text-ui text-danger-text">
          {t(reading.key)}
        </span>
      ) : null}
      <Field
        label={t("desktop.connection.server.pairing.label")}
        disabled={busy || pairing}
        className={FIELD_TEXT}
      >
        <Input
          className="font-mono"
          value={code}
          maxLength={PAIR_CODE_MAX}
          autoComplete="off"
          spellCheck={false}
          onValueChange={setCode}
          onKeyDown={(event) => {
            // Enter는 쌍 맺기다. 추가 칸의 제출로 번지지 않게 막는다(조합 중 Enter는 그대로 둔다)
            if (!isCommitEnter(event)) return;
            event.preventDefault();
            pairNow();
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="soft"
          disabled={!canPair}
          loading={pairing}
          onClick={pairNow}
        >
          {t("desktop.connection.pair.submit")}
        </Button>
        {pin === null ? (
          <span className="text-ui text-text-tertiary">
            {t("desktop.connection.pair.pinFirst")}
          </span>
        ) : null}
      </div>
      {pair.kind === "done" ? (
        <span role="status" className="text-ui text-success-text">
          {t("desktop.connection.pair.done")}
        </span>
      ) : null}
      {pair.kind === "failed" ? (
        <span role="alert" className="text-ui text-danger-text">
          {t(pair.key, pair.seconds === undefined ? undefined : { seconds: pair.seconds })}
        </span>
      ) : null}
    </div>
  );
}

/** 추가 칸의 시험 자리. 방식에 따라 SSH 시험, 웹 지문과 코드, 또는 아무것도 없다(이 기기, 소켓, 포트) */
export function HostFormProbe(props: {
  readonly value: HostFormValue;
  readonly busy: boolean;
  readonly onFill: (fields: HostFields) => void;
  readonly onCopy: (text: string) => void;
}): ReactNode {
  const { value, busy, onFill, onCopy } = props;
  const fields = value.fields;
  switch (fields.kind) {
    case "ssh":
      return <SshProbe fields={fields} busy={busy} onFill={onFill} onCopy={onCopy} />;
    case "wss":
      return <WssProbe fields={fields} busy={busy} onFill={onFill} />;
    case "unix":
    case "tcp":
      return null;
    default:
      return assertNever(fields, "HostFields");
  }
}

type RowAction =
  | { readonly type: "begin"; readonly id: string }
  | { readonly type: "probe"; readonly action: ProbeAction };

function rowProbeReducer(state: RowProbe | null, action: RowAction): RowProbe | null {
  switch (action.type) {
    case "begin":
      return { id: action.id, probe: probeReducer(PROBE_IDLE, { type: "begin" }) };
    case "probe":
      return state === null ? null : { ...state, probe: probeReducer(state.probe, action.action) };
    default:
      return assertNever(action, "RowAction");
  }
}

/** 저장된 호스트 줄의 시험 상태와 시작 함수. 한 번에 한 줄만 돈다 */
export interface RowProbeHandle {
  readonly row: RowProbe | null;
  readonly run: (entry: TargetEntry, args?: ProbeRunArgs) => void;
}

/**
 * 저장된 호스트 줄의 "연결 시험". ssh 주소는 사전 점검(단계 줄을 줄 아래에 펼친다), 그 밖의 주소는 주소 시험이다.
 * 진행 중이면 새 시험을 시작하지 않는다. `args`는 호스트 키 확인 뒤 다시 돌릴 때만 준다.
 */
export function useRowProbe(): RowProbeHandle {
  const connection = useCommands().connection;
  const [row, dispatchRow] = useReducer(rowProbeReducer, null);
  const dispatch = (action: ProbeAction): void => {
    dispatchRow({ type: "probe", action });
  };
  const run = (entry: TargetEntry, args: ProbeRunArgs = {}): void => {
    if (row?.probe.busy === true) return;
    dispatchRow({ type: "begin", id: entry.id });
    const target = sshTargetOfAddress(entry.address);
    detach(
      target === null
        ? testAddress(connection, entry.address, dispatch)
        : runPreflight(connection, target, args, dispatch).then(() => undefined),
      rethrow,
    );
  };
  return { row, run };
}
