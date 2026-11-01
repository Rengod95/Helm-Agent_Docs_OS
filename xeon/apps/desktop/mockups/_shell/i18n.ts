// 묶음 E(N-49 영어 UI 스모크, 목업 전용): 화면 언어 고르기. URL ?lang=en이면 T(terms.en.ts)와 셸 자기 문구(ui.en.ts)를 영어로 바꾼다.
// 실제 앱은 메시지 키(adr.0016)와 ui.locale 설정을 쓴다. 목업은 한국어 원문을 키로 삼는 작은 사전(gettext 모양)으로 흉내 낸다.
// 규칙: 셸 문구는 L("한국어 원문")으로 감싼다. 사전에 없는 말은 한국어 그대로 남아, 영어 화면에서 "아직 키로 빼지 않은 문구"가 눈에 띈다
// (Y15 하드코딩 한국어 검사가 잡을 자리). ?lang이 없으면 아무것도 바뀌지 않는다(다른 페이지는 예전과 같다).
import { UI_EN } from "./ui.en";

export type Lang = "ko" | "en";

function readLang(): Lang {
  if (typeof window === "undefined") return "ko";
  return new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "ko";
}

/** 지금 화면 언어(모듈을 읽을 때 한 번 정한다: 바꾸면 페이지를 다시 읽는다). */
export const LANG: Lang = readLang();

// 루트 lang 속성: 한글 자간(DP-11a)이 영어 화면에서는 영문 값으로 돌아가게.
if (typeof document !== "undefined") document.documentElement.lang = LANG;

/** 셸 문구 하나. 영어 화면이면 사전 값, 없으면 원문. */
export function L(ko: string): string {
  if (LANG === "ko") return ko;
  return UI_EN[ko] ?? ko;
}

/** 페이지가 두 언어를 직접 줄 때(묶음 E 시안 페이지 문장). */
export function L2(ko: string, en: string): string {
  return LANG === "en" ? en : ko;
}

/** 언어를 바꿔 다시 읽는다(목업 전용: 실제 앱은 설정 저장 뒤 다시 그림). */
export function switchLang(lang: Lang): void {
  const url = new URL(window.location.href);
  if (lang === "ko") url.searchParams.delete("lang");
  else url.searchParams.set("lang", lang);
  window.location.assign(url.toString());
}
