import type { UiDecl } from "@fresnel/contracts/extensions";

// Helm의 Plugin UI 기여 일곱 개(ADR-0021 §3.10). 모두 선언형(native)이다. command 두 개는 화면 파일이 없다.
// 화면 트리는 ui/<id>.view.json이고, 트리의 데이터 경로는 메서드 결과를 메서드 이름 아래 둔 문서를 가리킨다
// (`/status`, `/inquiries`, `/findings`). 카드는 기록 payload 자체를 문서로 본다.

/** 위젯 카탈로그 v1 범위. 호스트가 싣는 버전(ext-host HOST_WIDGETS_VERSION)을 포함한다 */
const WIDGETS_RANGE = "^1.0.0";

export const helmUi: UiDecl = {
  schemaVersion: 1,
  widgets: WIDGETS_RANGE,
  // 문구 카탈로그 폴더(locales/en.json, ko.json). 제목과 화면 글은 `helm.<키>`이고 현재 로케일, 영어, 키 순으로 푼다(ADR-0021 §3.8)
  messages: "./locales",
  items: [
    {
      id: "helm-inquiry",
      placement: "page",
      title: "helm.inquiry.title",
      file: "./ui/helm-inquiry.view.json",
    },
    {
      id: "helm-panel",
      placement: "panel",
      title: "helm.inquiry.title",
      file: "./ui/helm-panel.view.json",
      when: { thread: "required" },
    },
    {
      id: "helm-finished",
      placement: "card",
      forKind: "grp.helm.inquiry.finished",
      title: "helm.finished.title",
      file: "./ui/helm-finished.view.json",
    },
    {
      id: "helm-suggested",
      placement: "card",
      forKind: "grp.helm.signal.detected",
      title: "helm.suggested.title",
      file: "./ui/helm-suggested.view.json",
    },
    {
      id: "helm-phase",
      placement: "status",
      title: "helm.phase.title",
      file: "./ui/helm-phase.view.json",
      when: { thread: "required" },
    },
    {
      id: "helm-start",
      placement: "command",
      title: "helm.command.start",
      when: { thread: "required" },
    },
    {
      id: "helm-stop",
      placement: "command",
      title: "helm.command.stop",
      when: { thread: "required" },
    },
  ],
};
