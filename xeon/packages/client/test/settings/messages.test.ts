import { describe, expect, test } from "bun:test";
import type { HostBinaryReport } from "@xeon/contracts/wire";
import { rotationRiskNotice } from "../../src/accounts/index.ts";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  TAB_SPECS,
  binaryViewOf,
  decisionOutcomeOf,
  keyErrorText,
  lockInfo,
  proposalListView,
  runtimeBadgeOf,
  scopeBadge,
} from "../../src/settings/index.ts";
import { effectiveOf } from "./fixtures.ts";

// 설정 모듈이 만드는 문장을 en과 ko에서 값으로 비교한다. 로케일은 읽는 동안만 바꾸고 끝나면 되돌린다.
function inLocale<T>(locale: Locale, read: () => T): T {
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return read();
  } finally {
    setActiveLocale(before);
  }
}

describe("settings sentences follow the locale", () => {
  test("tab labels and empty texts resolve when they are read", () => {
    expect(inLocale("en", () => TAB_SPECS.models.label)).toBe("Models");
    expect(inLocale("ko", () => TAB_SPECS.models.label)).toBe("모델");
    expect(inLocale("en", () => TAB_SPECS.budgets.emptyText)).toBe(
      "This tab has no budget settings yet",
    );
    expect(inLocale("ko", () => TAB_SPECS.budgets.emptyText)).toBe(
      "이 탭에는 아직 예산 설정이 없어요",
    );
  });

  test("scope, runtime and pending badges", () => {
    expect(inLocale("en", () => scopeBadge({ scope: "managed" }).text)).toBe("Managed");
    expect(inLocale("ko", () => scopeBadge({ scope: "managed" }).text)).toBe("관리");
    expect(inLocale("en", () => runtimeBadgeOf("restart", "restart"))).toEqual({
      change: "restart",
      text: "Restart needed",
      pending: "restart",
      pendingText: "Applies after a restart",
    });
    expect(inLocale("ko", () => runtimeBadgeOf("restart", "restart"))).toEqual({
      change: "restart",
      text: "재시작 필요",
      pending: "restart",
      pendingText: "재시작해야 적용돼요",
    });
  });

  test("the managed-file lock names the policy file in both locales", () => {
    const locked = effectiveOf("l1.models.x", 1, {
      locked: true,
      lockReason: "managed_file",
      source: { scope: "managed", path: "/etc/xeon/managed.json" },
    });
    expect(inLocale("en", () => lockInfo(locked)?.text)).toBe(
      "Locked by managed policy. Policy file: /etc/xeon/managed.json",
    );
    expect(inLocale("ko", () => lockInfo(locked)?.text)).toBe(
      "관리 정책으로 잠겨 있어요 정책 파일: /etc/xeon/managed.json",
    );
  });

  test("key entry errors keep the exit code and the server detail as arguments", () => {
    expect(inLocale("en", () => keyErrorText({ kind: "rejected", exitCode: 3, detail: "" }))).toBe(
      "The key could not be saved (exit code 3).",
    );
    expect(inLocale("ko", () => keyErrorText({ kind: "rejected", exitCode: 3, detail: "" }))).toBe(
      "키를 저장하지 못했습니다 (종료 코드 3).",
    );
    expect(
      inLocale("en", () => keyErrorText({ kind: "rejected", exitCode: null, detail: "" })),
    ).toBe("The key could not be saved (no exit code).");
    expect(
      inLocale("en", () => keyErrorText({ kind: "rejected", exitCode: 1, detail: "bad key" })),
    ).toBe("The key could not be saved. bad key");
    expect(inLocale("en", () => keyErrorText({ kind: "busy" }))).toBe(
      "Another key registration is in progress. Try again when it finishes.",
    );
  });

  test("binary notes for a version that is too old and for an unusable binary", () => {
    const report: HostBinaryReport = {
      platform: "linux",
      ready: false,
      blocking: ["sops"],
      degraded: [],
      items: [
        {
          name: "sops",
          need: "required",
          usedBy: "secret store",
          impact: "cannot store keys",
          status: { kind: "too_old", found: "3.7.0", required: "3.8.0" },
        },
        {
          name: "age",
          need: "required",
          usedBy: "secret store",
          impact: "cannot decrypt",
          status: { kind: "unusable", reason: "not_executable" },
        },
      ],
    };
    const noteOf = (name: string): string | undefined =>
      binaryViewOf(report)?.rows.find((row) => row.name === name)?.note;
    expect(inLocale("en", () => noteOf("sops"))).toBe("3.7.0 (needs 3.8.0 or newer)");
    expect(inLocale("ko", () => noteOf("sops"))).toBe("3.7.0 (필요 3.8.0 이상)");
    expect(inLocale("en", () => noteOf("age"))).toBe("Not usable (not_executable)");
    expect(inLocale("ko", () => noteOf("age"))).toBe("쓸 수 없음 (not_executable)");
  });

  test("proposal source, status, unavailable and empty texts", () => {
    const list = { proposals: [], unavailable: ["learning" as const], nextCursor: null };
    expect(inLocale("en", () => proposalListView(list))).toMatchObject({
      unavailableTexts: ["Could not load learning proposals"],
      emptyText: "There are no pending proposals",
    });
    expect(inLocale("ko", () => proposalListView(list))).toMatchObject({
      unavailableTexts: ["학습 제안을 불러오지 못했어요"],
      emptyText: "대기 중인 제안이 없어요",
    });
  });

  test("a failed decision keeps the reload flag and gives the sentence for the locale", () => {
    const failure = { ok: false as const, reason: "closed" as const, detail: "server text" };
    expect(inLocale("en", () => decisionOutcomeOf(failure))).toEqual({
      kind: "failed",
      text: "This proposal has already been handled. The list has been reloaded.",
      reload: true,
    });
    expect(inLocale("ko", () => decisionOutcomeOf(failure))).toEqual({
      kind: "failed",
      text: "이미 처리된 제안이에요. 목록을 새로 불러왔어요",
      reload: true,
    });
  });

  test("the rotation risk notice is English in en and the Korean sentence in ko", () => {
    const en = inLocale("en", () => rotationRiskNotice());
    expect(en.startsWith("This plugin sends requests by rotating through")).toBe(true);
    expect(/[ㄱ-ㆎ가-힣]/.test(en)).toBe(false);
    expect(inLocale("ko", () => rotationRiskNotice()).startsWith("이 플러그인은")).toBe(true);
  });
});
