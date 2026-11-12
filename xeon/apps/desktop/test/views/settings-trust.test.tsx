import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { err, ok } from "@fresnel/contracts";
import { renderToString } from "react-dom/server";
import {
  TrustedFoldersView,
  savedAgeTextOf,
  trustedFoldersStateOf,
  type TrustedFoldersViewProps,
} from "../../src/views/pages/settings/settings-trust-view.tsx";

// 설정 "권한"의 작업 폴더 신뢰 표(DP-109). 읽은 결과의 모양과 판정 표 그림을 시험한다.

describe("trustedFoldersStateOf", () => {
  test("a host with trust.list gives the saved folders in its order", () => {
    expect(
      trustedFoldersStateOf(
        ok({
          entries: [
            { path: "/work/app", verdict: "allow", savedAt: "2026-11-07T01:02:03.000Z" },
            { path: "/work/old", verdict: "deny" },
          ],
        }),
      ),
    ).toEqual({
      kind: "ready",
      entries: [
        { path: "/work/app", verdict: "allow", savedAt: "2026-11-07T01:02:03.000Z" },
        { path: "/work/old", verdict: "deny" },
      ],
    });
  });

  test("an old host draws no section, and a failed read says so instead", () => {
    expect(trustedFoldersStateOf(err({ kind: "unsupported" }))).toBeNull();
    expect(trustedFoldersStateOf(err({ kind: "failed" }))).toEqual({ kind: "failed" });
  });
});

const NOW = Date.parse("2026-11-12T00:00:00.000Z");

function viewProps(
  state: TrustedFoldersViewProps["state"],
  over: Partial<TrustedFoldersViewProps> = {},
): TrustedFoldersViewProps {
  return {
    state,
    busy: new Set(),
    error: null,
    disabled: false,
    nowMs: NOW,
    onDecide: () => undefined,
    onRemove: () => undefined,
    ...over,
  };
}

describe("TrustedFoldersView", () => {
  test("each folder is a verdict row with allow and deny, and a remove button named for it", () => {
    const out = renderToString(
      <TrustedFoldersView
        {...viewProps({
          kind: "ready",
          entries: [
            { path: "/work/app", verdict: "allow", savedAt: "2026-11-11T00:00:00.000Z" },
            { path: "/work/old", verdict: "deny" },
          ],
        })}
      />,
    );
    expect(out).toContain(t("desktop.settings.trust.column.folder"));
    expect(out).toContain("/work/app");
    expect(out).toContain("/work/old");
    expect(out).toContain(t("desktop.settings.verdict.allow"));
    expect(out).toContain(t("desktop.settings.verdict.deny"));
    expect(out).not.toContain(t("desktop.settings.verdict.ask"));
    expect(out).toContain(savedAgeTextOf("2026-11-11T00:00:00.000Z", NOW));
    expect(out).not.toContain(t("desktop.settings.trust.empty"));
    // 줄마다 지우기 칸이 있고, 이름은 폴더 전체 경로를 쓴다
    expect(out.split('data-slot="verdict-remove"')).toHaveLength(3);
    expect(out).toContain(
      `aria-label="${t("desktop.settings.trust.remove", { folder: "/work/app" })}"`,
    );
    expect(out).toContain(
      `aria-label="${t("desktop.settings.trust.remove", { folder: "/work/old" })}"`,
    );
  });

  test("an empty list shows the empty text, and a failed decision shows its sentence", () => {
    const out = renderToString(
      <TrustedFoldersView {...viewProps({ kind: "ready", entries: [] }, { error: "저장 실패" })} />,
    );
    expect(out).toContain(t("desktop.settings.trust.empty"));
    expect(out).toContain("저장 실패");
    expect(out).not.toContain("/work/");
    // 빈 목록에는 지우기 칸도 없다
    expect(out).not.toContain('data-slot="verdict-remove"');
  });

  test("a failed read shows the failure, not the empty state", () => {
    const out = renderToString(<TrustedFoldersView {...viewProps({ kind: "failed" })} />);
    expect(out).toContain(t("desktop.settings.trust.loadFailed"));
    expect(out).not.toContain(t("desktop.settings.trust.empty"));
  });
});

describe("TrustedFoldersView removal", () => {
  test("a failed removal shows its sentence and keeps the folder row", () => {
    const out = renderToString(
      <TrustedFoldersView
        {...viewProps(
          { kind: "ready", entries: [{ path: "/work/app", verdict: "allow" }] },
          { error: t("desktop.settings.trust.removeFailed") },
        )}
      />,
    );
    expect(out).toContain(t("desktop.settings.trust.removeFailed"));
    expect(out).toContain("/work/app");
    expect(out).toContain('data-slot="verdict-remove"');
    expect(out).not.toContain(t("desktop.settings.trust.decideFailed"));
  });
});

describe("savedAgeTextOf", () => {
  test("a missing or unreadable time is empty text", () => {
    expect(savedAgeTextOf(undefined, NOW)).toBe("");
    expect(savedAgeTextOf("어제", NOW)).toBe("");
    expect(savedAgeTextOf("2026-11-11T00:00:00.000Z", NOW)).not.toBe("");
  });
});
