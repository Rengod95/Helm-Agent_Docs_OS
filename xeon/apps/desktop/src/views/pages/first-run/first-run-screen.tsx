import { t } from "@fresnel/client/i18n";
import {
  checkModelRef,
  checkProviderId,
  providerSecretName,
  submitKey,
  type KeyField,
  type SetupSnapshot,
} from "@fresnel/client/settings";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import pkg from "../../../../package.json" with { type: "json" };
import { keepTools } from "../../../app/setup.ts";
import { useEngineState, useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import {
  useCommands,
  type CommandError,
  type DefaultGroupId,
  type GroupsSnapshot,
  type SearchSnapshot,
} from "../../commands.ts";
import { errorText } from "../../settings.tsx";
import { engineLineOf, linkTextOf } from "../../status-bar.tsx";
import {
  firstRunModelOf,
  type FirstRunKeyEntry,
  type FirstRunStatus,
  type StepId,
} from "./first-run-model.ts";
import { FirstRunView, type FirstRunViewHandlers } from "./first-run-view.tsx";

// 첫 실행 화면(P-01)의 동작. 설정, 기본 그룹, 검색 권장은 명령(`commands.setup`)으로 읽고 쓴다. 단계 상태와 화면 값은 이 파일이 든다.
// 키 값은 이 파일의 어느 상태에도 들어가지 않는다: `submitKey`가 입력란을 읽는 즉시 비운다(`first-run-key.tsx`).
// 그림은 `first-run-view.tsx`, 단계 계산은 `first-run-model.ts`가 맡는다.

/** 명령 결과 하나의 상태. 읽는 중, 못 읽음, 읽음 */
type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: CommandError }
  | { readonly kind: "ready"; readonly value: T };

/** 입력한 제공자의 id와 시크릿 이름. 둘 다 규칙에 맞아야 키를 다룰 수 있다 */
function secretOf(
  providerInput: string,
): { readonly providerId: string; readonly name: SecretName } | null {
  const provider = checkProviderId(providerInput);
  if (!provider.ok) return null;
  const secret = providerSecretName(provider.value);
  return secret.ok ? { providerId: provider.value, name: secret.value } : null;
}

export function FirstRunScreen(): ReactNode {
  const commands = useCommands();
  const shell = useShellActions();
  const phase = useLinkPhase();
  const live = phase === "live";
  const engine = useEngineState();
  const [setup, setSetup] = useState<Loaded<SetupSnapshot>>({ kind: "loading" });
  const [search, setSearch] = useState<Loaded<SearchSnapshot>>({ kind: "loading" });
  const [groups, setGroups] = useState<Loaded<GroupsSnapshot>>({ kind: "loading" });
  const [providerInput, setProviderInput] = useState("anthropic");
  const [modelInput, setModelInput] = useState("");
  const [keyEntry, setKeyEntry] = useState<FirstRunKeyEntry>({ state: "idle" });
  const [open, setOpen] = useState<StepId | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 외부 도구 점검은 자식 프로세스를 띄우므로 요청한 때만 한다. 그 밖의 다시 읽기는 앞서 읽은 점검 결과를 잇는다
  const reloadSetup = useCallback(
    (withTools: boolean): Promise<void> =>
      commands.setup.load({ binaries: withTools }).then((result) => {
        if (result.ok) {
          const fresh = result.value;
          setSetup((previous) =>
            withTools || previous.kind !== "ready"
              ? { kind: "ready", value: fresh }
              : { kind: "ready", value: keepTools(fresh, previous.value) },
          );
          // 입력란이 비어 있을 때만 지금 기본 모델을 채운다. 고치던 글자를 덮지 않는다
          setModelInput((current) => (current === "" ? (fresh.defaultModel ?? "") : current));
        } else {
          setSetup({ kind: "failed", error: result.error });
        }
        return undefined;
      }),
    [commands],
  );

  const reloadGroups = useCallback(
    (): Promise<void> =>
      commands.setup.loadGroups().then((result) => {
        setGroups(
          result.ok
            ? { kind: "ready", value: result.value }
            : { kind: "failed", error: result.error },
        );
        return undefined;
      }),
    [commands],
  );

  const reloadSearch = useCallback(
    (): Promise<void> =>
      commands.setup.loadSearch().then((result) => {
        setSearch(
          result.ok
            ? { kind: "ready", value: result.value }
            : { kind: "failed", error: result.error },
        );
        return undefined;
      }),
    [commands],
  );

  const reloadAll = useCallback(
    (withTools: boolean): Promise<void> =>
      Promise.all([reloadSetup(withTools), reloadGroups(), reloadSearch()]).then(() => undefined),
    [reloadGroups, reloadSearch, reloadSetup],
  );

  // 연결이 살아나면 읽고, 설정이 바뀌었다는 알림을 받으면 다시 읽는다
  useEffect(() => {
    if (!live) return undefined;
    detach(reloadAll(true), rethrow);
    return commands.setup.onInvalidated(() => {
      detach(reloadAll(false), rethrow);
    });
  }, [commands, live, reloadAll]);

  /** 쓰기 하나를 보내는 동안 쓰기를 잠근다. 끝나면 풀린다 */
  const work = (job: () => Promise<void>): void => {
    setBusy(true);
    setNotice(null);
    detach(
      job().finally(() => {
        setBusy(false);
      }),
      rethrow,
    );
  };

  /** 키를 제공자에 잇는다. 성공하면 기본 모델 단계를 연다 */
  const connectNow = async (providerId: string, name: SecretName): Promise<void> => {
    const connected = await commands.setup.connectProviderKey(providerId, name);
    if (connected.ok) {
      setNotice(t("desktop.firstRun.key.connected"));
      setOpen("model");
    } else {
      setKeyEntry({ state: "failed", text: errorText(connected.error) });
    }
    await reloadSetup(false);
  };

  /**
   * 키 등록을 시작한다. 호스트 창이 값을 받으면 그 창에서 입력하고, 아니면 이 화면의 키 값 칸을 연다.
   * `providerId`가 null이면 검색 권장 플러그인의 키라서 저장만 한다.
   */
  const beginKey = (name: SecretName, providerId: string | null): void => {
    if (setup.kind !== "ready") return;
    const exists = (setup.value.secrets ?? []).some((s) => s.name === name && s.registered);
    const action = exists ? "set" : "add";
    work(async () => {
      const begun = await commands.setup.beginKeyEntry(name, action);
      // 호스트가 값을 받으면 그 창에서 입력한다. 연결하기는 입력이 끝난 뒤에 누른다
      if (begun.ok && begun.value) {
        setNotice(
          t(
            providerId === null
              ? "desktop.firstRun.search.hostWindow"
              : "desktop.firstRun.key.hostWindow",
          ),
        );
        await reloadSetup(false);
        return;
      }
      // 이 화면이 받을 수 없는 연결(오류)이면 실패를 보인다. 호스트 쪽 입력 창이 없는 엔진이면 이 화면의 입력 칸을 연다
      if (!begun.ok && begun.error.kind !== "unsupported") {
        setKeyEntry({ state: "failed", text: errorText(begun.error) });
        return;
      }
      setKeyEntry({ state: "form", name, action, providerId });
    });
  };

  const register = (): void => {
    const target = secretOf(providerInput);
    if (target === null) return;
    beginKey(target.name, target.providerId);
  };

  const registerSecret = (name: SecretName): void => {
    beginKey(name, null);
  };

  const submitKeyValue = (field: KeyField): void => {
    if (keyEntry.state !== "form") return;
    const { name, action, providerId } = keyEntry;
    work(async () => {
      // `submitKey`는 첫 `await` 전에 입력란을 읽고 비운다. 이 함수는 이벤트 안에서 바로 불린다
      const outcome = await submitKey(commands.setup, name, action, field);
      switch (outcome.kind) {
        case "registered":
          setKeyEntry({ state: "idle" });
          setNotice(t("desktop.firstRun.key.saved"));
          // 제공자 키는 이어서 제공자에 잇고, 검색 플러그인 키는 저장만 하고 권장 상태를 다시 읽는다
          if (providerId === null) await reloadAll(false);
          else await connectNow(providerId, name);
          return;
        case "terminal":
          setKeyEntry({ state: "failed", text: t("desktop.firstRun.key.unavailable") });
          return;
        case "empty":
          setKeyEntry({ state: "failed", text: t("desktop.settings.keyValue.empty") });
          return;
        case "failed":
          setKeyEntry({ state: "failed", text: outcome.text });
          return;
        default:
          assertNever(outcome, "KeyOutcome");
          return;
      }
    });
  };

  const connect = (): void => {
    const target = secretOf(providerInput);
    if (target === null) return;
    work(() => connectNow(target.providerId, target.name));
  };

  const saveModel = (): void => {
    const model = checkModelRef(modelInput);
    if (!model.ok) return;
    work(async () => {
      const saved = await commands.setup.setDefaultModel(model.value);
      setNotice(saved.ok ? t("desktop.settings.defaultModel.saved") : errorText(saved.error));
      await reloadSetup(false);
    });
  };

  const setGroup = (group: DefaultGroupId, on: boolean): void => {
    work(async () => {
      const written = await commands.setup.setGroupEnabled(group, on);
      if (!written.ok) setNotice(errorText(written.error));
      await reloadGroups();
    });
  };

  const dismissSearch = (): void => {
    work(async () => {
      const dismissed = await commands.setup.dismissSearchHint();
      if (!dismissed.ok) setNotice(errorText(dismissed.error));
      await reloadSearch();
    });
  };

  const setupValue = setup.kind === "ready" ? setup.value : null;
  const model =
    setupValue === null
      ? null
      : firstRunModelOf({
          setup: setupValue,
          search: search.kind === "ready" ? search.value : null,
          groups: groups.kind === "ready" ? groups.value : null,
        });
  const status: FirstRunStatus =
    setup.kind === "failed"
      ? "error"
      : !live
        ? "offline"
        : setup.kind === "ready"
          ? "ready"
          : "loading";
  const openStep: StepId = open ?? model?.next ?? "tools";

  const handlers: FirstRunViewHandlers = {
    open: (step) => {
      setOpen(step);
    },
    recheck: () => {
      work(() => reloadSetup(true));
    },
    retry: () => {
      detach(reloadAll(true), rethrow);
    },
    provider: (value) => {
      setProviderInput(value);
      setKeyEntry({ state: "idle" });
    },
    model: setModelInput,
    register,
    submitKey: submitKeyValue,
    cancelKey: () => {
      setKeyEntry({ state: "idle" });
    },
    connect,
    saveModel,
    setGroup,
    dismissSearch,
    registerSecret,
    openLightCraft: () => {
      shell.switchArea("workbench");
    },
  };

  return (
    <FirstRunView
      status={status}
      reason={setup.kind === "failed" ? errorText(setup.error) : null}
      locked={!live || busy}
      setup={setupValue}
      model={model}
      open={openStep}
      providerInput={providerInput}
      modelInput={modelInput}
      keyEntry={keyEntry}
      notice={notice}
      appVersion={pkg.version}
      engineState={`${engineLineOf(engine)} · ${t(linkTextOf(phase))}`}
      handlers={handlers}
    />
  );
}
