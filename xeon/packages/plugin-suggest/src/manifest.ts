import { KnowledgeLedger } from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionManifest, type UiDecl } from "@fresnel/contracts/extensions";
import { suggestMethodDecls } from "./methods.ts";

// 제안 플러그인의 매니페스트 상수. 번들 빌드(scripts/build-plugin.ts)가 이 값을 `.fresnel-plugin/plugin.json`으로 옮겨 쓴다.
// 보통 플러그인이다(orchestration 없음, 구성원 없음). 모델 도구와 훅은 없다. 기능은 `knowledge.ledger` 하나를 읽는다.

/** 화면 한 장: 제목과 안내 글만 있는 선언형 화면. 목록은 데스크톱이 호스트 wire로 그린다 */
const suggestUi: UiDecl = {
  schemaVersion: 1,
  widgets: "^1.0.0",
  // 문구 카탈로그 폴더(locales/en.json, ko.json). 제목과 화면 글은 `suggest.<키>`이고 현재 로케일, 영어, 키 순으로 푼다
  messages: "./locales",
  items: [
    {
      id: "suggest",
      placement: "page",
      mode: "native",
      title: "suggest.page.title",
      file: "./ui/suggest.view.json",
    },
  ],
};

export const suggestManifest: ExtensionManifest = defineManifest({
  schemaVersion: 2,
  name: "suggest",
  version: "0.1.0",
  displayName: "제안",
  purpose: "대화 중 에이전트가 낸 스킬과 메모 변경 제안을 한곳에서 봐요",
  description:
    "에이전트가 낸 스킬과 메모 변경 제안을 모아 보여 줘요. 승인하거나 거절하는 일은 사용자가 직접 해요. 이 플러그인을 끄면 제안 목록과 결정이 멈춰요.",
  entry: "./dist/index.js",
  defaultEnabled: true,
  trust: { level: "user" },
  plugins: [
    {
      layer: "L3",
      hooks: [],
      requires: [{ id: KnowledgeLedger.id, range: `^${KnowledgeLedger.version}` }],
    },
  ],
  ui: suggestUi,
  methods: suggestMethodDecls,
});
