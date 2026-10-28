//! Unix 도메인 소켓 서버. 접속마다 줄 단위로 요청을 읽고 응답을 쓴다.

use std::io;
use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _, PermissionsExt as _};
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

/// 소켓이 놓일 폴더를 준비한다. 앱이 만든 폴더만 0700으로 둔다. 이미 있는 폴더는 권한을 바꾸지 않는다.
/// `XEON_DESKTOP_INSPECT_SOCKET`이 `/tmp/x.sock`을 가리켜도 `/tmp` 같은 공용 폴더의 권한을 건드리지 않게 하려는 것이다.
/// 이미 있는 폴더는 앱 사용자 소유이고 다른 사용자(other)가 쓸 수 없을 때만 받는다. 아니면 `PermissionDenied`다.
/// 그룹 쓰기는 막지 않는다. 사용자별 그룹과 umask 002 환경에서 만든 로그 폴더가 0775이기 때문이다. 소켓 파일은 0600이다.
fn prepare_socket_dir(dir: &Path) -> io::Result<()> {
    let dir = if dir.as_os_str().is_empty() { Path::new(".") } else { dir };
    match std::fs::metadata(dir) {
        Ok(meta) => return check_existing_dir(dir, &meta),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if let Some(parent) = dir.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    match std::fs::DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => Ok(()),
        // 그 사이에 다른 프로세스가 만들었다. 우리가 만든 폴더가 아니므로 같은 검사를 거친다
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            check_existing_dir(dir, &std::fs::metadata(dir)?)
        }
        Err(error) => Err(error),
    }
}

fn check_existing_dir(dir: &Path, meta: &std::fs::Metadata) -> io::Result<()> {
    if !meta.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("the socket folder {} is not a directory", dir.display()),
        ));
    }
    // SAFETY: geteuid는 인자도 실패도 없는 읽기 호출이다.
    let me = unsafe { libc::geteuid() };
    if meta.uid() != me || meta.permissions().mode() & 0o002 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "refusing the socket folder {}: it exists and is not owned by this user or is writable by others (it is left unchanged)",
                dir.display()
            ),
        ));
    }
    Ok(())
}

fn bind(path: &Path) -> io::Result<UnixListener> {
    if path.as_os_str().len() > MAX_SOCKET_PATH_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "socket path is too long for a unix socket",
        ));
    }
    if let Some(dir) = path.parent() {
        prepare_socket_dir(dir)?;
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

    #[tokio::test]
    async fn a_missing_socket_folder_chain_is_created_and_only_the_last_folder_is_private() {
        let root = temp_dir("chain");
        let dir = root.join("inner");
        let path = dir.join("i.sock");
        drop(bind(&path).expect("bind"));
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        assert_ne!(std::fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o700);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn an_existing_shared_folder_is_refused_and_its_permissions_stay_as_they_were() {
        let dir = temp_dir("shared");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o777)).unwrap();
        let path = dir.join("i.sock");
        assert_eq!(bind(&path).err().map(|e| e.kind()), Some(io::ErrorKind::PermissionDenied));
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o777);
        assert!(!path.exists(), "no socket is created in a folder it refused");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn an_existing_folder_of_this_user_that_others_cannot_write_is_used_as_it_is() {
        for mode in [0o755, 0o775] {
            let dir = temp_dir("log-dir");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(mode)).unwrap();
            let path = dir.join("i.sock");
            drop(bind(&path).expect("bind"));
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, mode);
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[tokio::test]
    async fn the_system_temp_folder_is_never_taken_over_by_an_override_path() {
        let tmp = Path::new("/tmp");
        let before = std::fs::metadata(tmp).unwrap().permissions().mode();
        let path = tmp.join(format!("xeon-inspect-override-{}.sock", std::process::id()));
        assert_eq!(bind(&path).err().map(|e| e.kind()), Some(io::ErrorKind::PermissionDenied));
        assert_eq!(std::fs::metadata(tmp).unwrap().permissions().mode(), before);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn a_file_in_place_of_the_socket_folder_is_refused() {
        let dir = temp_dir("not-a-dir");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("folder");
        std::fs::write(&file, b"data").unwrap();
        assert_eq!(bind(&file.join("i.sock")).err().map(|e| e.kind()), Some(io::ErrorKind::InvalidInput));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_too_long_for_a_unix_socket_is_refused_before_binding() {
        let long = PathBuf::from(format!("/tmp/{}", "x".repeat(120)));
        assert_eq!(bind(&long).err().map(|e| e.kind()), Some(io::ErrorKind::InvalidInput));
    }
}
