import { err, ok } from "@xeon/contracts";
import type { DnsResolver } from "../ports/resolver.ts";

// 시험용 DNS 해석기(L2.web.plan §2 testing/fake-resolver.ts). 호스트마다 응답 표를 갖고, 같은 호스트를 다시 풀 때마다
// 다음 응답으로 넘어가 DNS 리바인딩(첫 조회 공개 IP, 다음 조회 사설 IP)을 흉내 낸다.

export interface FakeResolver extends DnsResolver {
  /** 해석 요청 기록(호스트 순서) */
  readonly lookups: string[];
  /** 호스트의 응답 표를 정한다. 표의 끝에 닿으면 마지막 응답을 반복한다 */
  script(host: string, answers: readonly (readonly string[])[]): void;
}

export function fakeResolver(
  table: Readonly<Record<string, readonly string[]>> = {},
): FakeResolver {
  const scripts = new Map<string, (readonly string[])[]>(
    Object.entries(table).map(([host, addresses]) => [host, [addresses]]),
  );
  const cursor = new Map<string, number>();
  const lookups: string[] = [];
  return {
    lookups,
    script(host, answers) {
      scripts.set(host, [...answers]);
      cursor.set(host, 0);
    },
    resolve(host) {
      lookups.push(host);
      const answers = scripts.get(host);
      if (answers === undefined || answers.length === 0) {
        return Promise.resolve(err({ kind: "unresolvable", message: `no fixture for ${host}` }));
      }
      const index = Math.min(cursor.get(host) ?? 0, answers.length - 1);
      cursor.set(host, index + 1);
      const answer = answers[index] ?? [];
      return Promise.resolve(ok(answer));
    },
  };
}
