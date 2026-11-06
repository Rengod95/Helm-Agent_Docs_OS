import { describe, expect, test } from "bun:test";
import { startPointsOf, type TabRead } from "@fresnel/client/workbench";
import type {
  DevkitIssue,
  ExtensionKind,
  KindEntry,
  PackResult,
} from "@fresnel/contracts/services";
import { renderToString } from "react-dom/server";
import {
  PlaceFields,
  StartGrid,
  StartPicker,
} from "../../../src/views/compose/compose-new-group-form.tsx";
import {
  CheckNotice,
  FailedNotice,
  MadeResult,
} from "../../../src/views/compose/compose-new-group-result.tsx";

// "새 그룹" 시작 화면의 서버 렌더. 글, 상태 가르기, aria 속성만 본다(입력과 클릭은 DOM이 없어 시험하지 않는다).

const NOOP = (): void => {};

function kindOf(id: ExtensionKind, status: KindEntry["status"], title: string): KindEntry {
  return {
    id,
    title,
    layers: ["L3"],
    status,
    since: "2026-11",
    requires: { contracts: "1" },
    checks: [],
    decisions: [],
    security: [],
  };
}

/** 글을 품은 단추 하나의 HTML. 여는 태그부터 그 단추의 내용까지 */
function buttonWith(html: string, text: string): string {
  const piece = html.split("<button").find((part) => part.includes(text));
  return piece === undefined ? "" : `<button${piece}`;
}

/** 글을 품은 시작점 칸 하나의 HTML. 칸은 단추가 아니라 role="radio"인 div라서 따로 찾는다 */
function radioWith(html: string, text: string): string {
  const piece = html.split('role="radio"').find((part) => part.includes(text));
  return piece === undefined ? "" : `<div role="radio"${piece}`;
}

const POINTS = startPointsOf([
  kindOf("single-plugin", "stable", "플러그인 하나"),
  kindOf("plugin-group", "blocked", "플러그인 그룹"),
]);

describe("StartGrid", () => {
  test("고를 수 없는 종류는 aria-disabled이고 Tab 순서에서 빠진다", () => {
    const html = renderToString(
      <StartGrid points={POINTS} selected="single-plugin" onPick={NOOP} />,
    );
    const blocked = radioWith(html, "플러그인 그룹");
    expect(blocked).toContain('aria-disabled="true"');
    expect(blocked).toContain('tabindex="-1"');
    expect(blocked).toContain("지금 막혀 있어요");
    expect(blocked).toContain('aria-checked="false"');
  });

  test("고른 종류는 aria-checked이고, 고를 수 있는 종류는 Tab 순서에 든다", () => {
    const html = renderToString(
      <StartGrid points={POINTS} selected="single-plugin" onPick={NOOP} />,
    );
    const chosen = radioWith(html, "플러그인 하나");
    expect(chosen).toContain('aria-checked="true"');
    expect(chosen).toContain('aria-disabled="false"');
    expect(chosen).toContain('tabindex="0"');
    expect(chosen).not.toContain("지금 막혀 있어요");
  });

  test("준비 중(미리 보기) 종류는 고를 수 있고 미리 보기 주석이 붙는다", () => {
    const html = renderToString(
      <StartGrid
        points={startPointsOf([kindOf("plugin-group", "preview", "플러그인 그룹")])}
        selected={null}
        onPick={NOOP}
      />,
    );
    const preview = radioWith(html, "플러그인 그룹");
    expect(preview).toContain("미리 보기");
    expect(preview).toContain('aria-disabled="false"');
  });

  test("고른 것이 없으면 aria-checked=true가 하나도 없다", () => {
    const html = renderToString(<StartGrid points={POINTS} selected={null} onPick={NOOP} />);
    expect(html.match(/aria-checked="true"/g)).toBeNull();
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
  });
});

describe("StartPicker", () => {
  test("읽는 중이면 상태 표시와 읽는 중 글을 그린다", () => {
    const html = renderToString(
      <StartPicker read={{ kind: "loading" }} selected={null} onPick={NOOP} onRetry={NOOP} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("읽는 중이에요");
  });

  test("연결이 없으면 오프라인 글이고 격자는 없다", () => {
    const html = renderToString(
      <StartPicker read={{ kind: "offline" }} selected={null} onPick={NOOP} onRetry={NOOP} />,
    );
    expect(html).toContain("엔진에 연결되어 있지 않아 읽지 못해요.");
    expect(html).not.toContain('role="radiogroup"');
  });

  test("읽기가 실패하면 경고와 다시 읽기 단추를 보인다", () => {
    const html = renderToString(
      <StartPicker read={{ kind: "error" }} selected={null} onPick={NOOP} onRetry={NOOP} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("시작점을 읽지 못했어요.");
    expect(html).toContain("다시 읽기");
  });

  test("종류가 하나도 없으면 빈 상태를 그린다", () => {
    const read: TabRead<readonly KindEntry[]> = { kind: "ready", value: [], stale: false };
    const html = renderToString(
      <StartPicker read={read} selected={null} onPick={NOOP} onRetry={NOOP} />,
    );
    expect(html).toContain("시작점 없음");
    expect(html).toContain("플러그인 빌더의 종류 카탈로그가 비어 있어요.");
  });

  test("값이 있으면 격자를 그리고, 낡은 값이면 그 사실을 보인다", () => {
    const read: TabRead<readonly KindEntry[]> = {
      kind: "ready",
      value: [kindOf("single-plugin", "stable", "플러그인 하나")],
      stale: true,
    };
    const html = renderToString(
      <StartPicker read={read} selected={null} onPick={NOOP} onRetry={NOOP} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("플러그인 하나");
    expect(html).toContain("마지막으로 읽은 값이에요.");
  });
});

describe("PlaceFields", () => {
  const base = { onName: NOOP, onParent: NOOP, onPick: NOOP, pickFailed: false } as const;

  test("예약 규칙에 어긋난 이름이면 패턴 오류 문장을 보인다", () => {
    const html = renderToString(
      <PlaceFields
        {...base}
        draft={{ name: "Helm", kind: null, parentDir: "/work" }}
        canPick={false}
      />,
    );
    expect(html).toContain("소문자로 시작하고 소문자, 숫자, 하이픈만 써서 2~32자로 지어요");
    expect(html).toContain('role="alert"');
  });

  test("맞는 이름이면 오류가 없고 만들 위치는 부모와 이름을 잇는다", () => {
    const html = renderToString(
      <PlaceFields
        {...base}
        draft={{ name: "lens-review", kind: null, parentDir: "/work/" }}
        canPick={false}
      />,
    );
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('value="/work/lens-review"');
  });

  test("폴더 고르기는 창을 열 수 있을 때만 그린다", () => {
    const draft = { name: "", kind: null, parentDir: "" };
    expect(renderToString(<PlaceFields {...base} draft={draft} canPick={false} />)).not.toContain(
      "폴더 고르기",
    );
    expect(renderToString(<PlaceFields {...base} draft={draft} canPick />)).toContain(
      "폴더 고르기",
    );
  });

  test("폴더 고르기가 실패하면 입력은 그대로 두고 한 줄로 알린다", () => {
    const html = renderToString(
      <PlaceFields {...base} draft={{ name: "", kind: null, parentDir: "" }} canPick pickFailed />,
    );
    expect(html).toContain("폴더 고르는 창을 열지 못했어요. 경로를 직접 적어도 돼요.");
  });
});

describe("CheckNotice", () => {
  const error: DevkitIssue = {
    severity: "error",
    code: "AU-001",
    path: "manifest.name",
    message: "이름이 없어요",
  };
  const warning: DevkitIssue = {
    severity: "warning",
    code: "AU-002",
    path: "manifest.ui",
    message: "화면 선언이 비어 있어요",
  };

  test("오류가 있으면 danger 띠에 개수를 적고 문제 줄을 코드와 함께 보인다", () => {
    const html = renderToString(<CheckNotice check={{ kind: "done", issues: [error, warning] }} />);
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("검사에서 막힌 곳이 1개 있어요. 경고가 1개 있어요.");
    expect(html).toContain("AU-001");
    expect(html).toContain("이름이 없어요");
    expect(html).toContain("AU-002");
  });

  test("경고만 있으면 warning 띠이고 경고 개수만 적는다", () => {
    const html = renderToString(<CheckNotice check={{ kind: "done", issues: [warning] }} />);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain("경고가 1개 있어요.");
    expect(html).not.toContain('role="alert"');
  });

  test("문제가 없으면 success 띠로 통과를 알린다", () => {
    const html = renderToString(<CheckNotice check={{ kind: "done", issues: [] }} />);
    expect(html).toContain('data-tone="success"');
    expect(html).toContain("검사를 통과했어요.");
  });

  test("검사를 못 했으면 warning 띠로 알린다", () => {
    const html = renderToString(<CheckNotice check={{ kind: "failed" }} />);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain("검사를 하지 못했어요.");
  });
});

describe("FailedNotice", () => {
  test("호스트가 준 거절 문장이 있으면 그대로 보인다", () => {
    const html = renderToString(<FailedNotice issue="exists: 같은 이름의 폴더가 이미 있어요" />);
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain("exists: 같은 이름의 폴더가 이미 있어요");
  });

  test("거절 문장이 없으면 일반 실패 문장이다", () => {
    expect(renderToString(<FailedNotice issue={null} />)).toContain(
      "만들지 못했어요. 다시 시도해 주세요.",
    );
  });
});

describe("MadeResult", () => {
  const made = {
    kind: "made",
    dir: "/work/lens-review",
    files: ["plugin.json", "src/index.ts"],
    check: { kind: "done", issues: [] },
    pack: { kind: "idle" },
  } as const;

  test("만든 곳, 만든 파일, 검사 결과, 다음 동작 두 개를 보인다", () => {
    const html = renderToString(
      <MadeResult made={made} working={null} onRecheck={NOOP} onPack={NOOP} />,
    );
    expect(html).toContain("/work/lens-review");
    expect(html).toContain("src/index.ts");
    expect(html).toContain("검사를 통과했어요.");
    expect(html).toContain("검사 다시 돌리기");
    expect(html).toContain("설치 묶음 만들기");
    expect(html).not.toContain("묶음 경로");
  });

  test("묶음을 만들었으면 경로와 sha256을 mono로 보인다", () => {
    const result: PackResult = {
      path: "/work/lens-review.tgz",
      files: ["plugin.json"],
      sha256: "ab".repeat(32),
    };
    const html = renderToString(
      <MadeResult
        made={{ ...made, pack: { kind: "done", result } }}
        working={null}
        onRecheck={NOOP}
        onPack={NOOP}
      />,
    );
    expect(html).toContain("/work/lens-review.tgz");
    expect(html).toContain("ab".repeat(32));
    expect(html).toContain("묶음 경로");
  });

  test("다시 돌리는 중이면 그 단추만 도는 표식을 단다", () => {
    const html = renderToString(
      <MadeResult made={made} working="recheck" onRecheck={NOOP} onPack={NOOP} />,
    );
    expect(buttonWith(html, "검사 다시 돌리기")).toContain('aria-busy="true"');
    expect(buttonWith(html, "설치 묶음 만들기")).not.toContain('aria-busy="true"');
  });
});
