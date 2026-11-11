import { parseTargetAddress } from "@fresnel/client";
import type { HostClientView } from "@fresnel/contracts/wire";
import type { EngineTargetView } from "../state/ui/index.ts";

// 대화 맥락 줄(DP-71)이 무엇을 보이고 숨기는지 정하는 순수 모델. 화면은 이 결과만 그린다.
// 왼쪽은 작업 맥락(폴더, 저장소·브랜치), 오른쪽은 연결(호스트, 같은 엔진에 붙은 다른 클라이언트)이다.
// 데이터가 없는 항목은 만들지 않는다. 폴더가 없는 대화는 줄 전체가 없다(새 대화 화면의 고르기가 대신 말한다).

/** 엔진이 도는 곳. `local`은 이 컴퓨터, `ssh`는 SSH 호스트, `remote`는 저장한 원격 대상, `web`은 웹 브라우저로 origin을 보는 중이다 */
type ContextHostKind = "local" | "ssh" | "remote" | "web";

export interface ContextHost {
  readonly kind: ContextHostKind;
  /** 보일 이름. 이 컴퓨터는 이름이 없다 */
  readonly name: string | null;
  /** 툴팁에 보일 자세한 주소(SSH `user@host`, 원격 주소). 없으면 null */
  readonly detail: string | null;
}

/** 같은 엔진에 붙은 다른 클라이언트. 이름이 없으면(hello 전) 전송 종류로 부른다 */
export interface ContextClient {
  readonly name: string | null;
  readonly transport: HostClientView["transport"];
}

/** 저장소 이름과 브랜치. 엔진이 알려 줄 때만 있다 */
export interface ContextGit {
  readonly repo: string;
  readonly branch: string | null;
}

export interface ContextInput {
  readonly workspace: string | null;
  /** `workspace.status`가 폴더가 없다고 답했으면 참. 모르면 거짓이다(경고하지 않는다) */
  readonly missing: boolean;
  readonly target: EngineTargetView;
  /** 화면이 웹 셸에서 돌면 브라우저 주소의 호스트, 데스크톱이면 null */
  readonly webHost: string | null;
  /** `host.clients` 결과(이 앱 포함). 모르면 빈 목록 */
  readonly clients: readonly HostClientView[];
  readonly git: ContextGit | null;
}

export interface ContextFolder {
  readonly name: string;
  readonly path: string;
  readonly missing: boolean;
}

/** 줄 한 개의 내용. 폴더가 없으면 `null`(줄을 그리지 않는다) */
export interface ContextLine {
  readonly folder: ContextFolder;
  readonly git: ContextGit | null;
  readonly host: ContextHost;
  readonly clients: readonly ContextClient[];
}

/** 경로를 `/`와 `\`로 나눈 마디(빈 마디와 끝의 구분자는 뺀다) */
function segmentsOf(path: string): readonly string[] {
  return path.split(/[\\/]+/).filter((segment) => segment !== "");
}

/** 폴더 이름(마지막 마디). 뿌리 경로처럼 마디가 없으면 경로 그대로다 */
export function folderNameOf(path: string): string {
  return segmentsOf(path).at(-1) ?? path;
}

/** 이름 위쪽 경로의 꼬리. 상위 마디 둘까지만 남기고 더 있으면 `…/`를 앞에 붙인다. 상위가 없으면 null */
export function pathTailOf(path: string): string | null {
  const parents = segmentsOf(path).slice(0, -1);
  if (parents.length === 0) return null;
  const kept = parents.slice(-2).join("/");
  return parents.length > 2 ? `…/${kept}` : `/${kept}`;
}

/** 엔진 대상과 셸 종류를 연결 한 칸으로 줄인다. 웹 셸이면 대상과 상관없이 "웹으로 보는 중"이다 */
export function hostOf(target: EngineTargetView, webHost: string | null): ContextHost {
  if (webHost !== null) {
    return { kind: "web", name: webHost.trim() === "" ? null : webHost, detail: null };
  }
  if (target.kind === "local") return { kind: "local", name: null, detail: null };
  const label = target.label.trim() === "" ? null : target.label.trim();
  const parsed = parseTargetAddress(target.address);
  if (parsed.ok && parsed.target.kind === "ssh") {
    return { kind: "ssh", name: label ?? parsed.target.host, detail: target.address };
  }
  return { kind: "remote", name: label, detail: target.address };
}

/** 이 앱 말고 붙은 클라이언트. 같은 이름(이름이 없으면 같은 전송)은 한 번만 센다 */
export function otherClientsOf(clients: readonly HostClientView[]): readonly ContextClient[] {
  const seen = new Set<string>();
  const result: ContextClient[] = [];
  for (const client of clients) {
    if (client.self) continue;
    const name = client.name === undefined || client.name.trim() === "" ? null : client.name;
    const key = name ?? `transport:${client.transport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, transport: client.transport });
  }
  return result;
}

/** 줄의 내용. 폴더가 없거나 빈 글이면 null이다 */
export function contextLineOf(input: ContextInput): ContextLine | null {
  const workspace = input.workspace;
  if (workspace === null || workspace.trim() === "") return null;
  return {
    folder: { name: folderNameOf(workspace), path: workspace, missing: input.missing },
    git: input.git,
    host: hostOf(input.target, input.webHost),
    clients: otherClientsOf(input.clients),
  };
}
