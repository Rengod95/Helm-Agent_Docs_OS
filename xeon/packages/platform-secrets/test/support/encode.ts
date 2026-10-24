// 테스트 전용: 가짜 값의 인코딩 형태를 만든다. 서비스 구현과 따로 쓴 단순한 인코더라서 구현 검증에 쓴다.

function base64Std(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function base64Url(text: string): string {
  return base64Std(text).replaceAll("+", "-").replaceAll("/", "_");
}

function noPadding(text: string): string {
  return text.replaceAll("=", "");
}

export function hexLower(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

function jsonEscaped(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

export interface Form {
  readonly label: string;
  readonly text: string;
}

/** 값 하나의 모든 인코딩 형태(Basic 인증 정렬 3종 포함). 마스킹 뒤 어느 것도 남지 않아야 한다 */
export function forms(value: string): readonly Form[] {
  const list: Form[] = [
    { label: "raw", text: value },
    { label: "base64", text: base64Std(value) },
    { label: "base64url", text: base64Url(value) },
    { label: "base64-nopad", text: noPadding(base64Std(value)) },
    { label: "url", text: encodeURIComponent(value) },
    { label: "hex-lower", text: hexLower(value) },
    { label: "hex-upper", text: hexLower(value).toUpperCase() },
    { label: "json", text: jsonEscaped(value) },
  ];
  for (const prefix of ["xyz:", "user:", "ab:"]) {
    list.push({ label: `basic-${prefix.length}`, text: base64Std(`${prefix}${value}`) });
  }
  return list;
}
