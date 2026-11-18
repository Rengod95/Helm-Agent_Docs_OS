// 파일 되감기의 원본 저장 상한(L1.persistence.spec §4.13.2 [제안]). 운영 값은 이 상수다. 설정 키는 만들지 않는다(설정 키 추가는 사용자 결정).

/** 파일 하나의 옛 내용 저장 상한(바이트). 넘으면 저장하지 않고 `unrestorable{too_large}`로 적는다 */
export const FILE_SNAPSHOT_MAX_BYTES: number = 16 * 1024 * 1024;

/** 대화 하나가 저장하는 옛 내용의 총량 상한(서로 다른 blob 해시의 크기 합). 넘으면 새 저장은 `unrestorable{quota}`다 */
const THREAD_SNAPSHOT_QUOTA_BYTES: number = 512 * 1024 * 1024;

/** 시험이 작은 값으로 바꿔 넣는 상한. 운영은 `DEFAULT_REWIND_LIMITS`를 쓴다 */
export interface RewindLimits {
  readonly fileMaxBytes: number;
  readonly threadQuotaBytes: number;
}

export const DEFAULT_REWIND_LIMITS: RewindLimits = {
  fileMaxBytes: FILE_SNAPSHOT_MAX_BYTES,
  threadQuotaBytes: THREAD_SNAPSHOT_QUOTA_BYTES,
};
