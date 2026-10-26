import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { keepTools } from "../../src/app/setup.ts";
import { binaryViewOf, setupSteps, type SetupSnapshot } from "../../src/settings/index.ts";
import { SettingsBody, Steps, Tools, type KeyEntry } from "../../src/views/settings.tsx";

const noop = (): void => {};

function body(
  snapshot: SetupSnapshot,
  over: { providerInput?: string; modelInput?: string; keyEntry?: KeyEntry } = {},
): string {
  return renderToString(
    <SettingsBody
      snapshot={snapshot}
      providerInput={over.providerInput ?? "anthropic"}
      modelInput={over.modelInput ?? ""}
      keyEntry={over.keyEntry ?? { state: "idle" }}
      busy={false}
      message={null}
      onProvider={noop}
      onModel={noop}
      onRegister={noop}
      onConnect={noop}
      onRecheck={noop}
      onSaveModel={noop}
    />,
  );
}

const EMPTY: SetupSnapshot = {
  providers: [],
  defaultModel: null,
  secrets: [],
  toolsReady: null,
  binaries: null,
};

describe("settings screen", () => {
  test("a fresh install shows the three steps open, the doctor hint and no key input", () => {
    const out = body(EMPTY);
    expect(out.match(/data-done="no"/g)?.length).toBe(3);
    expect(out).toContain("xeon doctor");
    expect(out).toContain("anthropic-api-key");
    expect(out).toContain("등록되지 않음");
    expect(out).toContain("키 등록");
    // 입력란은 provider와 모델 둘뿐이다. 비밀 값을 받는 password 입력이 없다
    expect(out).not.toContain('type="password"');
    expect(out.match(/<input/g)?.length).toBe(2);
  });

  test("a registered secret that is not linked offers the connect button; a linked one says so", () => {
    const registered: SetupSnapshot = {
      ...EMPTY,
      secrets: [{ name: "anthropic-api-key", registered: true }],
    };
    const unlinked = body(registered);
    expect(unlinked).toContain("등록됨");
    expect(unlinked).toContain("키 바꾸기");
    expect(unlinked).not.toContain("provider에 연결됨");
    expect(unlinked).toMatch(/<button[^>]*type="button"[^>]*>provider에 연결</);
    const linked = body({
      ...registered,
      providers: [
        {
          id: "anthropic",
          enabled: true,
          apiKeyRef: "secret://anthropic-api-key",
          baseUrl: null,
        },
      ],
      defaultModel: "anthropic/claude-sonnet-5-5",
    });
    expect(linked).toContain("provider에 연결됨");
    expect(linked).toContain("anthropic/claude-sonnet-5-5</span>");
    expect(linked).toMatch(/<button[^>]*disabled[^>]*>provider에 연결</);
  });

  test("when the host cannot take the key it shows the terminal command, never an input for the value", () => {
    const out = body(EMPTY, {
      keyEntry: { state: "terminal", command: "xeon secret add anthropic-api-key" },
    });
    expect(out).toContain("xeon secret add anthropic-api-key");
    expect(out).not.toContain('type="password"');
  });

  test("an invalid model ref disables save and explains the format", () => {
    const out = body(EMPTY, { modelInput: "claude" });
    expect(out).toContain("형식은 provider/모델");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>저장</);
    expect(body(EMPTY, { modelInput: "anthropic/claude-sonnet-5-5" })).not.toMatch(
      /<button[^>]*disabled[^>]*>저장</,
    );
  });
});

describe("external tools table", () => {
  test("renders the check results from the report", () => {
    const view = binaryViewOf({
      platform: "linux",
      ready: false,
      blocking: ["sops"],
      degraded: [],
      items: [
        {
          name: "sops",
          need: "required",
          usedBy: "비밀 저장소",
          impact: "키를 저장할 수 없다",
          status: { kind: "missing", hint: "brew install sops" },
        },
      ],
    });
    const out = renderToString(<Tools binaries={view} />);
    expect(out).toContain("sops");
    expect(out).toContain("필수");
    expect(out).toContain("사용 불가");
    expect(out).toContain("brew install sops");
    expect(out).toContain("키를 저장할 수 없다");
  });

  test("steps mark an unknown result", () => {
    const out = renderToString(
      <Steps
        steps={setupSteps({ providers: [], defaultModel: null, secrets: null, toolsReady: null })}
      />,
    );
    expect(out.match(/확인할 수 없음/g)?.length).toBe(2);
  });
});

describe("keepTools", () => {
  test("a settings re-read keeps the earlier tool check and takes everything else from the new read", () => {
    const binaries = binaryViewOf({
      platform: "linux",
      ready: true,
      blocking: [],
      degraded: [],
      items: [],
    });
    const previous: SetupSnapshot = { ...EMPTY, toolsReady: true, binaries };
    const fresh: SetupSnapshot = {
      ...EMPTY,
      defaultModel: "anthropic/claude-sonnet-5-5",
      secrets: [{ name: "anthropic-api-key", registered: true }],
    };
    expect(keepTools(fresh, previous)).toEqual({
      providers: [],
      defaultModel: "anthropic/claude-sonnet-5-5",
      secrets: [{ name: "anthropic-api-key", registered: true }],
      toolsReady: true,
      binaries,
    });
  });
});
