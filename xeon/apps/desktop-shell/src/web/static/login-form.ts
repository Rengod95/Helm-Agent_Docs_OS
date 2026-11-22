// 로그인 화면(`login.ts`)의 순수 부분: 문구 표(ko/en), 코드 칸 모양 맞추기(5자 뒤 하이픈), 기본 기기 이름, 잠김 남은 시간.
// 브라우저 전역을 쓰지 않는다(시험이 바로 부른다). 로그인 스크립트 묶음에 함께 들어간다.

export type Lang = "en" | "ko";

export interface Strings {
  readonly title: string;
  readonly subtitle: string;
  readonly codeLabel: string;
  readonly nameLabel: string;
  readonly submit: string;
  readonly busy: string;
  readonly footer: string;
  readonly missing: string;
  readonly invalidCode: string;
  readonly expiredCode: string;
  readonly locked: (seconds: number) => string;
  readonly invalidName: string;
  readonly network: string;
  readonly failed: string;
}

/** 남은 초를 "n초"·"n분"으로. 1분 넘으면 분(올림)이다 */
function waitKo(seconds: number): string {
  return seconds < 60 ? `${String(seconds)}초` : `${String(Math.ceil(seconds / 60))}분`;
}

function waitEn(seconds: number): string {
  return seconds < 60 ? `${String(seconds)} s` : `${String(Math.ceil(seconds / 60))} min`;
}

export const STRINGS: Readonly<Record<Lang, Strings>> = {
  en: {
    title: "Fresnel",
    subtitle: "Connect to this computer",
    codeLabel: "Connection code",
    nameLabel: "Device name",
    submit: "Connect",
    busy: "Connecting…",
    footer: "Find the code in the Fresnel app › Settings › Remote › Connect a device.",
    missing: "Enter the code and a device name.",
    invalidCode: "The code doesn't match. Check it on the computer or make a new one.",
    expiredCode: "This code has expired. Make a new one on the computer.",
    locked: (seconds) => `Too many wrong codes. Try again in ${waitEn(seconds)}.`,
    invalidName: "Use a device name of 1 to 64 characters.",
    network: "Couldn't reach the computer. Check the connection and try again.",
    failed: "Couldn't connect. Try again.",
  },
  ko: {
    title: "Fresnel",
    subtitle: "이 컴퓨터에 연결",
    codeLabel: "연결 코드",
    nameLabel: "기기 이름",
    submit: "연결",
    busy: "연결하는 중…",
    footer: "코드는 Fresnel 앱 › 설정 › 원격 › 기기 연결에 있어요.",
    missing: "코드와 기기 이름을 넣어요.",
    invalidCode: "코드가 맞지 않아요. 컴퓨터에서 코드를 확인하거나 새로 만들어요.",
    expiredCode: "코드가 만료됐어요. 컴퓨터에서 새 코드를 만들어요.",
    locked: (seconds) => `틀린 코드가 많아 잠겼어요. ${waitKo(seconds)} 뒤에 다시 해 봐요.`,
    invalidName: "기기 이름은 1~64글자로 넣어요.",
    network: "컴퓨터에 닿지 않아요. 연결을 확인하고 다시 해 봐요.",
    failed: "연결하지 못했어요. 다시 해 봐요.",
  },
};

/** 브라우저 언어가 한국어면 한국어, 그 밖에는 영어 */
export function languageOf(language: string): Lang {
  return language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** 코드 글자 수(하이픈 뺌) */
const CODE_LENGTH = 10;
const CODE_GROUP = 5;

/**
 * 코드 칸에 보일 모양. 영문·숫자만 남겨 대문자로 올리고 10자에서 자른 뒤, 5자 뒤에 하이픈을 넣는다(`ABCDE-12345`).
 * 헷갈리는 글자(I, L, O)는 서버가 바꾸므로 여기서는 그대로 둔다.
 */
export function formatCodeInput(raw: string): string {
  const compact = raw
    .replace(/[^0-9A-Za-z]/gu, "")
    .toUpperCase()
    .slice(0, CODE_LENGTH);
  return compact.length > CODE_GROUP
    ? `${compact.slice(0, CODE_GROUP)}-${compact.slice(CODE_GROUP)}`
    : compact;
}

/** 칸의 글에서 보낼 코드(영문·숫자만) */
export function codeOfInput(text: string): string {
  return text.replace(/[^0-9A-Za-z]/gu, "").toUpperCase();
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//u, "Edge"],
  [/Firefox\/|FxiOS\//u, "Firefox"],
  [/Chrome\/|CriOS\//u, "Chrome"],
  [/Version\/[^ ]+ .*Safari\//u, "Safari"],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/iPad/u, "iPad"],
  [/iPhone/u, "iPhone"],
  [/Android/u, "Android"],
  [/Macintosh/u, "Mac"],
  [/Windows/u, "Windows"],
  [/Linux/u, "Linux"],
];

function firstMatch(table: readonly (readonly [RegExp, string])[], text: string): string | null {
  for (const [pattern, label] of table) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** 기본 기기 이름: "Safari on iPhone" 꼴(브라우저 on 기기). 사용자가 고칠 수 있다(64글자 이내) */
export function defaultDeviceName(userAgent: string): string {
  const browser = firstMatch(BROWSERS, userAgent) ?? "Browser";
  const platform = firstMatch(PLATFORMS, userAgent);
  const name = platform === null ? browser : `${browser} on ${platform}`;
  return name.slice(0, 64);
}

/**
 * 401 본문이 "기한이 지난 코드"의 답인가(`{"error":"expired_code"}`). 서버가 고정된 모양으로 답하므로 이 글자 모양만 본다.
 * 틀린 코드의 답(`invalid_code`)과 그 밖의 본문은 아니다(문구는 틀린 코드로 보인다).
 */
export function isExpiredCodeBody(body: string): boolean {
  return /"error"\s*:\s*"expired_code"/u.test(body);
}

/** `retry-after`(초)를 읽는다. 없거나 틀리면 60초 */
export function retrySecondsFrom(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  return Math.ceil(seconds);
}
