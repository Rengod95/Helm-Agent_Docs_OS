import type { ScanFinding, ScanSummary } from "@xeon/contracts/capabilities";

// L2.knowledge.spec §4.6 위협 패턴 검사. 순수 함수다. 걸린 문자열은 결과에 담지 않고 규칙 이름과 줄 번호만 담는다
// (비밀 재노출 방지). 규칙을 더하거나 바꾸면 SCAN_RULESET_VERSION을 올린다.

export const SCAN_RULESET_VERSION = "1.0.0";

/** ScanSummary.findings 상한(스키마 maxItems) */
const MAX_FINDINGS = 64;

export interface ScanOptions {
  /** `scripts/` 아래 파일처럼 유출 규칙을 엄격하게 적용한다 */
  readonly strict?: boolean;
  /** `xeon.secrets` 마스킹 등록부 판정(Redactor.containsKnown). 값을 노출하지 않는다 */
  readonly containsKnown?: ((text: string) => boolean) | undefined;
}

interface PatternRule {
  readonly rule: string;
  readonly severity: "block" | "warn";
  /** g 플래그가 있는 정규식. 일치 시작 위치로 줄 번호를 구한다 */
  readonly pattern: RegExp;
  readonly strictOnly?: boolean;
}

interface LineRule {
  readonly rule: string;
  readonly severity: "block" | "warn";
  readonly test: (line: string) => boolean;
  readonly strictOnly?: boolean;
}

const NETWORK_COMMAND = /\b(?:curl|wget|nc|ncat|netcat|scp|sftp|ftp)\b/i;
const SECRET_LOCATION =
  /(?:~|\$HOME|\/home\/[^/\s]+|\/Users\/[^/\s]+)\/\.(?:ssh|aws|gnupg|netrc|config\/gcloud)|(?:^|[\s/])\.env\b|\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b|\bid_(?:rsa|ed25519)\b|\bcredentials\b/;

const PATTERN_RULES: readonly PatternRule[] = [
  // 지시 주입
  {
    rule: "injection.ignore_previous",
    severity: "block",
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)*(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions?|prompts?|messages?|rules?|guidelines?)/gi,
  },
  {
    rule: "injection.ignore_previous_ko",
    severity: "block",
    pattern:
      /(?:이전|앞선|위의?|기존|모든)\s*(?:의\s*)?(?:모든\s*)?(?:지시|지침|명령|프롬프트|규칙)[^\n]{0,24}(?:무시|잊어|따르지\s*마|따르지\s*말)/g,
  },
  {
    rule: "injection.role_override",
    severity: "block",
    pattern: /\byou\s+are\s+now\b|\bfrom\s+now\s+on,?\s+you\s+(?:are|must|will)\b|너는\s*이제/gi,
  },
  {
    rule: "injection.role_marker",
    severity: "block",
    pattern: /<\/?system\b[^>]*>|<\|(?:im_start|im_end|endoftext)\|>|\[\/?INST\]/gi,
  },
  // 우리 경계 표지
  {
    rule: "boundary.untrusted_tag",
    severity: "block",
    pattern: /<\/?untrusted_[a-z_]*content\b/gi,
  },
  // 유출
  {
    rule: "exfil.data_url",
    severity: "block",
    pattern: /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g,
  },
  {
    rule: "exfil.url_secret_var",
    severity: "block",
    pattern: /https?:\/\/\S*[?&][a-z_]*(?:token|key|secret|passw)[a-z_]*=\$\{?[A-Za-z_]+/gi,
  },
  {
    rule: "exfil.pipe_to_network",
    severity: "block",
    strictOnly: true,
    pattern: /\b(?:env|printenv|set)\s*\|\s*(?:curl|wget|nc|ncat|netcat)\b/g,
  },
  // 비밀 값 형태
  { rule: "secret.api_key", severity: "block", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { rule: "secret.github_token", severity: "block", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { rule: "secret.aws_access_key", severity: "block", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { rule: "secret.slack_token", severity: "block", pattern: /\bxox[bpas]-[A-Za-z0-9-]{10,}/g },
  {
    rule: "secret.private_key",
    severity: "block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    rule: "secret.jwt",
    severity: "block",
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  },
  // 숨은 지시
  {
    rule: "hidden.html_comment_instruction",
    severity: "warn",
    pattern:
      /<!--(?:(?!-->)[\s\S]){0,2000}?(?:ignore|disregard|you must|do not (?:tell|mention)|instruction|무시|지시|반드시|몰래)(?:(?!-->)[\s\S]){0,2000}?-->/gi,
  },
  {
    rule: "hidden.details_instruction",
    severity: "warn",
    pattern:
      /<details\b[^>]*>(?:(?!<\/details>)[\s\S]){0,3000}?(?:ignore previous|ignore all|you must|do not (?:tell|mention)|무시|반드시|몰래)(?:(?!<\/details>)[\s\S]){0,3000}?<\/details>/gi,
  },
  // 안전 우회 권유
  {
    rule: "bypass.skip_approval",
    severity: "warn",
    pattern:
      /승인\s*없이|검사를?\s*끄|확인\s*없이\s*(?:실행|적용)|--no-verify\b|without\s+(?:asking\s+for\s+|requiring\s+)?(?:approval|confirmation|permission)|disable\s+(?:the\s+)?(?:checks?|verification|safety)/gi,
  },
];

const LINE_RULES: readonly LineRule[] = [
  {
    rule: "exfil.shell_secret_read",
    severity: "block",
    test: (line) => NETWORK_COMMAND.test(line) && SECRET_LOCATION.test(line),
  },
];

/** 코드 포인트 하나가 숨은 문자 규칙에 해당하는가 */
function hiddenCharRule(codePoint: number): string | undefined {
  if (
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0x2060 ||
    codePoint === 0xfeff
  ) {
    return "hidden.zero_width";
  }
  if (
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  ) {
    return "hidden.bidi_control";
  }
  // 태그 문자(U+E0000~U+E007F)는 눈에 보이지 않는 지시를 숨기는 데 쓰인다
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return "hidden.tag_chars";
  return undefined;
}

/** 줄 시작 위치 목록(0 기반 오프셋). 줄 번호는 이분 탐색으로 구한다 */
function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/**
 * 텍스트 하나를 검사한다. `kind`는 지금 규칙 선택에 쓰이지 않지만(메모리와 스킬이 같은 규칙) 규칙 집합이 갈라질 때를
 * 위해 서명에 둔다. 메모리 쓰기는 호출자가 항상 이 함수를 부르고, 스킬 쓰기는 `write.scan` 설정을 따른다.
 */
export function scanText(
  kind: "skill" | "memory",
  text: string,
  options: ScanOptions = {},
): ScanSummary {
  const strict = options.strict === true;
  const starts = lineStarts(text);
  const found = new Map<string, ScanFinding>();
  const add = (rule: string, severity: "block" | "warn", line: number | undefined): void => {
    const key = `${rule}:${line ?? 0}`;
    if (found.has(key)) return;
    found.set(key, { rule, severity, ...(line === undefined ? {} : { line }) });
  };

  for (const rule of PATTERN_RULES) {
    if (rule.strictOnly === true && !strict) continue;
    for (const match of text.matchAll(rule.pattern)) {
      add(rule.rule, rule.severity, lineOf(starts, match.index));
    }
  }

  text.split("\n").forEach((lineText, index) => {
    for (const rule of LINE_RULES) {
      if (rule.strictOnly === true && !strict) continue;
      if (rule.test(lineText)) add(rule.rule, rule.severity, index + 1);
    }
  });

  let offset = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const hidden = hiddenCharRule(codePoint);
    // 파일 맨 앞의 BOM(U+FEFF)은 편집기가 붙이는 표지라 건너뛴다
    if (hidden !== undefined && !(offset === 0 && codePoint === 0xfeff)) {
      add(hidden, "block", lineOf(starts, offset));
    }
    offset += char.length;
  }

  if (options.containsKnown?.(text) === true) add("secret.registered_value", "block", undefined);

  const all = Array.from(found.values());
  // 상한을 넘으면 block을 먼저 남긴다
  const kept = [
    ...all.filter((finding) => finding.severity === "block"),
    ...all.filter((finding) => finding.severity === "warn"),
  ].slice(0, MAX_FINDINGS);
  kept.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));
  // kind는 규칙 집합이 갈라질 때를 위한 자리다
  void kind;
  return { rulesetVersion: SCAN_RULESET_VERSION, findings: kept };
}

/** block 판정이 있는 규칙 이름(중복 없이) */
export function blockingRules(scan: ScanSummary): readonly string[] {
  return Array.from(
    new Set(scan.findings.filter((finding) => finding.severity === "block").map((f) => f.rule)),
  );
}
