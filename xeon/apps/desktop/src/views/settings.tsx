import { detach, rethrow } from "@xeon/contracts";
import type { SecretName } from "@xeon/contracts/capabilities";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { keepTools, type SetupSnapshot } from "../app/setup.ts";
import { useLinkPhase } from "../state/engine/index.ts";
import {
  checkModelRef,
  checkProviderId,
  PRESET_PROVIDERS,
  providerSecretName,
  setupSteps,
  type BinaryView,
  type SetupStep,
} from "../settings/index.ts";
import { useCommands, type CommandError } from "./commands.ts";

// 최소 설정 화면(G2-08, L4.desktop.spec §4.14): 첫 실행 안내, 외부 도구 점검 결과, 모델 키 등록, 기본 모델.
// 요청 결과로 얻는 값이라 거울에 넣지 않고 이 화면의 로컬 상태에 둔다(FS-03, FS-04). 키 값을 받는 입력란은 없다.

const STEP_TEXT: Readonly<Record<SetupStep["id"], string>> = {
  tools: "외부 도구 점검",
  key: "모델 키 등록",
  model: "기본 모델 선택",
};

export type KeyEntry =
  | { readonly state: "idle" }
  | { readonly state: "busy" }
  /** 이 연결에서는 호스트가 값을 받을 수단이 없다. 터미널 명령을 안내한다 */
  | { readonly state: "terminal"; readonly command: string }
  | { readonly state: "failed"; readonly text: string };

export function errorText(error: CommandError): string {
  if (error.kind === "offline") return "엔진에 연결되어 있지 않습니다.";
  if (error.kind === "unsupported") return "이 엔진은 이 기능을 지원하지 않습니다.";
  if (error.kind === "rejected" && error.code !== null) {
    return `엔진이 거절했습니다 (${error.code}).`;
  }
  return "요청에 실패했습니다.";
}

export function Steps(props: { readonly steps: readonly SetupStep[] }): ReactNode {
  return (
    <ol className="setup-steps" aria-label="첫 실행 안내">
      {props.steps.map((step) => (
        <li key={step.id} data-done={step.done ? "yes" : "no"}>
          <span aria-hidden="true">{step.done ? "[x]" : "[ ]"}</span> {STEP_TEXT[step.id]}
          {step.unknown ? <span className="dim"> (확인할 수 없음)</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function Tools(props: { readonly binaries: BinaryView | null }): ReactNode {
  const { binaries } = props;
  if (binaries === null) {
    return (
      <p className="dim">
        이 연결에서는 점검 결과를 받을 수 없습니다. 터미널에서 <code>xeon doctor</code>로 확인할 수
        있습니다.
      </p>
    );
  }
  return (
    <table className="setup-tools">
      <thead>
        <tr>
          <th>도구</th>
          <th>구분</th>
          <th>상태</th>
          <th>쓰는 곳</th>
        </tr>
      </thead>
      <tbody>
        {binaries.rows.map((row) => (
          <tr key={row.name} data-ok={row.ok ? "yes" : "no"}>
            <td>
              <code>{row.name}</code>
            </td>
            <td>{row.need === "required" ? "필수" : "선택"}</td>
            <td>
              {row.ok ? "사용 가능" : "사용 불가"} <span className="dim">{row.note}</span>
              {row.ok ? null : <div className="dim">{row.impact}</div>}
            </td>
            <td className="dim">{row.usedBy}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SettingsBody(props: {
  readonly snapshot: SetupSnapshot;
  readonly providerInput: string;
  readonly modelInput: string;
  readonly keyEntry: KeyEntry;
  readonly busy: boolean;
  readonly message: string | null;
  readonly onProvider: (value: string) => void;
  readonly onModel: (value: string) => void;
  readonly onRegister: () => void;
  readonly onConnect: () => void;
  readonly onRecheck: () => void;
  readonly onSaveModel: () => void;
}): ReactNode {
  const { snapshot } = props;
  const provider = checkProviderId(props.providerInput);
  const secret = provider.ok ? providerSecretName(provider.value) : null;
  const secretName = secret?.ok === true ? secret.value : null;
  const registered =
    secretName !== null &&
    (snapshot.secrets ?? []).some((s) => s.name === secretName && s.registered);
  const linked =
    provider.ok &&
    snapshot.providers.some(
      (entry) =>
        entry.id === provider.value &&
        entry.enabled &&
        secretName !== null &&
        entry.apiKeyRef === `secret://${secretName}`,
    );
  const model = checkModelRef(props.modelInput);
  return (
    <div className="settings">
      <section>
        <h2>시작 안내</h2>
        <Steps steps={setupSteps(snapshot)} />
      </section>
      <section>
        <h2>외부 도구</h2>
        <Tools binaries={snapshot.binaries} />
      </section>
      <section>
        <h2>모델 키</h2>
        <p className="dim">
          키 값은 이 화면에 입력하지 않습니다. 호스트가 별도 경로로 받아 비밀 저장소에 두고,
          설정에는 <code>secret://이름</code> 참조만 남습니다.
        </p>
        <label className="field">
          <span>provider</span>
          <input
            type="text"
            list="provider-presets"
            value={props.providerInput}
            onChange={(event) => {
              props.onProvider(event.currentTarget.value);
            }}
          />
          <datalist id="provider-presets">
            {PRESET_PROVIDERS.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        {secretName === null ? (
          <p className="dim">provider 이름은 소문자, 숫자, 점, 밑줄, 하이픈만 쓸 수 있습니다.</p>
        ) : (
          <p>
            비밀 이름 <code>{secretName}</code> ·{" "}
            <span data-registered={registered ? "yes" : "no"}>
              {registered ? "등록됨" : "등록되지 않음"}
            </span>
            {linked ? " · provider에 연결됨" : ""}
          </p>
        )}
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy || secretName === null}
            onClick={props.onRegister}
          >
            {registered ? "키 바꾸기" : "키 등록"}
          </button>
          <button
            type="button"
            disabled={props.busy || secretName === null || !registered || linked}
            onClick={props.onConnect}
          >
            provider에 연결
          </button>
          <button type="button" disabled={props.busy} onClick={props.onRecheck}>
            다시 확인
          </button>
        </div>
        {props.keyEntry.state === "terminal" ? (
          <div role="note">
            <p>
              이 연결은 키 입력 창을 열 수 없습니다. 터미널에서 등록한 뒤 "다시 확인"을 누르세요.
            </p>
            <pre className="code">{props.keyEntry.command}</pre>
          </div>
        ) : null}
        {props.keyEntry.state === "failed" ? (
          <div className="error" role="alert">
            {props.keyEntry.text}
          </div>
        ) : null}
      </section>
      <section>
        <h2>기본 모델</h2>
        <label className="field">
          <span>provider/모델[:추론 레벨]</span>
          <input
            type="text"
            placeholder="anthropic/claude-sonnet-5-5"
            value={props.modelInput}
            onChange={(event) => {
              props.onModel(event.currentTarget.value);
            }}
          />
        </label>
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            disabled={props.busy || !model.ok}
            onClick={props.onSaveModel}
          >
            저장
          </button>
          {snapshot.defaultModel === null ? (
            <span className="dim">아직 정하지 않았습니다.</span>
          ) : (
            <span className="dim">지금 값: {snapshot.defaultModel}</span>
          )}
        </div>
        {!model.ok && props.modelInput.trim() !== "" ? (
          <p className="error">형식은 provider/모델 입니다. 예: anthropic/claude-sonnet-5-5</p>
        ) : null}
      </section>
      {props.message === null ? null : (
        <div role="status" className="dim">
          {props.message}
        </div>
      )}
    </div>
  );
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: CommandError }
  | { readonly kind: "ready"; readonly snapshot: SetupSnapshot };

export function SettingsScreen(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [providerInput, setProviderInput] = useState("anthropic");
  const [modelInput, setModelInput] = useState("");
  const [keyEntry, setKeyEntry] = useState<KeyEntry>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // `withTools`가 거짓이면(설정이 바뀌었다는 알림) 외부 도구 점검은 다시 하지 않고 앞서 읽은 결과를 유지한다
  const reload = useCallback(
    (withTools: boolean): Promise<void> => {
      return commands.setup.load({ binaries: withTools }).then((result) => {
        if (result.ok) {
          const fresh = result.value;
          setLoaded((previous) =>
            withTools || previous.kind !== "ready"
              ? { kind: "ready", snapshot: fresh }
              : { kind: "ready", snapshot: keepTools(fresh, previous.snapshot) },
          );
          // 입력란이 비어 있을 때만 지금 값을 채운다. 사용자가 고치던 글자를 덮어쓰지 않는다
          setModelInput((current) => (current === "" ? (fresh.defaultModel ?? "") : current));
        } else {
          setLoaded({ kind: "error", error: result.error });
        }
        return undefined;
      });
    },
    [commands],
  );

  // 연결이 살아나면 읽고, 설정이 바뀌었다는 알림을 받으면 다시 읽는다
  useEffect(() => {
    if (phase !== "live") return undefined;
    detach(reload(true), rethrow);
    return commands.setup.onInvalidated(() => {
      detach(reload(false), rethrow);
    });
  }, [commands, phase, reload]);

  const work = (job: () => Promise<void>): void => {
    setBusy(true);
    setMessage(null);
    detach(
      job().then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };

  const secretNameNow = (): SecretName | null => {
    const provider = checkProviderId(providerInput);
    if (!provider.ok) return null;
    const secret = providerSecretName(provider.value);
    return secret.ok ? secret.value : null;
  };

  const register = (): void => {
    const provider = checkProviderId(providerInput);
    const name = secretNameNow();
    if (!provider.ok || name === null || loaded.kind !== "ready") return;
    const exists = (loaded.snapshot.secrets ?? []).some((s) => s.name === name && s.registered);
    work(async () => {
      setKeyEntry({ state: "busy" });
      const begun = await commands.setup.beginKeyEntry(name, exists ? "set" : "add");
      if (!begun.ok) {
        setKeyEntry({ state: "failed", text: errorText(begun.error) });
        return;
      }
      if (!begun.value) {
        // 값을 받을 수단이 없다(사이드카). 취소한 경우도 같은 값이라 안내는 두 경우를 모두 말한다
        setKeyEntry({
          state: "terminal",
          command: `xeon secret ${exists ? "set" : "add"} ${name}`,
        });
        return;
      }
      setKeyEntry({ state: "idle" });
      const connected = await commands.setup.connectProviderKey(provider.value, name);
      if (!connected.ok) setKeyEntry({ state: "failed", text: errorText(connected.error) });
      await reload(false);
    });
  };

  const connect = (): void => {
    const provider = checkProviderId(providerInput);
    const name = secretNameNow();
    if (!provider.ok || name === null) return;
    work(async () => {
      const connected = await commands.setup.connectProviderKey(provider.value, name);
      setKeyEntry(
        connected.ok ? { state: "idle" } : { state: "failed", text: errorText(connected.error) },
      );
      await reload(false);
    });
  };

  const saveModel = (): void => {
    const model = checkModelRef(modelInput);
    if (!model.ok) return;
    work(async () => {
      const saved = await commands.setup.setDefaultModel(model.value);
      setMessage(saved.ok ? "기본 모델을 저장했습니다." : errorText(saved.error));
      await reload(false);
    });
  };

  return (
    <main className="main settings-screen">
      <header className="settings-header">
        <h1>설정</h1>
        <button
          type="button"
          onClick={() => {
            commands.showScreen("chat");
          }}
        >
          대화로 돌아가기
        </button>
      </header>
      {loaded.kind === "loading" ? <p className="dim">불러오는 중…</p> : null}
      {loaded.kind === "error" ? (
        <div className="error" role="alert">
          설정을 읽지 못했습니다. {errorText(loaded.error)}
        </div>
      ) : null}
      {loaded.kind === "ready" ? (
        <SettingsBody
          snapshot={loaded.snapshot}
          providerInput={providerInput}
          modelInput={modelInput}
          keyEntry={keyEntry}
          busy={busy}
          message={message}
          onProvider={(value) => {
            setProviderInput(value);
            setKeyEntry({ state: "idle" });
          }}
          onModel={setModelInput}
          onRegister={register}
          onConnect={connect}
          onRecheck={() => {
            setKeyEntry({ state: "idle" });
            work(() => reload(true));
          }}
          onSaveModel={saveModel}
        />
      ) : null}
    </main>
  );
}
