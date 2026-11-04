//! 새 대화의 작업 폴더를 고르는 운영체제 폴더 선택 창(L4.desktop.spec §4.16, §10 17).
//! WebView에는 dialog 플러그인 권한을 주지 않는다. 창은 이 명령이 Rust에서 띄우고, WebView는 `pick_folder`의 답만 받는다.

use tauri_plugin_dialog::{DialogExt, FilePath};

/// 폴더 선택 창을 띄우고 고른 폴더의 절대 경로를 돌려준다. 취소하면 `None`이다.
/// 창은 플러그인이 메인 스레드에서 연다. 여기서는 콜백의 답을 기다리기만 하고 스레드를 막지 않는다.
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (answer, received) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        // 받는 쪽이 이미 사라졌으면(창이 닫혀 명령이 끝났다) 답은 쓸 곳이 없다
        let _ = answer.send(picked);
    });
    match received.await {
        Ok(picked) => Ok(picked.and_then(folder_path_text)),
        // 콜백 없이 보내는 쪽이 사라졌다(앱이 끝나는 중). 취소와 구별해 알린다
        Err(_) => Err("dialog_unavailable".into()),
    }
}

/// 플러그인이 준 경로를 입력란 글자로 바꾼다. 절대 경로 파일만 받는다.
/// `file://` 주소와 UTF-8이 아닌 경로는 `None`이다. 입력란 글자는 JSON 문자열이라 깨진 글자를 옮기지 않는다.
pub fn folder_path_text(path: FilePath) -> Option<String> {
    match path {
        FilePath::Path(path) if path.is_absolute() => path.into_os_string().into_string().ok(),
        FilePath::Path(_) | FilePath::Url(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(unix)]
    #[test]
    fn absolute_path_becomes_its_text() {
        let text = folder_path_text(FilePath::Path(PathBuf::from("/Users/me/project")));
        assert_eq!(text, Some("/Users/me/project".to_string()));
    }

    #[test]
    fn relative_path_is_not_a_folder_answer() {
        let text = folder_path_text(FilePath::Path(PathBuf::from("project/src")));
        assert_eq!(text, None);
    }

    #[test]
    fn file_url_is_not_a_folder_answer() {
        let url = tauri::Url::parse("file:///Users/me/project").expect("fixed URL parses");
        assert_eq!(folder_path_text(FilePath::Url(url)), None);
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_path_is_not_a_folder_answer() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let raw = OsStr::from_bytes(b"/Users/me/\xff");
        assert_eq!(folder_path_text(FilePath::Path(PathBuf::from(raw))), None);
    }
}
