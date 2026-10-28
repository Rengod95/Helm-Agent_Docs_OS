//! 디버그 전용 원격 점검 Phase 1 (M2 마감 계획 T7, `L4.desktop.plan` §3.2.3).
//!
//! 이 모듈은 `main.rs`의 `#[cfg(debug_assertions)] mod inspect;`로만 컴파일된다. 릴리스 빌드에는 코드도 소켓도 없다.
//! 원격(SSH)에서 앱 상태를 읽는 두 메서드를 줄 단위 JSON-RPC 2.0으로 낸다:
//! - `state.dump`: 엔진 상태, 릴레이 세대, 창 크기와 포커스, 로그 위치.
//! - `viewport.snapshot`: WKWebView 뷰포트를 PNG 파일로 저장하고 경로를 돌려준다(macOS 전용, 그 밖은 오류).
//!
//! 듣는 곳은 Unix 도메인 소켓 하나다. 소켓이 있는 폴더는 0700, 파일은 0600이라 같은 사용자만 접속한다.
//! 요청의 줄 길이와 동시 접속 수에 상한을 둔다. 값(대화 내용, 비밀)은 어느 응답에도 싣지 않는다.

use std::future::Future;
use std::pin::Pin;

use serde_json::{json, Value};

#[cfg(unix)]
mod server;
#[cfg(unix)]
pub use server::{serve, socket_path};

#[cfg(unix)]
mod probe;
#[cfg(unix)]
pub use probe::AppProbe;

#[cfg(target_os = "macos")]
mod snapshot_macos;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 응답을 만드는 데 필요한 앱 쪽 정보. 시험은 가짜 구현을 쓴다.
pub trait Probe: Send + Sync + 'static {
    fn state_dump(&self) -> Value;
    /// 성공하면 `{ path, bytes, width, height }` 같은 메타데이터를 돌려준다. 이미지 바이트는 응답에 싣지 않는다.
    fn viewport_snapshot(&self) -> BoxFuture<'_, Result<Value, String>>;
}

pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
/// 메서드가 실행되지 못했다(스냅샷 실패 등). JSON-RPC 서버 오류 구간이다.
pub const FAILED: i64 = -32000;

/// 요청 줄 하나의 길이 상한(바이트). 메서드 이름 말고는 받을 내용이 없다.
pub const MAX_LINE_BYTES: usize = 16 * 1024;

fn error_response(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

fn result_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// 요청 줄 하나를 처리해 응답 줄을 돌려준다. 알림(id 없음)에는 응답이 없다(`None`).
pub async fn handle_line(probe: &dyn Probe, line: &str) -> Option<String> {
    let Ok(request) = serde_json::from_str::<Value>(line) else {
        return Some(error_response(&Value::Null, PARSE_ERROR, "parse error"));
    };
    let Some(object) = request.as_object() else {
        return Some(error_response(&Value::Null, INVALID_REQUEST, "invalid request"));
    };
    let id = object.get("id").cloned();
    let method = object.get("method").and_then(Value::as_str);
    let valid = object.get("jsonrpc").and_then(Value::as_str) == Some("2.0");
    let (true, Some(method)) = (valid, method) else {
        return Some(error_response(
            &id.unwrap_or(Value::Null),
            INVALID_REQUEST,
            "invalid request",
        ));
    };
    let response = match method {
        "state.dump" => Ok(probe.state_dump()),
        "viewport.snapshot" => probe
            .viewport_snapshot()
            .await
            .map_err(|message| (FAILED, message)),
        _ => Err((METHOD_NOT_FOUND, "method not found".to_string())),
    };
    // 알림에는 응답하지 않는다. 메서드는 실행했다.
    let id = id?;
    Some(match response {
        Ok(result) => result_response(&id, result),
        Err((code, message)) => error_response(&id, code, &message),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        snapshot: Result<Value, String>,
    }

    impl Probe for Fake {
        fn state_dump(&self) -> Value {
            json!({ "engine": { "kind": "running" } })
        }
        fn viewport_snapshot(&self) -> BoxFuture<'_, Result<Value, String>> {
            let result = self.snapshot.clone();
            Box::pin(async move { result })
        }
    }

    fn fake() -> Fake {
        Fake {
            snapshot: Ok(json!({ "path": "/tmp/x.png", "bytes": 3 })),
        }
    }

    async fn reply(probe: &Fake, line: &str) -> Value {
        let text = handle_line(probe, line).await.expect("a response");
        serde_json::from_str(&text).expect("a JSON response")
    }

    #[tokio::test]
    async fn state_dump_answers_with_the_probe_value_and_echoes_the_id() {
        let got = reply(&fake(), r#"{"jsonrpc":"2.0","id":7,"method":"state.dump"}"#).await;
        assert_eq!(
            got,
            json!({ "jsonrpc": "2.0", "id": 7, "result": { "engine": { "kind": "running" } } })
        );
        let got = reply(&fake(), r#"{"jsonrpc":"2.0","id":"a","method":"state.dump"}"#).await;
        assert_eq!(got["id"], json!("a"));
    }

    #[tokio::test]
    async fn viewport_snapshot_returns_metadata_or_a_server_error() {
        let got = reply(&fake(), r#"{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}"#).await;
        assert_eq!(got["result"], json!({ "path": "/tmp/x.png", "bytes": 3 }));
        let failing = Fake {
            snapshot: Err("unsupported on this platform".to_string()),
        };
        let got = reply(&failing, r#"{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}"#).await;
        assert_eq!(
            got["error"],
            json!({ "code": -32000, "message": "unsupported on this platform" })
        );
    }

    #[tokio::test]
    async fn malformed_and_unknown_requests_get_the_standard_errors() {
        let p = fake();
        assert_eq!(reply(&p, "not json").await["error"]["code"], json!(PARSE_ERROR));
        assert_eq!(reply(&p, "[1]").await["error"]["code"], json!(INVALID_REQUEST));
        let wrong_version = reply(&p, r#"{"jsonrpc":"1.0","id":2,"method":"state.dump"}"#).await;
        assert_eq!(wrong_version["error"]["code"], json!(INVALID_REQUEST));
        assert_eq!(wrong_version["id"], json!(2));
        let missing_method = reply(&p, r#"{"jsonrpc":"2.0","id":3}"#).await;
        assert_eq!(missing_method["error"]["code"], json!(INVALID_REQUEST));
        let unknown = reply(&p, r#"{"jsonrpc":"2.0","id":4,"method":"engine.restart"}"#).await;
        assert_eq!(unknown["error"]["code"], json!(METHOD_NOT_FOUND));
        // 읽기 전용이다: 엔진을 건드리는 메서드는 없다
        let write = reply(&p, r#"{"jsonrpc":"2.0","id":5,"method":"engine_write"}"#).await;
        assert_eq!(write["error"]["code"], json!(METHOD_NOT_FOUND));
    }

    #[tokio::test]
    async fn a_notification_gets_no_response() {
        assert!(handle_line(&fake(), r#"{"jsonrpc":"2.0","method":"state.dump"}"#)
            .await
            .is_none());
    }
}
