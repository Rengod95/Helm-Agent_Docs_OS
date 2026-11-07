import { describe, expect, test } from "bun:test";
import type { TrustStatus } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { TrustCardBody } from "../../src/views/trust.tsx";
import { trustCardOf, trustedToastOf } from "../../src/views/trust-model.ts";

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

const DETAILS: NonNullable<TrustStatus["details"]> = {
  mcpServers: [
    { name: "docs", command: "npx", args: ["-y", "docs-server"] },
    { name: "local", command: "./bin/local", args: [] },
  ],
  hooks: ["pre.sh"],
  skills: ["review"],
  commands: ["ship"],
  extensions: ["lint-ext"],
};

function status(patch: Partial<TrustStatus>): TrustStatus {
  return {
    projectRoot: "/work/repo",
    required: true,
    verdict: "undecided",
    via: "default",
    resources: [".mcp.json", ".fresnel/skills"],
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
      resources: [".mcp.json", ".fresnel/skills"],
      details: null,
      buttons: [
        { choice: O_FOLDER.choice, text: "이 폴더 신뢰", savedPath: "/work/repo", primary: true },
        {
          choice: O_PARENT.choice,
          text: "상위 폴더 전체 신뢰: /work",
          savedPath: "/work",
          primary: false,
        },
        {
          choice: O_SESSION.choice,
          text: "이번 실행 동안만 신뢰",
          savedPath: null,
          primary: false,
        },
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

  test("the card carries the names of the resources, and an MCP server is one line with its full command", () => {
    expect(trustCardOf(status({ details: DETAILS }))?.details).toEqual({
      mcpServers: ["docs: npx -y docs-server", "local: ./bin/local"],
      hooks: ["pre.sh"],
      skills: ["review"],
      commands: ["ship"],
      extensions: ["lint-ext"],
    });
  });
});

describe("TrustCardBody", () => {
  const card = trustCardOf(status({}));
  if (card === null) throw new Error("fixture must produce a card");

  test("shows the project, its resources and the host's choices", () => {
    const out = renderToString(<TrustCardBody card={card} sending="idle" onDecide={() => {}} />);
    expect(out).toContain("/work/repo");
    expect(out).toContain(".mcp.json");
    expect(out).toContain(".fresnel/skills");
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
    expect(failed).toContain("보내지 못했어요");
  });

  test("the MCP line is shown in full, the other groups by name, and the file paths stay listed", () => {
    const detailed = trustCardOf(status({ details: DETAILS }));
    if (detailed === null) throw new Error("fixture must produce a card");
    const out = renderToString(
      <TrustCardBody card={detailed} sending="idle" onDecide={() => {}} />,
    );
    expect(out).toContain("<code>docs: npx -y docs-server</code>");
    expect(out).toContain("<code>local: ./bin/local</code>");
    // 묶음 제목은 경고 문장과 겹치므로 제목 칸 전체로 본다
    expect(out).toContain('<div class="text-ui-sm text-text-secondary">MCP 서버</div>');
    expect(out).toContain("<code>pre.sh</code>");
    expect(out).toContain("<code>review</code>");
    expect(out).toContain("<code>ship</code>");
    expect(out).toContain("<code>lint-ext</code>");
    expect(out).toContain("<code>.mcp.json</code>");
  });

  test("without details the card lists the file paths only", () => {
    const out = renderToString(<TrustCardBody card={card} sending="idle" onDecide={() => {}} />);
    expect(out).toContain("<code>.mcp.json</code>");
    expect(out).not.toContain('<div class="text-ui-sm text-text-secondary">MCP 서버</div>');
    expect(out).not.toContain("<code>docs");
  });

  test("the parent button names the folder it will save and is a ghost button, the folder button stays solid", () => {
    const out = renderToString(<TrustCardBody card={card} sending="idle" onDecide={() => {}} />);
    expect(out).toMatch(
      /<button[^>]*data-variant="ghost"[^>]*title="\/work"[^>]*>상위 폴더 전체 신뢰: \/work<\/button>/,
    );
    expect(out).toMatch(/<button[^>]*data-variant="solid"[^>]*>이 폴더 신뢰<\/button>/);
  });
});

describe("TrustCardBody duplicate names", () => {
  test("two files with the same name each show their own line", () => {
    const twins = trustCardOf(
      status({ details: { ...DETAILS, skills: [], commands: ["review", "review"] } }),
    );
    if (twins === null) throw new Error("fixture must produce a card");
    const out = renderToString(<TrustCardBody card={twins} sending="idle" onDecide={() => {}} />);
    expect(out.split("<code>review</code>").length - 1).toBe(2);
  });
});

describe("trustedToastOf", () => {
  test("a trusted folder names the folder, a trusted parent names the saved parent folder", () => {
    expect(trustedToastOf(status({ verdict: "allow", via: "store" }), O_FOLDER.choice)).toBe(
      "이 폴더를 신뢰했어요: /work/repo",
    );
    expect(trustedToastOf(status({ verdict: "allow", via: "store" }), O_PARENT.choice)).toBe(
      "상위 폴더를 신뢰했어요: /work",
    );
  });

  test("a session trust is not saved, so it names the work folder", () => {
    expect(
      trustedToastOf(status({ verdict: "allow", via: "sessionMemory" }), O_SESSION.choice),
    ).toBe("이 폴더를 신뢰했어요: /work/repo");
  });

  test("no toast when the decision did not leave the folder trusted", () => {
    expect(trustedToastOf(status({ verdict: "deny", via: "store" }), O_DENY.choice)).toBeNull();
    expect(
      trustedToastOf(status({ verdict: "undecided", via: "headless" }), O_FOLDER.choice),
    ).toBeNull();
  });
});
