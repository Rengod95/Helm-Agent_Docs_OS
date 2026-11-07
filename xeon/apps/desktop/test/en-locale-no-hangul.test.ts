import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { extMessageOf, type ExtMessages } from "@fresnel/client/views/native";
import { commandListView } from "@fresnel/client/settings";
import { parseJson } from "@fresnel/contracts";
import type { CommandListResult } from "@fresnel/contracts/wire";
import { statusItemText } from "../src/views/status-item-text.ts";
import { optionLabelOf } from "../src/views/pages/settings/settings-model.ts";

// 영어 화면에 한글이 없다는 것을 고정한다(시나리오 scT S1). 사용자 입력과 고유명은 대상이 아니고, 표시 언어 선택지의
// 한국어 항목은 자기 이름(`한국어`)이라 제외 목록에 둔다.

const HANGUL = /[가-힣]/u;
const HELM_DIR = join(import.meta.dir, "../../../packages/group-helm");

let previous: Locale = "ko";
beforeAll(() => {
  previous = activeLocale();
  setActiveLocale("en");
});
afterAll(() => {
  setActiveLocale(previous);
});

function jsonOf(path: string): unknown {
  const parsed = parseJson(readFileSync(path, "utf8"));
  if (!parsed.ok) throw new Error(`${path} does not parse`);
  return parsed.value;
}

function commandOf(name: string, description: string, hint: string | null) {
  return {
    name,
    description,
    argumentHint: hint,
    args: [],
    kind: "action" as const,
    source: "capability" as const,
    origin: "x",
    hasShell: false,
  };
}

/** 트리 JSON에서 `props`의 문자열 값(정적 글)을 모은다. 바인드 경로나 조건 값은 `props`가 아니라서 들지 않는다 */
function staticTexts(node: unknown): string[] {
  if (typeof node !== "object" || node === null) return [];
  const entries: [string, unknown][] = Object.entries(node);
  const props = entries.flatMap(([name, value]) =>
    name === "props" && typeof value === "object" && value !== null
      ? Object.values(value).filter((v): v is string => typeof v === "string")
      : [],
  );
  const children = entries.flatMap(([name, value]) =>
    name === "children" && Array.isArray(value) ? value.flatMap(staticTexts) : [],
  );
  return [...props, ...children];
}

describe("en locale: no Hangul on the main screen models", () => {
  test("status segments: every core.turn text and the usage text", () => {
    const turns = ["idle", "running", "approval", "question"].map((turn) =>
      statusItemText({
        id: "core.turn",
        text: "대기",
        textKey: `desktop.status.core.turn.${turn}`,
      }),
    );
    const usage = statusItemText({
      id: "core.usage",
      text: "턴 합계 1.5k 토큰 · $0.03",
      textKey: "desktop.status.core.usage",
      textArgs: { tokens: 1500, usd: 0.03 },
    });
    expect([...turns, usage].filter((text) => HANGUL.test(text))).toEqual([]);
    expect(turns).toEqual(["Idle", "Running", "Waiting for approval", "Waiting for an answer"]);
    expect(usage).toBe("Turn total 1.5K tokens · $0.03");
  });

  test("slash command list: the engine's Korean descriptions and hints are replaced", () => {
    const list: CommandListResult = {
      commands: [
        commandOf("plan", "계획 모드", "[exit | approve | reject [사유] | revise <피드백>]"),
        commandOf("tasks", "작업 목록을 보여 준다", null),
        commandOf("goal", "완료 조건", "<조건> | status | clear"),
        commandOf("helm", "사용법: /helm start [주제] | stop | status", null),
        commandOf("learning", "학습 승인 대기열과 검토(/learning queue | review)", null),
      ],
    };
    const rows = commandListView(list);
    expect(
      rows.flatMap((row) => [row.description, row.hint ?? ""]).filter((t) => HANGUL.test(t)),
    ).toEqual([]);
    expect(rows.find((row) => row.name === "tasks")?.description).toBe("Show the task list");
  });

  test("Helm plugin screens: titles and static texts resolve to English", () => {
    const en = jsonOf(join(HELM_DIR, "locales/en.json"));
    if (typeof en !== "object" || en === null) throw new Error("en.json is not an object");
    const messages: ExtMessages = {
      en: Object.fromEntries(
        Object.entries(en).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
      ),
    };
    const files = readdirSync(join(HELM_DIR, "ui")).filter((name) => name.endsWith(".view.json"));
    expect(files.length).toBe(5);
    const texts = files.flatMap((name) =>
      staticTexts(jsonOf(join(HELM_DIR, "ui", name))).map((key) =>
        extMessageOf(messages, "en", key),
      ),
    );
    const titles = [
      "helm.inquiry.title",
      "helm.finished.title",
      "helm.suggested.title",
      "helm.phase.title",
      "helm.command.start",
      "helm.command.stop",
    ].map((key) => extMessageOf(messages, "en", key));
    expect([...texts, ...titles].filter((text) => HANGUL.test(text))).toEqual([]);
    expect(titles).toEqual([
      "Inquiry",
      "Inquiry result",
      "Inquiry suggestion",
      "Inquiry phase",
      "Start inquiry…",
      "Stop inquiry",
    ]);
  });

  test("display language options use each language's own name, the only Hangul allowed", () => {
    expect(optionLabelOf("l4.ui.locale", "auto")).toBe("Follow system");
    expect(optionLabelOf("l4.ui.locale", "en")).toBe("English");
    expect(optionLabelOf("l4.ui.locale", "ko")).toBe("한국어");
  });
});
