// 로그인 화면의 스크립트(spec §8.3 2). 게이트웨이가 시작 때 이 파일을 브라우저용 IIFE로 묶어 `/login.js`로 낸다.
// 문자열은 `textContent`로만 넣는다. 인라인 스크립트와 인라인 스타일을 쓰지 않는다(CSP `script-src 'self'`).
// 가져오기(import)를 쓰지 않는다: 이 파일은 묶음 하나로만 실행된다.

type Lang = "en" | "ko";
type Tone = "error" | "info";

interface Strings {
  readonly title: string;
  readonly codeLabel: string;
  readonly codeHint: string;
  readonly nameLabel: string;
  readonly submit: string;
  readonly busy: string;
  readonly missing: string;
  readonly invalidCode: string;
  readonly locked: (minutes: number) => string;
  readonly invalidName: string;
  readonly network: string;
  readonly failed: string;
}

const STRINGS: Readonly<Record<Lang, Strings>> = {
  en: {
    title: "Connect to Fresnel",
    codeLabel: "Pairing code",
    codeHint: "Enter the 10-character code shown on the computer. Spaces and hyphens are ignored.",
    nameLabel: "Device name",
    submit: "Connect",
    busy: "Connecting...",
    missing: "Enter the code and a device name.",
    invalidCode:
      "The code is wrong or has expired. Check the code on the computer or create a new one.",
    locked: (minutes) => `Too many wrong codes. Try again in about ${String(minutes)} min.`,
    invalidName: "Use a device name of 1 to 64 characters without control characters.",
    network: "Could not reach the server. Check the connection and try again.",
    failed: "Connection failed. Try again.",
  },
  ko: {
    title: "Fresnel 연결",
    codeLabel: "페어링 코드",
    codeHint: "컴퓨터에 표시된 10자리 코드를 입력하세요. 공백과 하이픈은 무시합니다.",
    nameLabel: "기기 이름",
    submit: "연결",
    busy: "연결하는 중...",
    missing: "코드와 기기 이름을 입력하세요.",
    invalidCode: "코드가 틀렸거나 만료됐어요. 컴퓨터에서 코드를 확인하거나 새 코드를 만드세요.",
    locked: (minutes) => `틀린 코드가 많아 잠겼어요. 약 ${String(minutes)}분 뒤에 다시 시도하세요.`,
    invalidName: "기기 이름은 1~64글자, 제어 문자 없이 입력하세요.",
    network: "서버에 닿지 않아요. 연결을 확인하고 다시 시도하세요.",
    failed: "연결하지 못했어요. 다시 시도하세요.",
  },
};

/** 브라우저 언어가 한국어면 한국어, 그 밖에는 영어 */
function languageOf(language: string): Lang {
  return language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//u, "Edge"],
  [/Firefox\//u, "Firefox"],
  [/Chrome\//u, "Chrome"],
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

/** 기본 기기 이름: "Safari · iPad" 꼴. 사용자가 고칠 수 있다(64글자 이내) */
function defaultDeviceName(userAgent: string): string {
  const browser = firstMatch(BROWSERS, userAgent) ?? "Browser";
  const platform = firstMatch(PLATFORMS, userAgent);
  const name = platform === null ? browser : `${browser} · ${platform}`;
  return name.slice(0, 64);
}

function elementById<T extends HTMLElement>(id: string, expected: new () => T): T {
  const found = document.getElementById(id);
  if (found instanceof expected) return found;
  throw new Error(`login page is missing #${id}`);
}

const lang = languageOf(navigator.language);
const t = STRINGS[lang];
document.documentElement.lang = lang;
document.title = t.title;

const form = elementById("pair-form", HTMLFormElement);
const codeInput = elementById("code", HTMLInputElement);
const nameInput = elementById("device-name", HTMLInputElement);
const submitButton = elementById("submit", HTMLButtonElement);
const message = elementById("message", HTMLParagraphElement);

elementById("title", HTMLHeadingElement).textContent = t.title;
elementById("code-label", HTMLLabelElement).textContent = t.codeLabel;
elementById("code-hint", HTMLParagraphElement).textContent = t.codeHint;
elementById("name-label", HTMLLabelElement).textContent = t.nameLabel;
submitButton.textContent = t.submit;
nameInput.value = defaultDeviceName(navigator.userAgent);

function show(text: string, tone: Tone): void {
  message.textContent = text;
  message.dataset.tone = tone;
  message.hidden = false;
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? t.busy : t.submit;
  form.setAttribute("aria-busy", busy ? "true" : "false");
}

/** 페어링 요청. 본문은 JSON이고 기기 종류는 웹이다 */
function requestPairing(code: string, deviceName: string): Promise<Response> {
  return fetch("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ code, deviceName, kind: "web" }),
  });
}

function minutesFrom(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.ceil(seconds / 60));
}

function handleResponse(response: Response): void {
  setBusy(false);
  if (response.ok) {
    location.assign("/");
    return;
  }
  if (response.status === 401) {
    show(t.invalidCode, "error");
    return;
  }
  if (response.status === 429) {
    show(t.locked(minutesFrom(response.headers.get("retry-after"))), "error");
    return;
  }
  if (response.status === 400) {
    show(t.invalidName, "error");
    return;
  }
  show(t.failed, "error");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();
  const deviceName = nameInput.value.trim();
  if (code === "" || deviceName === "") {
    show(t.missing, "error");
    return;
  }
  setBusy(true);
  requestPairing(code, deviceName).then(handleResponse, () => {
    setBusy(false);
    show(t.network, "error");
  });
});

// 이 파일은 묶음의 시작점이다. 모듈로 두어 화면 전역을 어지럽히지 않는다
export {};
