import { Switch } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { BinaryView } from "@fresnel/client/settings";
import { detach, rethrow } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { CheckSteps, type CheckStep } from "../shared/check-steps.tsx";
import { StatusBand } from "../shared/status-band.tsx";
import { FieldRow } from "./settings-field.tsx";
import {
  FieldNotes,
  editableOf,
  fieldOf,
  savedEndOf,
  type PermissionPanelProps,
} from "./settings-rules-panel.tsx";
import { SettingSection } from "./settings-section.tsx";

// 설정 "샌드박스" 구역(DP-110 [결정: 2026-11-11 사용자]). 한 카드에 9개가 섞여 있던 것을 넷으로 나눈다.
//   상태    상태 띠(켜짐/꺼짐 + 한 문장) 오른쪽 끝에 켜기 스위치, 그 아래 "이 컴퓨터에서 점검"(CheckSteps: 운영체제 지원, rg, Linux면
//           bwrap·socat)과 쓸 수 없을 때·밖에서 다시 시도 두 줄.
//   쓰기와 보호, 네트워크, 그 밖   각 카드. 경로·도메인은 공용 목록 편집기(전용 편집기 `sandboxLists`).
// 샌드박스가 꺼져 있으면 아래 세 카드는 고칠 수 없고 제목 아래 "켜면 적용돼요" 한 줄이 붙는다.
// 점검은 `setup.load({ binaries: true })`의 외부 도구 점검이다. 엔진의 6항목 자가 시험 결과(`SandboxStatus.lastSelfTest`)는
// wire에 없어 보이지 않는다(보고). 점검은 구역이 열릴 때 한 번 하고 "다시 시험"으로 다시 한다.

const ENABLED_KEY: SettingKey = "l0.sandbox.enabled";

const STATUS_KEYS: readonly SettingKey[] = ["l0.sandbox.onUnavailable", "l0.sandbox.escapeRetry"];
const WRITE_KEYS: readonly SettingKey[] = [
  "l0.sandbox.writeRoots.extra",
  "l0.sandbox.protectedPaths.extra",
];
const NETWORK_KEYS: readonly SettingKey[] = ["l0.sandbox.network.blockedDomains"];
const OTHER_KEYS: readonly SettingKey[] = [
  "l0.sandbox.credentialFiles",
  "l0.sandbox.nestedNamespaces",
];

/** 점검 결과. 아직 안 했으면 `idle`, 하는 중이면 `running`, 셸이 점검을 돌려주지 않았으면 `none` */
export type SandboxCheck =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly binaries: BinaryView | null; readonly elapsedMs: number };

/** 운영체제마다 샌드박스가 쓰는 외부 도구 */
const TOOLS_OF_PLATFORM: Readonly<Record<string, readonly string[]>> = {
  darwin: ["rg"],
  linux: ["rg", "bwrap", "socat"],
  win32: [],
};

/** 점검 결과를 단계 줄로. 운영체제 지원이 먼저이고, 도구는 그 운영체제가 쓰는 것만 */
export function sandboxCheckStepsOf(check: SandboxCheck): readonly CheckStep[] {
  const osLabel = t("desktop.settings.sandbox.check.os");
  if (check.kind === "idle" || check.kind === "running") {
    const state = check.kind === "running" ? "running" : "waiting";
    return [{ id: "os", label: osLabel, state }];
  }
  if (check.kind === "failed" || check.binaries === null) {
    return [
      {
        id: "os",
        label: osLabel,
        state: "failed",
        detail: t("desktop.settings.sandbox.check.noReport"),
        fix: t("desktop.settings.sandbox.check.noReportFix"),
      },
    ];
  }
  const { platform, rows } = check.binaries;
  const supported = platform === "darwin" || platform === "linux";
  const os: CheckStep = {
    id: "os",
    label: osLabel,
    state: supported ? "passed" : "failed",
    detail: t(
      platform === "darwin"
        ? "desktop.settings.sandbox.check.os.darwin"
        : platform === "linux"
          ? "desktop.settings.sandbox.check.os.linux"
          : "desktop.settings.sandbox.check.os.other",
    ),
    fix: supported ? null : t("desktop.settings.sandbox.check.os.otherFix"),
    elapsedMs: check.elapsedMs,
  };
  const tools = (TOOLS_OF_PLATFORM[platform] ?? []).map((name): CheckStep => {
    const row = rows.find((candidate) => candidate.name === name);
    if (row === undefined) {
      return { id: name, label: name, state: "skipped" };
    }
    return {
      id: name,
      label: name,
      state: row.ok ? "passed" : "failed",
      detail: row.ok ? row.note : row.impact,
      fix: row.ok ? null : row.note,
    };
  });
  return [os, ...tools];
}

function useSandboxCheck(live: boolean): {
  readonly check: SandboxCheck;
  readonly run: () => void;
} {
  const commands = useCommands();
  const [check, setCheck] = useState<SandboxCheck>({ kind: "idle" });
  // 점검을 부르고 결과만 상태에 쓴다(시작 표시는 부르는 쪽이 한다)
  const load = useCallback((): void => {
    const started = performance.now();
    detach(
      commands.setup.load({ binaries: true }).then((result) => {
        setCheck(
          result.ok
            ? {
                kind: "done",
                binaries: result.value.binaries,
                elapsedMs: performance.now() - started,
              }
            : { kind: "failed" },
        );
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);
  useEffect(() => {
    if (live) load();
  }, [live, load]);
  const run = useCallback((): void => {
    setCheck({ kind: "running" });
    load();
  }, [load]);
  return { check, run };
}

export function SandboxPanel(props: PermissionPanelProps): ReactNode {
  const enabled = fieldOf(props.view, ENABLED_KEY);
  const { check, run } = useSandboxCheck(props.live);
  const on = enabled !== undefined && enabled.value === true;
  const row = (key: SettingKey, gated: boolean): ReactNode => {
    const field = fieldOf(props.view, key);
    if (field === undefined) return null;
    return (
      <FieldRow
        key={key}
        field={field}
        editable={field.editable && (props.live || field.origin === "desktop") && (!gated || on)}
        saved={props.saved.has(key)}
        editors={props.editors}
        handlers={props.handlers}
      />
    );
  };
  const offNote = on ? undefined : t("desktop.settings.sandbox.offNote");
  return (
    <>
      <SettingSection
        title={t("desktop.settings.sandbox.status.title")}
        end={savedEndOf(props.saved, [ENABLED_KEY, ...STATUS_KEYS])}
      >
        {enabled === undefined ? null : (
          <StatusBand
            slot="sandbox-status"
            state={on ? "on" : "off"}
            tone={on ? "success" : "neutral"}
            title={t(
              on ? "desktop.settings.sandbox.status.on" : "desktop.settings.sandbox.status.off",
            )}
            description={t(
              on
                ? "desktop.settings.sandbox.status.onBody"
                : "desktop.settings.sandbox.status.offBody",
            )}
            actions={
              <Switch
                size="sm"
                aria-label={enabled.label}
                checked={on}
                disabled={!editableOf(enabled, props.live)}
                onCheckedChange={(next) => {
                  props.handlers.change(ENABLED_KEY, next);
                }}
              />
            }
          />
        )}
        {enabled === undefined || (enabled.lock === null && enabled.error === null) ? null : (
          <FieldNotes fields={[enabled]} />
        )}
        <div data-slot="sandbox-check" className="grid gap-2">
          <span className="text-ui font-medium text-text-primary">
            {t("desktop.settings.sandbox.check.title")}
          </span>
          <CheckSteps
            label={t("desktop.settings.sandbox.check.title")}
            steps={sandboxCheckStepsOf(check)}
            disabled={!props.live}
            onRetry={run}
          />
        </div>
        {STATUS_KEYS.map((key) => row(key, false))}
      </SettingSection>
      <SettingSection
        title={t("desktop.settings.sandbox.write.title")}
        description={offNote}
        end={savedEndOf(props.saved, WRITE_KEYS)}
      >
        {WRITE_KEYS.map((key) => row(key, true))}
      </SettingSection>
      <SettingSection
        title={t("desktop.settings.sandbox.network.title")}
        description={offNote}
        end={savedEndOf(props.saved, NETWORK_KEYS)}
      >
        {NETWORK_KEYS.map((key) => row(key, true))}
      </SettingSection>
      <SettingSection
        title={t("desktop.settings.sandbox.other.title")}
        description={offNote}
        end={savedEndOf(props.saved, OTHER_KEYS)}
      >
        {OTHER_KEYS.map((key) => row(key, true))}
      </SettingSection>
    </>
  );
}
