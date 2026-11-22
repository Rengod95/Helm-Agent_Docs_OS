import { hashPluginTree } from "./content-hash.ts";

// 앱의 편집 통신(`ext.members.edit`, `ext.dependencies.edit`, `ext.members.detach`, `ext.members.merge`)이 쓴 폴더의 내용 해시 장부(AGE-33).
// 원본 폴더 감시(훑기)는 파일을 쓴 쪽을 모르므로, 앱이 쓴 변경과 사람이 편집기로 고친 변경을 내용 해시로만 가를 수 있다.
// 편집 통신이 쓰고 나면 그 폴더의 해시를 여기에 적고, 검토 서비스가 같은 해시의 후보를 만났을 때 "앱에서 고친 변경"으로 본다
// (출처 `assistant`, 승인할 수 있다). 장부에 없는 해시는 기존 규칙대로 `unknown`(손 수정, 승인 불가)이다.
// 장부는 메모리에만 둔다. 앱을 다시 켜면 비어 있고, 그때 남아 있던 훑기 항목은 `unknown`으로 남는다 [제안]

/** 장부가 기억하는 해시 수의 상한. 넘으면 오래된 것부터 잊는다 */
const APP_EDIT_LEDGER_LIMIT = 256;

export interface AppEditLedger {
  /** 폴더의 지금 내용 해시를 적는다. 읽지 못하면 아무것도 적지 않는다(그 폴더는 손 수정으로 남는다) */
  markDir(dir: string): void;
  /** 이 해시가 앱의 편집 통신이 쓴 것인가 */
  has(contentHash: string): boolean;
}

export function createAppEditLedger(limit: number = APP_EDIT_LEDGER_LIMIT): AppEditLedger {
  const hashes = new Set<string>();
  return {
    markDir(dir) {
      const hashed = hashPluginTree(dir);
      if (!hashed.ok) return;
      hashes.delete(hashed.value.contentHash);
      hashes.add(hashed.value.contentHash);
      for (const old of hashes) {
        if (hashes.size <= limit) break;
        hashes.delete(old);
      }
    },
    has: (contentHash) => hashes.has(contentHash),
  };
}
