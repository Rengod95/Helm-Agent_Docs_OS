//! Unix 도메인 소켓 서버. 접속마다 줄 단위로 요청을 읽고 응답을 쓴다.

use std::io;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::UnixListener;
use tokio::runtime::Handle;
use tokio::sync::Semaphore;

use super::{handle_line, Probe, INVALID_REQUEST, MAX_LINE_BYTES};
use crate::applog::AppLog;

/// 동시에 받는 접속 수. 점검 도구 하나와 사람 하나면 충분하다.
pub const MAX_CONNECTIONS: usize = 4;

/// macOS의 소켓 경로 상한은 104바이트(NUL 포함)다.
const MAX_SOCKET_PATH_BYTES: usize = 100;

/// 소켓 파일의 기본 위치. 환경 변수 `XEON_DESKTOP_INSPECT_SOCKET`이 있으면 그 경로를 쓴다.
pub fn socket_path(log_dir: &Path, override_path: Option<String>) -> PathBuf {
    match override_path {
        Some(path) if !path.is_empty() => PathBuf::from(path),
        _ => log_dir.join("inspect.sock"),
    }
}

/// 소켓을 열고 접속을 받는 작업을 런타임에 올린다. 열지 못하면 로그에 남기고 앱은 계속 돈다.
pub fn serve(runtime: &Handle, path: PathBuf, probe: Arc<dyn Probe>, log: Arc<AppLog>) {
    runtime.spawn(async move {
        match bind(&path) {
            Ok(listener) => {
                log.line(&format!("debug inspect listening on {}", path.display()));
                accept_loop(listener, probe, log).await;
            }
            Err(error) => log.line(&format!("debug inspect did not start: {error}")),
        }
    });
}

fn bind(path: &Path) -> io::Result<UnixListener> {
    if path.as_os_str().len() > MAX_SOCKET_PATH_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "socket path is too long for a unix socket",
        ));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    // 이전 실행이 남긴 소켓 파일. 다른 종류의 파일은 지우지 않는다.
    match std::fs::symlink_metadata(path) {
        Ok(meta) if std::os::unix::fs::FileTypeExt::is_socket(&meta.file_type()) => {
            std::fs::remove_file(path)?;
        }
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "the socket path is taken by a file that is not a socket",
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

async fn accept_loop(listener: UnixListener, probe: Arc<dyn Probe>, log: Arc<AppLog>) {
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _)) => stream,
            Err(error) => {
                log.line(&format!("debug inspect accept failed: {error}"));
                return;
            }
        };
        // 상한을 넘은 접속은 받자마자 닫는다
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            drop(stream);
            continue;
        };
        let probe = probe.clone();
        tokio::spawn(async move {
            serve_connection(stream, probe.as_ref()).await;
            drop(permit);
        });
    }
}

pub async fn serve_connection<S>(stream: S, probe: &dyn Probe)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut reader = BufReader::new(read);
    let mut line = Vec::new();
    loop {
        line.clear();
        // 줄 끝이 없는 긴 입력이 메모리를 채우지 않게 한 줄을 상한까지만 읽는다
        let mut limited = (&mut reader).take(MAX_LINE_BYTES as u64 + 1);
        match limited.read_until(b'\n', &mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line.len() > MAX_LINE_BYTES {
            let reply = super::error_response(&serde_json::Value::Null, INVALID_REQUEST, "line too long");
            let _ = write.write_all(format!("{reply}\n").as_bytes()).await;
            return;
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        if let Some(reply) = handle_line(probe, text).await {
            if write.write_all(format!("{reply}\n").as_bytes()).await.is_err() {
                return;
            }
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::inspect::BoxFuture;
    use serde_json::{json, Value};
    use tokio::net::UnixStream;

    struct Fake;

    impl Probe for Fake {
        fn state_dump(&self) -> Value {
            json!({ "ok": true })
        }
        fn viewport_snapshot(&self) -> BoxFuture<'_, Result<Value, String>> {
            Box::pin(async { Err("no".to_string()) })
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xeon-inspect-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn socket_path_defaults_next_to_the_log_and_honours_the_override() {
        let log = Path::new("/logs/dev.helm.xeon");
        assert_eq!(socket_path(log, None), PathBuf::from("/logs/dev.helm.xeon/inspect.sock"));
        assert_eq!(socket_path(log, Some(String::new())), PathBuf::from("/logs/dev.helm.xeon/inspect.sock"));
        assert_eq!(socket_path(log, Some("/run/x.sock".into())), PathBuf::from("/run/x.sock"));
    }

    #[tokio::test]
    async fn answers_requests_line_by_line_over_a_unix_socket_with_private_permissions() {
        let dir = temp_dir("serve");
        let path = dir.join("i.sock");
        let listener = bind(&path).expect("bind");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        tokio::spawn(accept_loop(listener, Arc::new(Fake), Arc::new(AppLog::open(None))));
        let mut client = UnixStream::connect(&path).await.expect("connect");
        client
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"state.dump\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"nope\"}\n")
            .await
            .unwrap();
        let mut reader = BufReader::new(client);
        let mut first = String::new();
        reader.read_line(&mut first).await.unwrap();
        let mut second = String::new();
        reader.read_line(&mut second).await.unwrap();
        let first: Value = serde_json::from_str(&first).unwrap();
        let second: Value = serde_json::from_str(&second).unwrap();
        assert_eq!(first, json!({ "jsonrpc": "2.0", "id": 1, "result": { "ok": true } }));
        assert_eq!(second["error"]["code"], json!(-32601));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_line_over_the_limit_is_refused_and_the_connection_closes() {
        let (mut client, server) = tokio::io::duplex(64 * 1024);
        let task = tokio::spawn(async move { serve_connection(server, &Fake).await });
        client.write_all(&vec![b'a'; MAX_LINE_BYTES + 10]).await.unwrap();
        let mut out = String::new();
        client.read_to_string(&mut out).await.unwrap();
        task.await.unwrap();
        let reply: Value = serde_json::from_str(out.trim()).unwrap();
        assert_eq!(reply["error"]["code"], json!(INVALID_REQUEST));
    }

    #[tokio::test]
    async fn a_stale_socket_is_replaced_but_a_regular_file_is_never_deleted() {
        let dir = temp_dir("stale");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("i.sock");
        drop(bind(&path).expect("first bind"));
        assert!(bind(&path).is_ok(), "the leftover socket file is replaced");
        let file = dir.join("keep.sock");
        std::fs::write(&file, b"data").unwrap();
        assert_eq!(bind(&file).err().map(|e| e.kind()), Some(io::ErrorKind::AlreadyExists));
        assert_eq!(std::fs::read(&file).unwrap(), b"data");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_too_long_for_a_unix_socket_is_refused_before_binding() {
        let long = PathBuf::from(format!("/tmp/{}", "x".repeat(120)));
        assert_eq!(bind(&long).err().map(|e| e.kind()), Some(io::ErrorKind::InvalidInput));
    }
}
