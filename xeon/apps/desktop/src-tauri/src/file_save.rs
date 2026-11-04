//! 대화 내보내기 파일을 저장하는 운영체제 저장 창(L4.desktop.spec §3.3).
//! WebView에는 dialog 권한을 주지 않는다. 창은 이 명령이 Rust에서 띄우고, WebView는 내용(host가 준 글)과 제안 이름만 넘긴다.

use std::path::Path;

use tauri_plugin_dialog::DialogExt;

use crate::folder_pick::folder_path_text;

/// 제안 이름의 글자 상한. 넘는 글자는 버린다
const NAME_LIMIT: usize = 200;
/// 쓸 수 있는 이름이 남지 않을 때의 이름
const FALLBACK_NAME: &str = "export.txt";

/// 저장 창을 띄우고 고른 파일에 `content`를 UTF-8로 쓴다. 저장한 절대 경로를 돌려주고, 취소하면 `None`이다.
/// 창을 열지 못하면 `dialog_unavailable`, 쓰지 못하면 `write_failed`로 거부한다. 오류 문구에는 경로나 OS 오류를 싣지 않는다.
/// 창은 플러그인이 메인 스레드에서 연다. 여기서는 콜백의 답을 기다리기만 하고 스레드를 막지 않는다.
#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let name = bare_file_name(&suggested_name);
    let (answer, received) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(name)
        .save_file(move |picked| {
            // 받는 쪽이 이미 사라졌으면(창이 닫혀 명령이 끝났다) 답은 쓸 곳이 없다
            let _ = answer.send(picked);
        });
    match received.await {
        Ok(None) => Ok(None),
        Ok(Some(picked)) => {
            // UTF-8 절대 경로가 아니면 답으로 돌려줄 수 없으니 쓰지 않는다
            let Some(path) = folder_path_text(picked) else {
                return Err("write_failed".into());
            };
            match write_text(Path::new(&path), &content) {
                Ok(()) => Ok(Some(path)),
                Err(_) => Err("write_failed".into()),
            }
        }
        // 콜백 없이 보내는 쪽이 사라졌다(앱이 끝나는 중). 취소와 구별해 알린다
        Err(_) => Err("dialog_unavailable".into()),
    }
}

/// 제안 이름을 파일 이름 하나로 줄인다. 경로 구분자(`/`, `\`) 앞부분은 버리고(`../x`는 `x`), 제어 문자를 뺀 뒤
/// 200자로 자른다. 남는 것이 없거나 `.`, `..`이면 `export.txt`다.
pub fn bare_file_name(suggested: &str) -> String {
    let last = suggested.rsplit(['/', '\\']).next().unwrap_or_default();
    let kept: String = last
        .chars()
        .filter(|c| !c.is_control())
        .take(NAME_LIMIT)
        .collect();
    let name = kept.trim();
    if name.is_empty() || name == "." || name == ".." {
        FALLBACK_NAME.to_string()
    } else {
        name.to_string()
    }
}

/// 내용을 그대로 쓴다. 같은 이름의 파일이 있으면 덮어쓴다(저장 창이 덮어쓰기를 이미 물었다).
pub fn write_text(path: &Path, content: &str) -> std::io::Result<()> {
    std::fs::write(path, content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traversal_keeps_only_the_last_name() {
        assert_eq!(bare_file_name("../x"), "x");
        assert_eq!(bare_file_name("../../etc/passwd.md"), "passwd.md");
    }

    #[test]
    fn both_separator_styles_are_cut() {
        assert_eq!(bare_file_name("a/b.md"), "b.md");
        assert_eq!(bare_file_name("C:\\Users\\me\\chat.json"), "chat.json");
    }

    #[test]
    fn empty_and_dot_names_fall_back_to_export_txt() {
        assert_eq!(bare_file_name(""), "export.txt");
        assert_eq!(bare_file_name("   "), "export.txt");
        assert_eq!(bare_file_name("dir/"), "export.txt");
        assert_eq!(bare_file_name("."), "export.txt");
        assert_eq!(bare_file_name(".."), "export.txt");
    }

    #[test]
    fn long_name_is_capped_at_200_characters() {
        let name = bare_file_name(&"가".repeat(300));
        assert_eq!(name.chars().count(), 200);
        assert_eq!(name, "가".repeat(200));
    }

    #[test]
    fn control_characters_are_dropped() {
        assert_eq!(bare_file_name("a\u{0}b\nc.md"), "abc.md");
    }

    #[test]
    fn write_text_writes_the_exact_utf8_content() {
        let dir = std::env::temp_dir().join(format!("fresnel-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir can be created");
        let path = dir.join("chat.md");
        let text = "# 제목\n\n- 항목 1\n";
        write_text(&path, text).expect("write succeeds in a temp dir");
        assert_eq!(
            std::fs::read_to_string(&path).expect("file is readable"),
            text
        );
        std::fs::remove_dir_all(&dir).expect("temp dir is removed");
    }

    #[test]
    fn write_text_into_a_missing_folder_fails() {
        let path = std::env::temp_dir()
            .join(format!("fresnel-save-missing-{}", std::process::id()))
            .join("chat.md");
        assert!(write_text(&path, "x").is_err());
    }
}
