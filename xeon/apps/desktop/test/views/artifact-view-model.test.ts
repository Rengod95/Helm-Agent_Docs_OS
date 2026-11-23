import { describe, expect, test } from "bun:test";
import type { ArtifactEntry, ArtifactVersion } from "../../src/views/artifact/artifact-model.ts";
import {
  ARTIFACT_FRAME_SANDBOX,
  escapingRefsOf,
  frameRequestOf,
  latestArtifactOf,
  versionOf,
  versionOfCall,
} from "../../src/views/artifact/artifact-view-model.ts";
import { itm } from "../state/helpers.ts";

// 아티팩트 판의 순수 값 시험(artView). 셸에 무엇을 읽게 하는지(폴더, 본문, 감싸기)와 판 고르기를 값으로 맞춘다.

function version(number: number, item: number, text: string | null): ArtifactVersion {
  return { number, callId: `c${number}`, itemId: itm(item), op: "write", text };
}

const PAGE: ArtifactEntry = {
  key: "file:site/index.html",
  source: { kind: "file", path: "site/index.html" },
  kind: "html",
  title: "index.html",
  versions: [version(1, 1, "<p>one</p>"), version(2, 3, "<p>two</p>")],
  pending: false,
};

const CHART: ArtifactEntry = {
  key: "file:chart.svg",
  source: { kind: "file", path: "chart.svg" },
  kind: "svg",
  title: "chart.svg",
  versions: [version(1, 5, "<svg/>")],
  pending: false,
};

const REGISTERED: ArtifactEntry = {
  key: "artifact:art_1",
  source: { kind: "registered", artifactId: "art_1" },
  kind: "markdown",
  title: "notes",
  versions: [version(1, 2, "# hi")],
  pending: false,
};

describe("frameRequestOf", () => {
  test("셸이 만든 최신 판은 폴더의 실제 파일을 읽는다(본문 없음, 그림은 그림 틀로)", () => {
    const shell: ArtifactEntry = {
      key: "file:out/chart.svg",
      source: { kind: "file", path: "out/chart.svg" },
      kind: "svg",
      title: "chart.svg",
      versions: [{ number: 1, callId: "c1", itemId: itm(1), op: "shell", text: null }],
      pending: false,
    };
    expect(
      frameRequestOf({ entry: shell, version: shell.versions[0], workspace: "/w", local: true }),
    ).toEqual({
      kind: "frame",
      request: { root: "/w", entry: "out/chart.svg", text: null, wrap: "image" },
      stamp: "c1",
    });
  });

  test("최신 판은 프로젝트 폴더의 파일을 그대로 읽는다(본문 없음)", () => {
    expect(
      frameRequestOf({ entry: PAGE, version: PAGE.versions[1], workspace: "/w", local: true }),
    ).toEqual({
      kind: "frame",
      request: { root: "/w", entry: "site/index.html", text: null, wrap: "none" },
      stamp: "c2",
    });
  });

  test("지난 판은 대화 기록의 본문을 주고 폴더는 상대 자원에만 쓴다", () => {
    expect(
      frameRequestOf({ entry: PAGE, version: PAGE.versions[0], workspace: "/w", local: true }),
    ).toEqual({
      kind: "frame",
      request: { root: "/w", entry: "site/index.html", text: "<p>one</p>", wrap: "none" },
      stamp: "c1",
    });
  });

  test("SVG는 그림으로 감싼다", () => {
    expect(
      frameRequestOf({ entry: CHART, version: CHART.versions[0], workspace: "/w", local: true }),
    ).toEqual({
      kind: "frame",
      request: { root: "/w", entry: "chart.svg", text: null, wrap: "image" },
      stamp: "c1",
    });
  });

  test("원격 엔진은 폴더를 읽지 않고 본문만 준다", () => {
    expect(
      frameRequestOf({ entry: PAGE, version: PAGE.versions[1], workspace: "/w", local: false }),
    ).toEqual({
      kind: "frame",
      request: { root: null, entry: "site/index.html", text: "<p>two</p>", wrap: "none" },
      stamp: "c2",
    });
  });

  test("폴더 밖 경로는 폴더 없이 본문만 준다", () => {
    const outside: ArtifactEntry = {
      ...PAGE,
      key: "file:../x/page.html",
      source: { kind: "file", path: "../x/page.html" },
    };
    expect(
      frameRequestOf({
        entry: outside,
        version: outside.versions[1],
        workspace: "/w",
        local: true,
      }),
    ).toEqual({
      kind: "frame",
      request: { root: null, entry: "page.html", text: "<p>two</p>", wrap: "none" },
      stamp: "c2",
    });
  });

  test("등록 아티팩트는 정해진 이름과 본문으로 그린다", () => {
    expect(
      frameRequestOf({
        entry: REGISTERED,
        version: REGISTERED.versions[0],
        workspace: "/w",
        local: true,
      }),
    ).toEqual({
      kind: "frame",
      request: { root: null, entry: "artifact.md", text: "# hi", wrap: "none" },
      stamp: "c1",
    });
  });

  test("판이 없거나 본문이 없으면 글로 알린다", () => {
    expect(
      frameRequestOf({ entry: PAGE, version: undefined, workspace: "/w", local: true }),
    ).toEqual({ kind: "none", reason: "desktop.artifact.note.pending" });
    const image: ArtifactEntry = {
      ...CHART,
      kind: "image",
      source: { kind: "file", path: "a.png" },
      versions: [version(1, 1, null)],
    };
    expect(
      frameRequestOf({ entry: image, version: image.versions[0], workspace: "/w", local: false }),
    ).toEqual({ kind: "none", reason: "desktop.artifact.note.remote" });
  });
});

describe("판 고르기", () => {
  test("latestArtifactOf는 마지막 판이 대화에서 가장 뒤인 것", () => {
    const ids = [itm(1), itm(2), itm(3), itm(4), itm(5)];
    expect(latestArtifactOf([PAGE, CHART, REGISTERED], ids)?.key).toBe("file:chart.svg");
    expect(latestArtifactOf([PAGE, REGISTERED], ids)?.key).toBe("file:site/index.html");
    expect(latestArtifactOf([], ids)).toBeUndefined();
  });

  test("versionOf는 범위 밖이나 null이면 최신 판", () => {
    expect(versionOf(PAGE, 1)?.number).toBe(1);
    expect(versionOf(PAGE, null)?.number).toBe(2);
    expect(versionOf(PAGE, 9)?.number).toBe(2);
    expect(versionOf(PAGE, 0)?.number).toBe(2);
  });

  test("versionOfCall은 그 호출이 만든 판", () => {
    const found = versionOfCall([CHART, PAGE], "c1");
    expect(found?.entry.key).toBe("file:chart.svg");
    expect(found?.version.number).toBe(1);
    expect(versionOfCall([PAGE], "zz")).toBeUndefined();
  });
});

describe("escapingRefsOf", () => {
  const refs = ["../style.css", "../../secret.png", "/etc/passwd", "file:///x", "../a/../../b"];

  test("하위 폴더의 ../는 프로젝트 안이라 빼고, 더 올라가는 것만 남긴다", () => {
    expect(escapingRefsOf(refs, { root: "/w", entry: "site/index.html" })).toEqual([
      "../../secret.png",
      "/etc/passwd",
      "file:///x",
      "../a/../../b",
    ]);
  });

  test("폴더 맨 위 파일의 ../는 모두 밖", () => {
    expect(escapingRefsOf(["../a.css"], { root: "/w", entry: "index.html" })).toEqual(["../a.css"]);
  });

  test("폴더 없이 그리는 판은 그대로 둔다", () => {
    expect(escapingRefsOf(refs, { root: null, entry: "index.html" })).toEqual(refs);
  });
});

describe("가둔 틀", () => {
  test("sandbox는 스크립트만 허락하고 같은 출처를 주지 않는다", () => {
    expect(ARTIFACT_FRAME_SANDBOX.split(" ")).toEqual(["allow-scripts"]);
  });
});
