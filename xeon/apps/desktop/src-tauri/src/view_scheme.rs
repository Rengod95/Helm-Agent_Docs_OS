//! Plugin App 전용 URI 스킴 `fresnel-view://<확장이름>/<버전>/<경로>`(ADR-0021 §3.6.2, X.loading-trust.spec §4.3.4).
//! 프레임 파일은 이 스킴으로만 나온다. 앱 자원, 다른 확장의 파일, app root 밖은 나오지 않는다.
//!
//! 경로 규칙은 TS `resolveAppFile`(packages/ext-host/src/loading-trust/app-files.ts)과 같다: 한 번만 퍼센트 디코딩하고,
//! 빈 마디, `.`, `..`, 백슬래시, NUL, 앞 `/`, 드라이브 문자를 거부하고, 실제 경로(심볼릭 링크를 푼 것)가 app root 안이어야 하고,
//! 폴더는 내주지 않고, 확장자는 허용 목록에 있어야 한다. 응답 헤더와 CSP는 `packages/client/src/views/app/scheme.ts`와 같다
//! (`apps/desktop/test/view-scheme-parity.test.ts`가 글자를 맞춰 본다).
//!
//! 신뢰: app root 목록은 `app_roots_set` 명령(메인 창만, capability `allow-app-roots-set`)이 정한다. 프레임에는 IPC가 없어야 하고
//! 그 확인은 macOS와 Linux 데스크톱 빌드 실기 시험이다(ADR-0021 §6 미결 1). 엔진이 이 목록을 직접 주는 길은 후속이다.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;

pub const SCHEME: &str = "fresnel-view";
/// 파일 하나의 크기 상한. 넘으면 413이다.
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// 한 번에 등록하는 항목 수 상한.
pub const MAX_ROOTS: usize = 256;

/// 확장자 → Content-Type. 목록에 없는 것(wasm 포함)은 내주지 않는다.
const CONTENT_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("map", "application/json; charset=utf-8"),
    ("txt", "text/plain; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
];

/// 프레임 문서 CSP. `{base}` 자리에 `fresnel-view://<확장이름>/<버전>/`을 넣는다. TS `appFrameCsp`와 같은 글자다.
const FRAME_CSP_PARTS: &[&str] = &[
    "default-src 'none'",
    "script-src {base}",
    "style-src {base} 'unsafe-inline'",
    "img-src {base} data: blob:",
    "font-src {base}",
    "media-src {base} blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src {base} blob:",
    "form-action 'none'",
    "base-uri 'none'",
];

const PERMISSIONS_POLICY: &str = "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()";

pub fn frame_csp(base: &str) -> String {
    FRAME_CSP_PARTS
        .iter()
        .map(|part| part.replace("{base}", base))
        .collect::<Vec<_>>()
        .join("; ")
}

/// 확장 이름 마디: `^[a-z][a-z0-9-]{0,63}$`.
pub fn valid_extension_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 || !bytes[0].is_ascii_lowercase() {
        return false;
    }
    bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// 버전 마디: `숫자.숫자.숫자` 뒤에 선택적 `-<영숫자.->`(최대 32자).
pub fn valid_version(version: &str) -> bool {
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3
        || !parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    match pre {
        None => true,
        Some(pre) => {
            !pre.is_empty()
                && pre.len() <= 32
                && pre
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    /// 주소 모양이 틀렸다.
    BadRequest,
    /// app root 밖을 가리키거나 경로 모양이 틀렸다.
    OutsideRoot,
    NotFound,
    NotAFile,
    ForbiddenType,
    TooLarge,
    MethodNotAllowed,
}

impl Rejection {
    pub fn status(&self) -> u16 {
        match self {
            Rejection::BadRequest => 400,
            Rejection::OutsideRoot | Rejection::ForbiddenType => 403,
            Rejection::NotFound | Rejection::NotAFile => 404,
            Rejection::MethodNotAllowed => 405,
            Rejection::TooLarge => 413,
        }
    }
}

/// `(확장 이름, 버전)` → app root와 entry. 등록은 통째로 바꾼다(남은 항목이 없다).
#[derive(Default)]
pub struct AppRoots {
    map: Mutex<HashMap<(String, String), RootEntry>>,
}

#[derive(Debug, Clone)]
struct RootEntry {
    /// 등록 때 푼 실제 경로. 요청 때 다시 푼다.
    root: PathBuf,
    entry: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppRootInput {
    pub extension: String,
    pub version: String,
    /// app root 폴더의 절대 경로.
    pub root: String,
    /// root 안의 HTML 파일 상대 경로.
    pub entry: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RootsError {
    TooMany,
    BadName,
    BadVersion,
    BadEntry,
    NotAbsolute,
    NotADirectory,
}

impl AppRoots {
    pub fn replace(&self, inputs: Vec<AppRootInput>) -> Result<(), RootsError> {
        if inputs.len() > MAX_ROOTS {
            return Err(RootsError::TooMany);
        }
        let mut next = HashMap::new();
        for input in inputs {
            if !valid_extension_name(&input.extension) {
                return Err(RootsError::BadName);
            }
            if !valid_version(&input.version) {
                return Err(RootsError::BadVersion);
            }
            if relative_segments(&input.entry).is_none() {
                return Err(RootsError::BadEntry);
            }
            let path = PathBuf::from(&input.root);
            if !path.is_absolute() {
                return Err(RootsError::NotAbsolute);
            }
            let real = fs::canonicalize(&path).map_err(|_| RootsError::NotADirectory)?;
            if !real.is_dir() {
                return Err(RootsError::NotADirectory);
            }
            next.insert(
                (input.extension, input.version),
                RootEntry {
                    root: real,
                    entry: input.entry,
                },
            );
        }
        // 잠금이 깨졌다면(다른 스레드의 패닉) 지난 목록을 새 목록으로 덮는다. 목록은 통째로 바뀌므로 안전하다.
        let mut guard = self.map.lock().unwrap_or_else(|e| e.into_inner());
        *guard = next;
        Ok(())
    }

    fn get(&self, extension: &str, version: &str) -> Option<RootEntry> {
        let guard = self.map.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .get(&(extension.to_string(), version.to_string()))
            .cloned()
    }
}

/// 퍼센트 디코딩 한 번. 깨진 부호열이나 UTF-8이 아니면 `None`.
fn percent_decode_once(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = hex(*bytes.get(i + 1)?)?;
            let lo = hex(*bytes.get(i + 2)?)?;
            out.push(hi * 16 + lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// 상대 경로 모양 검사. 마디로 나눠 돌려준다. 빈 문자열, 백슬래시, NUL, 앞 `/`, 드라이브 문자, 빈 마디, `.`, `..`은 `None`.
fn relative_segments(path: &str) -> Option<Vec<&str>> {
    if path.is_empty() || path.contains('\\') || path.contains('\0') || path.starts_with('/') {
        return None;
    }
    let b = path.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return None;
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments
        .iter()
        .any(|s| s.is_empty() || *s == "." || *s == "..")
    {
        return None;
    }
    Some(segments)
}

fn content_type_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    CONTENT_TYPES
        .iter()
        .find(|(name, _)| *name == ext)
        .map(|(_, ty)| *ty)
}

/// 주소를 `(확장 이름, 버전, 나머지 경로)`로 푼다. 나머지는 퍼센트 인코딩 그대로다.
/// 스킴, 호스트, 버전 모양이 틀리거나 질의·조각·계정 정보가 있으면 `None`.
pub fn parse_uri(uri: &str) -> Option<(String, String, String)> {
    let rest = uri.strip_prefix(SCHEME)?.strip_prefix("://")?;
    if rest.contains('?') || rest.contains('#') {
        return None;
    }
    let (authority, path) = rest.split_once('/')?;
    if authority.contains('@') || authority.contains(':') || !valid_extension_name(authority) {
        return None;
    }
    let (version, tail) = match path.split_once('/') {
        Some((version, tail)) => (version, tail),
        None => (path, ""),
    };
    if !valid_version(version) {
        return None;
    }
    Some((authority.to_string(), version.to_string(), tail.to_string()))
}

/// 파일 하나를 풀어 `(내용, Content-Type)`으로 돌려준다.
pub fn resolve(roots: &AppRoots, uri: &str) -> Result<(Vec<u8>, &'static str), Rejection> {
    let (extension, version, tail) = parse_uri(uri).ok_or(Rejection::BadRequest)?;
    let root = roots.get(&extension, &version).ok_or(Rejection::NotFound)?;
    let relative = if tail.is_empty() {
        root.entry.clone()
    } else {
        percent_decode_once(&tail).ok_or(Rejection::OutsideRoot)?
    };
    let segments = relative_segments(&relative).ok_or(Rejection::OutsideRoot)?;
    // 등록 때 푼 실제 경로를 요청 때 한 번 더 푼다. 그 폴더 안의 링크는 아래 starts_with 검사가 잡는다.
    let real_root = fs::canonicalize(&root.root).map_err(|_| Rejection::NotFound)?;
    let mut declared = real_root.clone();
    for segment in &segments {
        declared.push(segment);
    }
    let real = fs::canonicalize(&declared).map_err(|_| Rejection::NotFound)?;
    if !real.starts_with(&real_root) {
        return Err(Rejection::OutsideRoot);
    }
    // `Path::starts_with`는 마디 단위라 `/a/bc`가 `/a/b` 안으로 보이지 않는다. 성분에 `..`이 남지 않는지도 본다.
    if real.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(Rejection::OutsideRoot);
    }
    let meta = fs::metadata(&real).map_err(|_| Rejection::NotFound)?;
    if meta.is_dir() {
        return Err(Rejection::NotAFile);
    }
    if !meta.is_file() {
        return Err(Rejection::NotFound);
    }
    let content_type = content_type_of(&real).ok_or(Rejection::ForbiddenType)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(Rejection::TooLarge);
    }
    let body = fs::read(&real).map_err(|_| Rejection::NotFound)?;
    Ok((body, content_type))
}

/// 응답 하나. 성공은 파일 내용과 보안 헤더, 실패는 상태 코드와 빈 본문이다(이유 글을 내보내지 않는다).
pub fn respond(
    roots: &AppRoots,
    method: &str,
    uri: &str,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    if method != "GET" && method != "HEAD" {
        return failure(Rejection::MethodNotAllowed);
    }
    match resolve(roots, uri) {
        Ok((body, content_type)) => {
            let Some((extension, version, _)) = parse_uri(uri) else {
                return failure(Rejection::BadRequest);
            };
            let base = format!("{SCHEME}://{extension}/{version}/");
            let body = if method == "HEAD" { Vec::new() } else { body };
            tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", content_type)
                .header("Content-Security-Policy", frame_csp(&base))
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .header("Referrer-Policy", "no-referrer")
                .header("Permissions-Policy", PERMISSIONS_POLICY)
                .body(Cow::Owned(body))
                .unwrap_or_else(|_| failure(Rejection::BadRequest))
        }
        Err(rejection) => failure(rejection),
    }
}

fn failure(rejection: Rejection) -> tauri::http::Response<Cow<'static, [u8]>> {
    let mut response = tauri::http::Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = tauri::http::StatusCode::from_u16(rejection.status())
        .unwrap_or(tauri::http::StatusCode::BAD_REQUEST);
    response
}

/// 메인 창이 app root 목록을 통째로 바꾼다. 거부하면 아무것도 바꾸지 않는다.
#[tauri::command]
pub fn app_roots_set(
    roots: tauri::State<'_, std::sync::Arc<AppRoots>>,
    entries: Vec<AppRootInput>,
) -> Result<(), String> {
    roots.replace(entries).map_err(|error| match error {
        RootsError::TooMany => "too_many".to_string(),
        RootsError::BadName => "bad_name".to_string(),
        RootsError::BadVersion => "bad_version".to_string(),
        RootsError::BadEntry => "bad_entry".to_string(),
        RootsError::NotAbsolute => "not_absolute".to_string(),
        RootsError::NotADirectory => "not_a_directory".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// 시험용 임시 폴더. 지울 때까지 쓰는 쪽이 책임진다.
    struct Sandbox {
        dir: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir()
                .join(format!("fresnel-view-scheme-{}-{n}", std::process::id()));
            fs::create_dir_all(dir.join("ext/ui/sub")).unwrap();
            fs::write(dir.join("ext/ui/index.html"), "<html>ok</html>").unwrap();
            fs::write(dir.join("ext/ui/app.js"), "1").unwrap();
            fs::write(dir.join("ext/ui/sub/a.css"), "a{}").unwrap();
            fs::write(dir.join("ext/ui/x.wasm"), "\0asm").unwrap();
            fs::write(dir.join("ext/ui/UP.JS"), "2").unwrap();
            fs::write(dir.join("secret.txt"), "SECRET").unwrap();
            fs::write(dir.join("ext/other.txt"), "OTHER").unwrap();
            Sandbox { dir }
        }

        fn roots(&self) -> AppRoots {
            let roots = AppRoots::default();
            roots
                .replace(vec![AppRootInput {
                    extension: "helm".into(),
                    version: "1.0.0".into(),
                    root: self.dir.join("ext/ui").to_string_lossy().into_owned(),
                    entry: "index.html".into(),
                }])
                .unwrap();
            roots
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn get(roots: &AppRoots, tail: &str) -> Result<(Vec<u8>, &'static str), Rejection> {
        resolve(roots, &format!("fresnel-view://helm/1.0.0/{tail}"))
    }

    #[test]
    fn serves_entry_and_files_with_their_content_type() {
        let sandbox = Sandbox::new();
        let roots = sandbox.roots();
        assert_eq!(
            get(&roots, "").unwrap(),
            (b"<html>ok</html>".to_vec(), "text/html; charset=utf-8")
        );
        assert_eq!(
            get(&roots, "app.js").unwrap(),
            (b"1".to_vec(), "text/javascript; charset=utf-8")
        );
        assert_eq!(
            get(&roots, "sub/a.css").unwrap(),
            (b"a{}".to_vec(), "text/css; charset=utf-8")
        );
        // 확장자는 대소문자를 가리지 않는다
        assert_eq!(
            get(&roots, "UP.JS").unwrap().1,
            "text/javascript; charset=utf-8"
        );
    }

    #[test]
    fn hostile_requests_are_refused_with_fixed_reasons() {
        let sandbox = Sandbox::new();
        let roots = sandbox.roots();
        let cases: &[(&str, Rejection)] = &[
            ("../secret.txt", Rejection::OutsideRoot),
            ("%2e%2e/secret.txt", Rejection::OutsideRoot),
            ("sub/%2E%2E/%2E%2E/secret.txt", Rejection::OutsideRoot),
            ("a//b", Rejection::OutsideRoot),
            ("./app.js", Rejection::OutsideRoot),
            ("sub/./a.css", Rejection::OutsideRoot),
            ("%5Capp.js", Rejection::OutsideRoot),
            ("app.js%00.png", Rejection::OutsideRoot),
            ("%2Fetc%2Fpasswd", Rejection::OutsideRoot),
            ("C:/Windows/win.ini", Rejection::OutsideRoot),
            ("%GG", Rejection::OutsideRoot),
            ("%C3%28", Rejection::OutsideRoot),
            // 두 번 인코딩한 `..`은 한 번만 풀어 글자 그대로의 마디가 된다. 그런 이름의 파일이 없으니 찾지 못한 것이다
            ("%252e%252e/secret.txt", Rejection::NotFound),
            ("nope.js", Rejection::NotFound),
            ("sub", Rejection::NotAFile),
            ("x.wasm", Rejection::ForbiddenType),
        ];
        for (tail, expected) in cases {
            assert_eq!(get(&roots, tail).unwrap_err(), *expected, "{tail}");
        }
    }

    #[test]
    fn uri_shape_is_checked() {
        for bad in [
            "https://helm/1.0.0/a.js",
            "fresnel-view://helm/latest/a.js",
            "fresnel-view://user@helm/1.0.0/a.js",
            "fresnel-view://helm:80/1.0.0/a.js",
            "fresnel-view://HELM/1.0.0/a.js",
            "fresnel-view://helm/1.0.0/a.js?x=1",
            "fresnel-view://helm/1.0.0/a.js#x",
            "fresnel-view://helm",
            "fresnel-view:///1.0.0/a.js",
        ] {
            assert_eq!(parse_uri(bad), None, "{bad}");
        }
        assert_eq!(
            parse_uri("fresnel-view://helm/1.0.0/ui/a.js"),
            Some(("helm".into(), "1.0.0".into(), "ui/a.js".into()))
        );
        // 등록되지 않은 확장이나 버전은 찾지 못한다
        let sandbox = Sandbox::new();
        let roots = sandbox.roots();
        assert_eq!(
            resolve(&roots, "fresnel-view://other/1.0.0/index.html").unwrap_err(),
            Rejection::NotFound
        );
        assert_eq!(
            resolve(&roots, "fresnel-view://helm/2.0.0/index.html").unwrap_err(),
            Rejection::NotFound
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_that_leave_the_root_are_refused() {
        use std::os::unix::fs::symlink;
        let sandbox = Sandbox::new();
        symlink(
            sandbox.dir.join("secret.txt"),
            sandbox.dir.join("ext/ui/link.txt"),
        )
        .unwrap();
        symlink(sandbox.dir.join("ext"), sandbox.dir.join("ext/ui/dir-link")).unwrap();
        let roots = sandbox.roots();
        assert_eq!(get(&roots, "link.txt").unwrap_err(), Rejection::OutsideRoot);
        assert_eq!(
            get(&roots, "dir-link/other.txt").unwrap_err(),
            Rejection::OutsideRoot
        );
        // root 자체가 등록 뒤에 밖을 가리키는 링크로 바뀌어도 밖의 파일은 나오지 않는다
        let swapped = AppRoots::default();
        let link_root = sandbox.dir.join("root-link");
        symlink(sandbox.dir.join("ext/ui"), &link_root).unwrap();
        swapped
            .replace(vec![AppRootInput {
                extension: "helm".into(),
                version: "1.0.0".into(),
                root: link_root.to_string_lossy().into_owned(),
                entry: "index.html".into(),
            }])
            .unwrap();
        fs::remove_file(&link_root).unwrap();
        symlink(sandbox.dir.join("ext"), &link_root).unwrap();
        assert_eq!(
            get(&swapped, "../secret.txt").unwrap_err(),
            Rejection::OutsideRoot
        );
        // 등록 때 푼 실제 경로(ext/ui)를 쓰므로 링크를 바꿔도 root가 밖으로 옮겨 가지 않는다
        assert_eq!(get(&swapped, "other.txt").unwrap_err(), Rejection::NotFound);
        assert_eq!(get(&swapped, "app.js").unwrap().0, b"1".to_vec());
    }

    #[test]
    fn registration_rejects_bad_input_and_replaces_the_whole_list() {
        let sandbox = Sandbox::new();
        let roots = sandbox.roots();
        let good = |extension: &str, root: &Path| AppRootInput {
            extension: extension.into(),
            version: "1.0.0".into(),
            root: root.to_string_lossy().into_owned(),
            entry: "index.html".into(),
        };
        let ui = sandbox.dir.join("ext/ui");
        assert_eq!(
            roots.replace(vec![good("Bad", &ui)]),
            Err(RootsError::BadName)
        );
        assert_eq!(
            roots.replace(vec![AppRootInput {
                version: "x".into(),
                ..good("helm", &ui)
            }]),
            Err(RootsError::BadVersion)
        );
        assert_eq!(
            roots.replace(vec![AppRootInput {
                entry: "../index.html".into(),
                ..good("helm", &ui)
            }]),
            Err(RootsError::BadEntry)
        );
        assert_eq!(
            roots.replace(vec![good("helm", Path::new("relative/dir"))]),
            Err(RootsError::NotAbsolute)
        );
        assert_eq!(
            roots.replace(vec![good("helm", &ui.join("index.html"))]),
            Err(RootsError::NotADirectory)
        );
        // 거부하면 이전 목록이 그대로다
        assert!(get(&roots, "app.js").is_ok());
        // 성공하면 이전 항목이 사라진다
        roots.replace(vec![good("other", &ui)]).unwrap();
        assert_eq!(get(&roots, "app.js").unwrap_err(), Rejection::NotFound);
        assert!(roots
            .replace((0..257).map(|_| good("helm", &ui)).collect())
            .is_err());
    }

    #[test]
    fn responses_carry_the_frame_headers_and_hide_reasons() {
        let sandbox = Sandbox::new();
        let roots = sandbox.roots();
        let ok = respond(&roots, "GET", "fresnel-view://helm/1.0.0/index.html");
        assert_eq!(ok.status(), 200);
        let header = |name: &str| {
            ok.headers()
                .get(name)
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(header("Content-Type"), "text/html; charset=utf-8");
        assert_eq!(
            header("Content-Security-Policy"),
            "default-src 'none'; script-src fresnel-view://helm/1.0.0/; style-src fresnel-view://helm/1.0.0/ 'unsafe-inline'; img-src fresnel-view://helm/1.0.0/ data: blob:; font-src fresnel-view://helm/1.0.0/; media-src fresnel-view://helm/1.0.0/ blob:; connect-src 'none'; frame-src 'none'; worker-src fresnel-view://helm/1.0.0/ blob:; form-action 'none'; base-uri 'none'"
        );
        assert_eq!(header("X-Content-Type-Options"), "nosniff");
        assert_eq!(header("Cache-Control"), "no-store");
        assert_eq!(header("Referrer-Policy"), "no-referrer");
        assert_eq!(ok.body().as_ref(), b"<html>ok</html>");

        let head = respond(&roots, "HEAD", "fresnel-view://helm/1.0.0/index.html");
        assert_eq!((head.status().as_u16(), head.body().len()), (200, 0));
        let denied = respond(&roots, "GET", "fresnel-view://helm/1.0.0/%2e%2e/secret.txt");
        assert_eq!((denied.status().as_u16(), denied.body().len()), (403, 0));
        let missing = respond(&roots, "GET", "fresnel-view://helm/1.0.0/none.js");
        assert_eq!(missing.status().as_u16(), 404);
        let post = respond(&roots, "POST", "fresnel-view://helm/1.0.0/index.html");
        assert_eq!(post.status().as_u16(), 405);
        let bad = respond(&roots, "GET", "https://example.com/");
        assert_eq!(bad.status().as_u16(), 400);
    }

    #[test]
    fn name_and_version_rules() {
        for ok in ["helm", "a", "a-b-1"] {
            assert!(valid_extension_name(ok), "{ok}");
        }
        for bad in ["", "1a", "A", "a_b", "a/b", "a.b", &"a".repeat(65)] {
            assert!(!valid_extension_name(bad), "{bad}");
        }
        for ok in ["1.0.0", "10.20.30", "1.0.0-rc.1"] {
            assert!(valid_version(ok), "{ok}");
        }
        for bad in [
            "1.0",
            "1.0.0.0",
            "a.b.c",
            "1.0.0-",
            "1.0.0-a/b",
            "latest",
            "",
        ] {
            assert!(!valid_version(bad), "{bad}");
        }
    }
}
