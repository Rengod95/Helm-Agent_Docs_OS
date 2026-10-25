import { describe, expect, test } from "bun:test";
import type { TrustStatus } from "@xeon/contracts/wire";
import { renderToString } from "react-dom/server";
import { TrustCardBody } from "../../src/views/trust.tsx";
import { trustCardOf } from "../../src/views/trust-model.ts";

const O_FOLDER: TrustStatus["options"][number] = {
  choice: { kind: "folder", verdict: "allow" },
  label: "trust-folder",
  savedPath: "/work/repo",
};
const O_PARENT: TrustStatus["options"][number] = {
  choice: { kind: "parent", verdict: "allow" },
  label: "trust-parent",
  savedPath: "/work",
};
const O_SESSION: TrustStatus["options"][number] = {
  choice: { kind: "session", verdict: "allow" },
  label: "trust-session",
  savedPath: null,
};
const O_DENY: TrustStatus["options"][number] = {
  choice: { kind: "folder", verdict: "deny" },
  label: "deny-folder",
  savedPath: "/work/repo",
};
const O_FUTURE: TrustStatus["options"][number] = {
  choice: { kind: "session", verdict: "deny" },
  label: "future-label",
  savedPath: null,
};
const OPTIONS: TrustStatus["options"] = [O_FOLDER, O_PARENT, O_SESSION, O_DENY, O_FUTURE];

function status(patch: Partial<TrustStatus>): TrustStatus {
  return {
    projectRoot: "/work/repo",
    required: true,
    verdict: "undecided",
    via: "default",
    resources: [".mcp.json", ".xeon/skills"],
    options: OPTIONS,
    ...patch,
  };
}

describe("trustCardOf", () => {
  test("an undecided project that needs trust gets a card with one button per host option", () => {
    const card = trustCardOf(status({}));
    expect(card).toEqual({
      projectRoot: "/work/repo",
      state: "undecided",
      resources: [".mcp.json", ".xeon/skills"],
      buttons: [
        { choice: O_FOLDER.choice, text: "이 폴더 신뢰", savedPath: "/work/repo", primary: true },
        { choice: O_PARENT.choice, text: "상위 폴더 전체 신뢰", savedPath: "/work", primary: true },
        { choice: O_SESSION.choice, text: "이번 실행 동안만 신뢰", savedPath: null, primary: true },
        {
          choice: O_DENY.choice,
          text: "이 폴더 신뢰하지 않음",
          savedPath: "/work/repo",
          primary: false,
        },
        // 모르는 식별자는 식별자 그대로 보인다
        { choice: O_FUTURE.choice, text: "future-label", savedPath: null, primary: false },
      ],
    });
  });

  test("a denied project keeps the card so the choice can be changed", () => {
    expect(trustCardOf(status({ verdict: "deny", via: "store" }))?.state).toBe("denied");
  });

  test("no card when trust is not required or the project is already trusted", () => {
    expect(
      trustCardOf(status({ required: false, verdict: "allow", via: "notRequired" })),
    ).toBeNull();
    expect(trustCardOf(status({ verdict: "allow", via: "store" }))).toBeNull();
  });
});

describe("TrustCardBody", () => {
  const card = trustCardOf(status({}));
  if (card === null) throw new Error("fixture must produce a card");

  test("shows the project, its resources and the host's choices", () => {
    const out = renderToString(<TrustCardBody card={card} sending="idle" onDecide={() => {}} />);
    expect(out).toContain("/work/repo");
    expect(out).toContain(".mcp.json");
    expect(out).toContain(".xeon/skills");
    expect(out).toContain("이 폴더 신뢰");
    expect(out).toContain("이번 실행 동안만 신뢰");
    expect(out).toContain('title="/work"');
  });

  test("a send in flight disables the buttons; a failure is announced", () => {
    const sending = renderToString(
      <TrustCardBody card={card} sending="sending" onDecide={() => {}} />,
    );
    expect(sending).toContain("보내는 중");
    expect(sending).toMatch(/<button[^>]*disabled/);
    const failed = renderToString(
      <TrustCardBody card={card} sending="failed" onDecide={() => {}} />,
    );
    expect(failed).toContain("보내지 못했습니다");
  });
});
