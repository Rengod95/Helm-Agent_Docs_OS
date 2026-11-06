//! 셸 의도 큐 (B-10). 트레이 메뉴가 "새 대화"나 "이 대화 열기"를 요청하는 길이다.
//! 창이 닫혀 있으면 WebView가 없으므로 셸이 의도를 들고 있다가, 창을 다시 만든 WebView가 `shell_take_intents`로 가져간다.
//! 이미 떠 있는 WebView에는 `shell-intent` 이벤트로 가져가라고 알린다. 가져가지 못한 의도는 30초가 지나면 버린다.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 큐가 들 수 있는 의도 수. 넘으면 오래된 것부터 버린다.
const CAPACITY: usize = 8;
/// 의도가 살아 있는 시간. 이보다 오래된 의도는 가져가도 버린다.
const LIFETIME: Duration = Duration::from_secs(30);
/// 떠 있는 WebView를 깨우는 이벤트 이름. 페이로드는 없다.
pub const EVENT: &str = "shell-intent";

/// WebView에 요청하는 셸 의도. `{"kind":"newThread"}`, `{"kind":"openThread","threadId":"..."}`로 직렬화된다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Intent {
    NewThread,
    // 알림 클릭은 `notify_take_target`이 대화를 넘기므로 아직 이 변형을 만드는 곳이 없다. 큐 계약의 일부라 둔다.
    #[cfg_attr(not(test), allow(dead_code))]
    OpenThread {
        thread_id: String,
    },
}

/// 의도 큐. 항목은 넣은 시각과 함께 든다. 잠금이 독성이어도 내용은 그대로 쓴다.
#[derive(Default)]
pub struct IntentQueue(Mutex<Vec<(Intent, Instant)>>);

impl IntentQueue {
    /// 의도를 넣는다. 큐 끝이 같은 `OpenThread`면 새로 넣지 않고 시각만 `now`로 바꾼다.
    /// 상한을 넘으면 오래된 것부터 버린다.
    pub fn push(&self, intent: Intent, now: Instant) {
        let mut items = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(last) = items.last_mut() {
            if matches!(intent, Intent::OpenThread { .. }) && last.0 == intent {
                last.1 = now;
                return;
            }
        }
        items.push((intent, now));
        let overflow = items.len().saturating_sub(CAPACITY);
        items.drain(..overflow);
    }

    /// 살아 있는 의도를 넣은 순서대로 모두 꺼내고 큐를 비운다. `now`보다 30초를 넘게 오래된 것은 버린다.
    pub fn take(&self, now: Instant) -> Vec<Intent> {
        let items = std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()));
        items
            .into_iter()
            .filter(|(_, at)| now.saturating_duration_since(*at) <= LIFETIME)
            .map(|(intent, _)| intent)
            .collect()
    }
}

/// 의도를 큐에 넣고 떠 있는 WebView를 깨운다. 창이 없으면 깨울 곳이 없으므로 이벤트 오류는 무시한다. 의도는 큐에 남는다.
pub fn send<R: Runtime>(app: &AppHandle<R>, intent: Intent) {
    app.state::<IntentQueue>().push(intent, Instant::now());
    let _ = app.emit(EVENT, ());
}

/// WebView가 부른다. 가져간 뒤 큐는 비고, 30초가 지난 의도는 버린다.
#[tauri::command]
pub fn shell_take_intents(app: AppHandle) -> Vec<Intent> {
    app.state::<IntentQueue>().take(Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn open(id: &str) -> Intent {
        Intent::OpenThread {
            thread_id: id.into(),
        }
    }

    #[test]
    fn intents_come_out_in_the_order_they_went_in_and_the_queue_empties() {
        let queue = IntentQueue::default();
        let now = Instant::now();
        queue.push(Intent::NewThread, now);
        queue.push(open("a"), now);
        queue.push(open("b"), now);
        assert_eq!(
            queue.take(now),
            vec![Intent::NewThread, open("a"), open("b")]
        );
        assert_eq!(queue.take(now), Vec::<Intent>::new());
    }

    #[test]
    fn the_queue_keeps_the_newest_eight_and_drops_the_oldest() {
        let queue = IntentQueue::default();
        let now = Instant::now();
        for n in 0..10 {
            queue.push(open(&n.to_string()), now);
        }
        let newest_eight: Vec<Intent> = (2..10).map(|n| open(&n.to_string())).collect();
        assert_eq!(queue.take(now), newest_eight);
    }

    #[test]
    fn an_intent_is_kept_for_exactly_thirty_seconds_and_dropped_after() {
        let start = Instant::now();

        let at_the_limit = IntentQueue::default();
        at_the_limit.push(open("a"), start);
        assert_eq!(
            at_the_limit.take(start + Duration::from_secs(30)),
            vec![open("a")]
        );

        let just_past = IntentQueue::default();
        just_past.push(open("a"), start);
        just_past.push(open("b"), start + Duration::from_secs(10));
        assert_eq!(
            just_past.take(start + Duration::from_millis(30_001)),
            vec![open("b")],
            "a 30.001초 된 의도는 버리고 10초 된 의도는 남긴다"
        );

        let all_old = IntentQueue::default();
        all_old.push(open("a"), start);
        assert_eq!(
            all_old.take(start + Duration::from_secs(31)),
            Vec::<Intent>::new()
        );
    }

    #[test]
    fn the_same_open_request_is_not_queued_twice_in_a_row() {
        let queue = IntentQueue::default();
        let now = Instant::now();
        queue.push(open("a"), now);
        queue.push(open("a"), now);
        assert_eq!(queue.take(now), vec![open("a")]);

        // 사이에 다른 의도가 끼면 끝이 아니므로 다시 넣는다.
        queue.push(open("a"), now);
        queue.push(Intent::NewThread, now);
        queue.push(open("a"), now);
        assert_eq!(
            queue.take(now),
            vec![open("a"), Intent::NewThread, open("a")]
        );
    }

    #[test]
    fn a_repeated_open_request_restarts_its_thirty_seconds() {
        let start = Instant::now();
        let queue = IntentQueue::default();
        queue.push(open("a"), start);
        queue.push(open("a"), start + Duration::from_secs(20));
        assert_eq!(
            queue.take(start + Duration::from_secs(40)),
            vec![open("a")],
            "다시 요청한 시각부터 30초를 잰다"
        );
    }

    #[test]
    fn a_new_thread_request_is_not_merged_with_the_one_before_it() {
        let queue = IntentQueue::default();
        let now = Instant::now();
        queue.push(Intent::NewThread, now);
        queue.push(Intent::NewThread, now);
        assert_eq!(queue.take(now), vec![Intent::NewThread, Intent::NewThread]);
    }

    #[test]
    fn intents_serialize_with_a_kind_tag_and_camel_case_fields() {
        assert_eq!(
            serde_json::to_value(Intent::NewThread).expect("the intent serializes"),
            json!({ "kind": "newThread" })
        );
        assert_eq!(
            serde_json::to_value(open("t-1")).expect("the intent serializes"),
            json!({ "kind": "openThread", "threadId": "t-1" })
        );
    }
}
