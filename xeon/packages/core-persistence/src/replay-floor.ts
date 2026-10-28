// 재전송 하한(L1.persistence.spec §4.13.1, M3-REQ-80). 보관 정리가 thread의 이벤트를 지울 때 지운 이벤트의 가장 큰 seq까지 오른다.
// `EventFeed.oldestReplayableSeq`가 이 값을 돌려주고, 그 값 이하에서 시작하는 재전송은 호스트가 `replay.outOfRange`(beforeOldest)로 거부한다.
// 저장 위치는 `consumer_cursors`의 예약 consumer 행이다(새 표를 두면 F의 표 소유 목록이 바뀐다).
export const REPLAY_FLOOR_CONSUMER = "replay.floor";
