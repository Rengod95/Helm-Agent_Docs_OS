// 로그인 화면의 스크립트(spec §8.3 2). 게이트웨이가 시작 때 이 파일을 브라우저용 IIFE로 묶어 `/login.js`로 낸다.
// 문자열은 `textContent`로만 넣는다. 인라인 스크립트와 인라인 스타일을 쓰지 않는다(CSP `script-src 'self'`).
// `pair-link.ts`와 `login-form.ts`(문구 표, 코드 모양, 기본 기기 이름)만 가져온다(묶음에 함께 들어간다).
// 코드 칸은 한 칸이다: 입력하며 5자 뒤에 하이픈이 붙고 붙여 넣기를 받는다. 오류는 그 칸 아래 한 문장이다.
import {
  codeOfInput,
  defaultDeviceName,
  formatCodeInput,
  languageOf,
  retrySecondsFrom,
  STRINGS,
} from "./login-form.ts";
import { pairingCodeFromHash } from "./pair-link.ts";

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
const codeError = elementById("code-error", HTMLParagraphElement);
const nameError = elementById("name-error", HTMLParagraphElement);
const message = elementById("message", HTMLParagraphElement);

elementById("title", HTMLHeadingElement).textContent = t.title;
elementById("subtitle", HTMLParagraphElement).textContent = t.subtitle;
elementById("code-label", HTMLLabelElement).textContent = t.codeLabel;
elementById("name-label", HTMLLabelElement).textContent = t.nameLabel;
elementById("footer", HTMLParagraphElement).textContent = t.footer;
submitButton.textContent = t.submit;
nameInput.value = defaultDeviceName(navigator.userAgent);

type Field = "code" | "name" | "form";

function clearErrors(): void {
  for (const node of [codeError, nameError, message]) {
    node.textContent = "";
    node.hidden = true;
  }
  codeInput.removeAttribute("aria-invalid");
  nameInput.removeAttribute("aria-invalid");
}

function show(field: Field, text: string): void {
  clearErrors();
  const target = field === "code" ? codeError : field === "name" ? nameError : message;
  target.textContent = text;
  target.hidden = false;
  if (field === "code") codeInput.setAttribute("aria-invalid", "true");
  if (field === "name") nameInput.setAttribute("aria-invalid", "true");
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? t.busy : t.submit;
  form.setAttribute("aria-busy", busy ? "true" : "false");
}

// 입력하며 모양을 맞춘다(대문자, 5자 뒤 하이픈). 붙여 넣은 글도 같은 길로 지난다. 커서는 끝에 둔다
codeInput.addEventListener("input", () => {
  const formatted = formatCodeInput(codeInput.value);
  if (formatted !== codeInput.value) codeInput.value = formatted;
  if (!codeError.hidden) clearErrors();
});

/** 연결 요청. 본문은 JSON이고 기기 종류는 웹이다 */
function requestPairing(code: string, deviceName: string): Promise<Response> {
  return fetch("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ code, deviceName, kind: "web" }),
  });
}

function handleResponse(response: Response): void {
  setBusy(false);
  if (response.ok) {
    location.assign("/");
    return;
  }
  // 서버는 틀린 코드와 만료된 코드를 같은 401로 답한다(어느 쪽인지 알리지 않는다)
  if (response.status === 401) {
    show("code", t.invalidCode);
    return;
  }
  if (response.status === 429) {
    show("code", t.locked(retrySecondsFrom(response.headers.get("retry-after"))));
    return;
  }
  if (response.status === 400) {
    show("name", t.invalidName);
    return;
  }
  show("form", t.failed);
}

function submit(): void {
  const code = codeOfInput(codeInput.value);
  const deviceName = nameInput.value.trim();
  if (code === "") {
    show("code", t.missing);
    return;
  }
  if (deviceName === "") {
    show("name", t.missing);
    return;
  }
  clearErrors();
  setBusy(true);
  requestPairing(code, deviceName).then(handleResponse, () => {
    setBusy(false);
    show("form", t.network);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit();
});

// 연결 링크(`/login#code=…`)로 들어오면 코드를 채우고 바로 연결한다(단추가 "연결하는 중"이 된다).
// 조각은 곧바로 주소창에서 지운다(기록에 코드가 남지 않게)
const linkedCode = pairingCodeFromHash(location.hash);
if (linkedCode !== null) {
  history.replaceState(null, "", location.pathname + location.search);
  codeInput.value = formatCodeInput(linkedCode);
  submit();
}
