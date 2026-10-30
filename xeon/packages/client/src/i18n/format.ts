import { assertNever } from "@xeon/contracts";

// ADR-0016 §3.1. ICU MessageFormat 부분집합을 `Intl`만으로 푸는 포맷 포트와 기본 구현.
// FormatJS(`@formatjs/intl`)는 승인 전이라 쓰지 않는다 [결정: 오케스트레이터 기본값]. 승인되면 같은 포트 뒤에 어댑터를 둔다.
// 지원: `{name}`, `{n, number[, integer|percent]}`, `{d, date|time[, short|medium|long]}`,
//       `{n, plural, =0{..} one{..} other{..}}`(`#`은 숫자), `{x, select, a{..} other{..}}`, 따옴표 이스케이프(`'{'`).

export type MessageArg = string | number | Date;
export type MessageArgs = Readonly<Record<string, MessageArg>>;

/** 메시지 문자열을 로케일과 인자로 문장으로 만든다. 구현을 바꿔 끼울 수 있게 포트로 둔다 */
export interface MessageFormatPort {
  format(locale: string, message: string, args: MessageArgs): string;
}

type Node =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "hash" }
  | { readonly kind: "arg"; readonly name: string }
  | {
      readonly kind: "typed";
      readonly name: string;
      readonly type: "number" | "date" | "time";
      readonly style: string;
    }
  | {
      readonly kind: "plural" | "select";
      readonly name: string;
      readonly cases: ReadonlyMap<string, readonly Node[]>;
    };

class Parser {
  #at = 0;
  readonly #src: string;
  constructor(src: string) {
    this.#src = src;
  }

  parse(): readonly Node[] {
    return this.#nodes(false, false);
  }

  #nodes(inCase: boolean, inPlural: boolean): readonly Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = (): void => {
      if (text !== "") out.push({ kind: "text", text });
      text = "";
    };
    while (this.#at < this.#src.length) {
      const ch = this.#src.charAt(this.#at);
      if (ch === "'") {
        const next = this.#src.charAt(this.#at + 1);
        if (next === "'") {
          text += "'";
          this.#at += 2;
        } else if (next === "{" || next === "}") {
          // 따옴표 구간: 다음 따옴표까지 글자 그대로
          this.#at += 1;
          while (this.#at < this.#src.length && this.#src.charAt(this.#at) !== "'") {
            text += this.#src.charAt(this.#at);
            this.#at += 1;
          }
          this.#at += 1;
        } else {
          text += "'";
          this.#at += 1;
        }
      } else if (ch === "{") {
        flush();
        this.#at += 1;
        out.push(this.#argument());
      } else if (ch === "}") {
        if (inCase) break;
        text += ch;
        this.#at += 1;
      } else if (ch === "#" && inPlural) {
        flush();
        out.push({ kind: "hash" });
        this.#at += 1;
      } else {
        text += ch;
        this.#at += 1;
      }
    }
    flush();
    return out;
  }

  #until(stops: string): string {
    const start = this.#at;
    while (this.#at < this.#src.length && !stops.includes(this.#src.charAt(this.#at))) {
      this.#at += 1;
    }
    return this.#src.slice(start, this.#at).trim();
  }

  #argument(): Node {
    const name = this.#until(",}");
    if (this.#src.charAt(this.#at) === "}") {
      this.#at += 1;
      return { kind: "arg", name };
    }
    this.#at += 1;
    const type = this.#until(",}");
    let style = "";
    if (this.#src.charAt(this.#at) === ",") {
      this.#at += 1;
      if (type === "plural" || type === "select") return this.#cases(name, type);
      style = this.#until("}");
    }
    this.#at += 1;
    if (type === "number" || type === "date" || type === "time") {
      return { kind: "typed", name, type, style };
    }
    return { kind: "arg", name };
  }

  #cases(name: string, type: "plural" | "select"): Node {
    const cases = new Map<string, readonly Node[]>();
    for (;;) {
      const selector = this.#until("{}");
      if (this.#src.charAt(this.#at) !== "{") break;
      this.#at += 1;
      cases.set(selector, this.#nodes(true, type === "plural"));
      this.#at += 1;
    }
    this.#at += 1;
    return { kind: type, name, cases };
  }
}

function argText(value: MessageArg | undefined, name: string): string {
  if (value === undefined) return `{${name}}`;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function dateStyle(style: string): "short" | "medium" | "long" {
  return style === "short" || style === "long" ? style : "medium";
}

function render(
  nodes: readonly Node[],
  locale: string,
  args: MessageArgs,
  hash: number | undefined,
): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.text;
        break;
      case "hash":
        out += new Intl.NumberFormat(locale).format(hash ?? 0);
        break;
      case "arg":
        out += argText(args[node.name], node.name);
        break;
      case "typed": {
        const value = args[node.name];
        if (value === undefined) {
          out += `{${node.name}}`;
        } else if (node.type === "number") {
          const n = typeof value === "number" ? value : Number(value);
          const options: Intl.NumberFormatOptions =
            node.style === "integer"
              ? { maximumFractionDigits: 0 }
              : node.style === "percent"
                ? { style: "percent" }
                : {};
          out += new Intl.NumberFormat(locale, options).format(n);
        } else {
          const when = value instanceof Date ? value : new Date(value);
          const style = dateStyle(node.style);
          out += new Intl.DateTimeFormat(
            locale,
            node.type === "date"
              ? { dateStyle: style, timeZone: "UTC" }
              : { timeStyle: style, timeZone: "UTC" },
          ).format(when);
        }
        break;
      }
      case "plural": {
        const value = args[node.name];
        const n = typeof value === "number" ? value : Number(value ?? 0);
        const exact = node.cases.get(`=${String(n)}`);
        const chosen =
          exact ??
          node.cases.get(new Intl.PluralRules(locale).select(n)) ??
          node.cases.get("other") ??
          [];
        out += render(chosen, locale, args, n);
        break;
      }
      case "select": {
        const value = args[node.name];
        const chosen = node.cases.get(String(value ?? "")) ?? node.cases.get("other") ?? [];
        out += render(chosen, locale, args, hash);
        break;
      }
      default:
        return assertNever(node, "MessageNode");
    }
  }
  return out;
}

/** 기본 포트: `Intl.NumberFormat`·`DateTimeFormat`·`PluralRules`만 쓴다. 날짜와 시각은 UTC로 보인다(ADR-0016 §3.1 4) */
export function createIntlFormat(): MessageFormatPort {
  const cache = new Map<string, readonly Node[]>();
  return {
    format(locale, message, args) {
      let nodes = cache.get(message);
      if (nodes === undefined) {
        nodes = new Parser(message).parse();
        cache.set(message, nodes);
      }
      return render(nodes, locale, args, undefined);
    },
  };
}
