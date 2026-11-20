import { Switch } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { BinaryView } from "@fresnel/client/settings";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { SelfTestItemId, SelfTestReport } from "@fresnel/contracts/services";
import type { SandboxLastSelfTestResult } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCommands, type CommandError } from "../../commands.ts";
import { CheckSteps, type CheckStep } from "../shared/check-steps.tsx";
import { relativeAgeOf } from "../shared/relative-age.ts";
import { StatusBand } from "../shared/status-band.tsx";
import { FieldRow } from "./settings-field.tsx";
import {
  FieldNotes,
  editableOf,
  fieldOf,
  savedEndOf,
  type PermissionPanelProps,
} from "./settings-rules-panel.tsx";
import { RowNote, SettingSection } from "./settings-section.tsx";

// 설정 "샌드박스" 구역(DP-110 [결정: 2026-11-11 사용자]). 한 카드에 9개가 섞여 있던 것을 넷으로 나눈다.
//   상태    상태 띠(켜짐/꺼짐 + 한 문장) 오른쪽 끝에 켜기 스위치, 그 아래 "이 컴퓨터에서 점검"(CheckSteps: 운영체제 지원, rg, Linux면
//           bwrap·socat, 이어서 자가 시험 6항목)과 마지막 시험 시각, 쓸 수 없을 때·밖에서 다시 시도 두 줄.
//   쓰기와 보호, 네트워크, 그 밖   각 카드. 경로·도메인은 공용 목록 편집기(전용 편집기 `sandboxLists`).
// 샌드박스가 꺼져 있으면 아래 세 카드는 고칠 수 없고 제목 아래 "켜면 적용돼요" 한 줄이 붙는다.
// 점검은 두 가지다. 외부 도구 점검은 `setup.load({ binaries: true })`로 구역이 열릴 때 한 번 하고, 자가 시험 6항목은 `sandbox.lastSelfTest`로
// 마지막 보고서를 읽어 보인다(시험을 돌리지 않는다). "다시 시험"을 누르면 외부 도구 점검과 자가 시험(`sandbox.selfTest`)을 지금 돌린다.

const ENABLED_KEY: SettingKey = "l0.sandbox.enabled";

const STATUS_KEYS: readonly SettingKey[] = ["l0.sandbox.onUnavailable", "l0.sandbox.escapeRetry"];
const WRITE_KEYS: readonly SettingKey[] = [
  "l0.sandbox.writeRoots.extra",
  "l0.sandbox.protectedPaths.extra",
];
const NETWORK_KEYS: readonly SettingKey[] = ["l0.sandbox.network.blockedDomains"];
const OTHER_KEYS: readonly SettingKey[] = ["l0.sandbox.nestedNamespaces"];

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

/** 자가 시험 줄의 상태. `never`는 아직 기록이 없고, `unsupported`는 구형 host라 줄을 그리지 않는다 */
export type SelfTestView =
  | { readonly kind: "never" }
  | { readonly kind: "running" }
  | { readonly kind: "failed" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "report"; readonly report: SelfTestReport };

/** 읽거나 돌리지 못한 이유를 줄의 상태로. 구형 host(`unsupported`)는 줄을 그리지 않는다 */
function selfTestFailureOf(error: CommandError): SelfTestView {
  return error.kind === "unsupported" ? { kind: "unsupported" } : { kind: "failed" };
}

/** `sandbox.lastSelfTest` 결과를 줄의 상태로. 기록이 없으면 `never`다 */
export function selfTestViewOfLast(
  result: Result<SandboxLastSelfTestResult, CommandError>,
): SelfTestView {
  if (!result.ok) return selfTestFailureOf(result.error);
  const { report } = result.value;
  return report === null ? { kind: "never" } : { kind: "report", report };
}

/** 항목 id의 이름(짧게). 항목의 순서는 보고서가 정한다 */
function selfTestItemLabelOf(id: SelfTestItemId): string {
  switch (id) {
    case "protected_read_denied":
      return t("desktop.settings.sandbox.selfTest.item.protectedReadDenied");
    case "fresnel_data_write_denied":
      return t("desktop.settings.sandbox.selfTest.item.fresnelDataWriteDenied");
    case "network_denied":
      return t("desktop.settings.sandbox.selfTest.item.networkDenied");
    case "workspace_write_allowed":
      return t("desktop.settings.sandbox.selfTest.item.workspaceWriteAllowed");
    case "env_allowlist":
      return t("desktop.settings.sandbox.selfTest.item.envAllowlist");
    case "git_hooks_write_denied":
      return t("desktop.settings.sandbox.selfTest.item.gitHooksWriteDenied");
    default:
      return assertNever(id, "SelfTestItemId");
  }
}

/**
 * 자가 시험 줄의 단계. 보고서가 있으면 항목마다 한 단계(기대와 다른 항목은 사유와 고치는 법)이고, 없으면 상태 한 단계다.
 * 구형 host는 단계가 없다(줄을 그리지 않는다)
 */
export function sandboxSelfTestStepsOf(view: SelfTestView): readonly CheckStep[] {
  const id = "selfTest";
  const label = t("desktop.settings.sandbox.selfTest.title");
  switch (view.kind) {
    case "unsupported":
      return [];
    case "never":
      return [
        {
          id,
          label,
          state: "waiting",
          detail: t("desktop.settings.sandbox.selfTest.never"),
        },
      ];
    case "running":
      return [{ id, label, state: "running" }];
    case "failed":
      return [
        {
          id,
          label,
          state: "failed",
          detail: t("desktop.settings.sandbox.selfTest.failed"),
          fix: t("desktop.settings.sandbox.selfTest.fix"),
        },
      ];
    case "report":
      return view.report.items.map((item): CheckStep => {
        const name = selfTestItemLabelOf(item.id);
        if (item.passed) return { id: item.id, label: name, state: "passed" };
        return {
          id: item.id,
          label: name,
          state: "failed",
          detail: t("desktop.settings.sandbox.selfTest.itemFailed", { reason: item.detail ?? "" }),
          fix: t("desktop.settings.sandbox.selfTest.fix"),
        };
      });
    default:
      return assertNever(view, "SelfTestView");
  }
}

/** 마지막 시험의 상대 시각 글. 기록이 없으면 null이다 */
function ranAtTextOf(view: SelfTestView, nowMs: number): string | null {
  if (view.kind !== "report") return null;
  const age = relativeAgeOf(view.report.at, nowMs);
  return t("desktop.settings.sandbox.selfTest.ranAt", { when: t(age.id, age.args) });
}

function useSandboxCheck(live: boolean): {
  readonly check: SandboxCheck;
  readonly selfTest: SelfTestView;
  /** 자가 시험 결과를 받은 시각(상대 시각 글의 기준). 렌더 중에는 시계를 읽지 않는다 */
  readonly selfTestAt: number;
  readonly run: () => void;
} {
  const commands = useCommands();
  const [check, setCheck] = useState<SandboxCheck>({ kind: "idle" });
  const [selfTest, setSelfTest] = useState<SelfTestView>({ kind: "never" });
  const [selfTestAt, setSelfTestAt] = useState(Date.now);
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
  // 마지막 자가 시험 결과를 읽는다. 시험은 돌리지 않는다
  const readLast = useCallback((): void => {
    detach(
      commands.sandbox.lastSelfTest().then((result) => {
        setSelfTest(selfTestViewOfLast(result));
        setSelfTestAt(Date.now());
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);
  useEffect(() => {
    if (live) {
      load();
      readLast();
    }
  }, [live, load, readLast]);
  // "다시 시험": 외부 도구 점검과 자가 시험을 지금 돌린다
  const run = useCallback((): void => {
    setCheck({ kind: "running" });
    setSelfTest({ kind: "running" });
    load();
    detach(
      commands.sandbox.selfTest().then((result) => {
        setSelfTest(
          result.ok ? { kind: "report", report: result.value } : selfTestFailureOf(result.error),
        );
        setSelfTestAt(Date.now());
        return undefined;
      }),
      rethrow,
    );
  }, [commands, load]);
  return { check, selfTest, selfTestAt, run };
}

export function SandboxPanel(props: PermissionPanelProps): ReactNode {
  const enabled = fieldOf(props.view, ENABLED_KEY);
  const { check, selfTest, selfTestAt, run } = useSandboxCheck(props.live);
  const ranAt = ranAtTextOf(selfTest, selfTestAt);
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
            steps={[...sandboxCheckStepsOf(check), ...sandboxSelfTestStepsOf(selfTest)]}
            disabled={!props.live}
            onRetry={run}
          />
          {ranAt === null ? null : <RowNote>{ranAt}</RowNote>}
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
