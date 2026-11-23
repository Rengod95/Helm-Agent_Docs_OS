import { catalogOf, tKey } from "@fresnel/client/i18n";

// 플러그인이 낸 확인 카드의 제목은 저장된 영어 표시 이름(예: "Plugin Builder")이다. 저장된 글은 그대로 두고 화면에서만
// 카탈로그의 `ext.name.*`(영어 값이 같은 항목)로 현재 언어의 이름으로 푼다. 모르는 제목은 그대로다.

const EXT_NAME_PREFIX = "ext.name.";

/** 영어 표시 이름이 카탈로그의 플러그인 이름과 같으면 현재 언어의 이름, 아니면 받은 글 그대로 */
export function localizedPluginTitle(title: string): string {
  for (const [id, english] of Object.entries(catalogOf("en"))) {
    if (id.startsWith(EXT_NAME_PREFIX) && english === title) return tKey(id, title);
  }
  return title;
}
