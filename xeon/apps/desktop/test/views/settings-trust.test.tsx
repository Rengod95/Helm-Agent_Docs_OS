import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { renderToString } from "react-dom/server";
import {
  TrustedFoldersView,
  trustedFoldersStateOf,
} from "../../src/views/pages/settings/settings-trust-view.tsx";

// 설정 개요의 "신뢰한 폴더" 구역(읽기 전용). 읽은 결과의 모양과 그림을 시험한다.

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

describe("TrustedFoldersView", () => {
  test("lists each folder with allow or deny and says removal is not offered", () => {
    const out = renderToString(
      <TrustedFoldersView
        state={{
          kind: "ready",
          entries: [
            { path: "/work/app", verdict: "allow" },
            { path: "/work/old", verdict: "deny" },
          ],
        }}
      />,
    );
    expect(out).toContain("신뢰한 폴더");
    expect(out).toContain("/work/app");
    expect(out).toContain("허용");
    expect(out).toContain("/work/old");
    expect(out).toContain("거부");
    // 설명은 정보 아이콘의 글이다(한 번의 상호작용 뒤)
    expect(out).toContain("지금은 보기만 할 수 있어요");
    expect(out).not.toContain("신뢰하거나 거부한 폴더가 없어요");
  });

  test("an empty list shows the empty state text", () => {
    const out = renderToString(<TrustedFoldersView state={{ kind: "ready", entries: [] }} />);
    expect(out).toContain("신뢰하거나 거부한 폴더가 없어요");
    expect(out).not.toContain("/work/");
  });

  test("a failed read shows the failure, not the empty state", () => {
    const out = renderToString(<TrustedFoldersView state={{ kind: "failed" }} />);
    expect(out).toContain("신뢰한 폴더 목록을 읽지 못했어요.");
    expect(out).not.toContain("신뢰하거나 거부한 폴더가 없어요");
  });
});
