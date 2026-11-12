import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { McpServerRow } from "@fresnel/contracts/wire";
import type { CheckStep } from "../shared/check-steps.tsx";
import type { StatusDot } from "../../status-cell.tsx";
import { firstLineOf, type McpRowModel } from "./settings-mcp-model.ts";
import { blockedIdOf } from "./settings-mcp-text.ts";

// MCP 서버의 상태 점과 "연결 시험"(DP-111 [결정: 2026-11-11 사용자])의 순수 모델.
//   상태 점   연결됨·도구 ≥1 성공, 연결됐는데 도구 0개·막힘·항상 끔 경고/중립, 실패 위험, 연결 중·꺼짐 중립(Cursor와 같은 읽기).
//   연결 시험 저장 → 실행과 초기화 → 도구 목록 세 단계. 저장 뒤 `mcp.servers`를 1초마다 다시 읽어 그 서버의 상태로 단계를 채운다.
//            15초 안에 연결도 실패도 아니면 실행 단계가 시간 초과로 실패한다. 앞 단계가 실패하면 뒤 단계는 건너뜀이다.

/** 다시 읽는 간격과 상한(밀리초) */
export const TEST_POLL_MS = 1000;
export const TEST_DEADLINE_MS = 15_000;

/** 줄의 상태 점 색 */
export function dotToneOf(
  model: Pick<McpRowModel, "alwaysBlocked" | "state" | "toolCount">,
): StatusDot {
  if (model.alwaysBlocked) return "neutral";
  switch (model.state) {
    case "connected":
      return model.toolCount > 0 ? "success" : "warning";
    case "failed":
      return "danger";
    case "blocked":
      return "warning";
    case "connecting":
    case "reconnecting":
    case "disabled":
      return "neutral";
    default:
      return assertNever(model.state, "McpServerState");
  }
}

/** 시험이 끝났는가: 연결됐거나 실패했거나 막혔거나 꺼졌다 */
export function settledOf(row: McpServerRow | undefined): boolean {
  if (row === undefined) return false;
  return row.state !== "connecting" && row.state !== "reconnecting";
}

export interface TestInput {
  /** 저장에 걸린 시간 */
  readonly saveMs: number;
  /** 저장 뒤 지난 시간 */
  readonly elapsedMs: number;
  /** 마지막으로 읽은 그 서버의 줄. 아직 목록에 없으면 `undefined` */
  readonly row: McpServerRow | undefined;
  /** 상한이 지났는가 */
  readonly timedOut: boolean;
}

function startFailOf(row: McpServerRow): { readonly detail: string; readonly fix: string } {
  if (row.alwaysBlocked) {
    return {
      detail: t("desktop.settings.mcp.state.alwaysBlocked"),
      fix: t("desktop.settings.mcp.test.fix.unblock"),
    };
  }
  if (row.state === "blocked") {
    return {
      detail:
        row.blockedReason === undefined
          ? t("desktop.settings.mcp.blocked.unknown")
          : t(blockedIdOf(row.blockedReason)),
      fix: t("desktop.settings.mcp.test.fix.blocked"),
    };
  }
  if (row.state === "disabled") {
    return {
      detail: t("desktop.settings.mcp.state.disabled"),
      fix: t("desktop.settings.mcp.test.fix.disabled"),
    };
  }
  const message = row.lastError === undefined ? "" : firstLineOf(row.lastError.message);
  const stderr = row.stderrTail?.at(-1) ?? "";
  return {
    detail: message === "" ? t("desktop.settings.mcp.state.failed") : message,
    fix:
      row.transport === "stdio"
        ? stderr === ""
          ? t("desktop.settings.mcp.test.fix.stdioQuiet")
          : t("desktop.settings.mcp.test.fix.stdio", { line: stderr })
        : t("desktop.settings.mcp.test.fix.http"),
  };
}

/** 시험 세 단계. 저장은 이미 끝났다(저장이 실패하면 시험을 열지 않는다) */
export function testStepsOf(input: TestInput): readonly CheckStep[] {
  const save: CheckStep = {
    id: "save",
    label: t("desktop.settings.mcp.test.save"),
    state: "passed",
    elapsedMs: input.saveMs,
  };
  const startLabel = t("desktop.settings.mcp.test.start");
  const toolsLabel = t("desktop.settings.mcp.test.tools");
  const { row } = input;
  if (!settledOf(row) || row === undefined) {
    if (input.timedOut) {
      return [
        save,
        {
          id: "start",
          label: startLabel,
          state: "failed",
          detail: t("desktop.settings.mcp.test.timeout", {
            seconds: Math.round(TEST_DEADLINE_MS / 1000),
          }),
          fix: t("desktop.settings.mcp.test.fix.timeout"),
          elapsedMs: input.elapsedMs,
        },
        { id: "tools", label: toolsLabel, state: "skipped" },
      ];
    }
    return [
      save,
      { id: "start", label: startLabel, state: "running" },
      { id: "tools", label: toolsLabel, state: "waiting" },
    ];
  }
  if (row.state !== "connected" || row.alwaysBlocked) {
    const fail = startFailOf(row);
    return [
      save,
      {
        id: "start",
        label: startLabel,
        state: "failed",
        detail: fail.detail,
        fix: fail.fix,
        elapsedMs: input.elapsedMs,
      },
      { id: "tools", label: toolsLabel, state: "skipped" },
    ];
  }
  return [
    save,
    {
      id: "start",
      label: startLabel,
      state: "passed",
      detail: t(
        row.transport === "stdio"
          ? "desktop.settings.mcp.test.started.stdio"
          : "desktop.settings.mcp.test.started.http",
      ),
      elapsedMs: input.elapsedMs,
    },
    row.toolCount > 0
      ? {
          id: "tools",
          label: toolsLabel,
          state: "passed",
          detail: t("desktop.settings.mcp.tools", { count: row.toolCount }),
        }
      : {
          id: "tools",
          label: toolsLabel,
          state: "failed",
          detail: t("desktop.settings.mcp.test.noTools"),
          fix: t("desktop.settings.mcp.test.fix.noTools"),
        },
  ];
}
