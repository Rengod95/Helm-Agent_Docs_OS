// P-10 고정 데이터. 계정 자격(ant-work, ant-me)은 P-11 계정 풀과 같은 이름이다.
export type SecretStatus = "ok" | "expiring" | "expired" | "unused";
export interface Secret {
  name: string;
  desc: string;
  hosts: string[];
  expires: string;
  status: SecretStatus;
  approval: string;
}

export const secrets: Secret[] = [
  {
    name: "anthropic-api-key",
    desc: "기본 모델 키",
    hosts: ["api.anthropic.com"],
    expires: "없음",
    status: "ok",
    approval: "묻지 않음",
  },
  {
    name: "github-token",
    desc: "gh CLI와 push",
    hosts: ["api.github.com", "github.com"],
    expires: "3일 뒤 (11월 2일)",
    status: "expiring",
    approval: "대화마다 한 번",
  },
  {
    name: "ant-work",
    desc: "회사 Anthropic 계정",
    hosts: ["api.anthropic.com"],
    expires: "없음",
    status: "ok",
    approval: "묻지 않음",
  },
  {
    name: "ant-me",
    desc: "개인 Anthropic 계정",
    hosts: ["api.anthropic.com"],
    expires: "없음",
    status: "ok",
    approval: "묻지 않음",
  },
  {
    name: "brave-api-key",
    desc: "Brave 검색",
    hosts: ["api.search.brave.com"],
    expires: "없음",
    status: "unused",
    approval: "묻지 않음",
  },
  {
    name: "npm-publish",
    desc: "@fresnel 패키지 배포",
    hosts: ["registry.npmjs.org"],
    expires: "만료됨 (10월 1일)",
    status: "expired",
    approval: "매번 묻기",
  },
];
