use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncReadExt;

use crate::domain::{ConnectionKind, Project};

fn is_html(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        })
}

fn file_path(value: &str) -> Result<PathBuf, String> {
    let invalid = || "only local file URLs without queries or fragments are supported".to_owned();
    let lower = value.to_ascii_lowercase();
    if value.len() > 4096
        || !lower.starts_with("file://")
        || lower.starts_with("file:////")
        || lower.starts_with("file://localhost//")
        || value.chars().any(char::is_control)
        || value.contains('\\')
        || lower.contains("%2f")
        || lower.contains("%5c")
    {
        return Err(invalid());
    }
    for (index, byte) in value.bytes().enumerate() {
        if byte == b'%'
            && !value
                .as_bytes()
                .get(index + 1..index + 3)
                .is_some_and(|pair| pair.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(invalid());
        }
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if url.scheme() != "file"
        || url.host_str().is_some_and(|host| host != "localhost")
        || url.path().starts_with("//")
        || url.path().ends_with('/')
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let path = url.to_file_path().map_err(|_| invalid())?;
    let text = path.to_str().ok_or_else(invalid)?;
    // Reject UNC/device paths and Windows alternate data streams, not just URL hosts.
    if !path.is_absolute()
        || text.starts_with("//")
        || text.starts_with(r"\\")
        || text.chars().any(char::is_control)
        || text.get(2..).is_some_and(|suffix| suffix.contains(':'))
    {
        return Err(invalid());
    }
    Ok(path)
}

const MAX_PREVIEW_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileLinkPreview {
    path: String,
    content: String,
}

async fn checked_file_path(url: &str) -> Result<PathBuf, String> {
    let path = tokio::fs::canonicalize(file_path(url)?)
        .await
        .map_err(|error| format!("file link is not accessible: {error}"))?;
    if !tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("file link is not accessible: {error}"))?
        .is_file()
    {
        return Err("file link must resolve to a regular file".to_owned());
    }
    Ok(path)
}

async fn read_preview(path: &Path) -> Result<FileLinkPreview, String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = file.metadata().await.map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_PREVIEW_BYTES {
        return Err(
            "file preview requires a regular UTF-8 text file no larger than 1 MiB".to_owned(),
        );
    }
    let mut bytes = Vec::new();
    file.take(MAX_PREVIEW_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("failed to read file preview: {error}"))?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES || bytes.contains(&0) {
        return Err("file preview requires UTF-8 text no larger than 1 MiB".to_owned());
    }
    let content =
        String::from_utf8(bytes).map_err(|_| "file preview requires UTF-8 text".to_owned())?;
    Ok(FileLinkPreview {
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

fn check_system_extension(path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim_end_matches([' ', '.']);
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // Unknown extensions can have executable associations (for example Windows .wsb).
    if !matches!(
        extension.as_str(),
        "html"
            | "htm"
            | "pdf"
            | "txt"
            | "md"
            | "markdown"
            | "csv"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "ico"
            | "tif"
            | "tiff"
            | "avif"
    ) {
        return Err(
            "only supported document types can be opened by file links; preview code instead"
                .to_owned(),
        );
    }
    Ok(())
}

async fn check_system_file(path: &Path) -> Result<(), String> {
    check_system_extension(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if tokio::fs::metadata(path)
            .await
            .map_err(|error| error.to_string())?
            .permissions()
            .mode()
            & 0o111
            != 0
        {
            return Err("executable files cannot be opened by file links".to_owned());
        }
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    let mut header = Vec::new();
    file.take(4)
        .read_to_end(&mut header)
        .await
        .map_err(|error| error.to_string())?;
    if header.starts_with(b"MZ")
        || header.starts_with(b"\x7fELF")
        || header.starts_with(b"#!")
        || matches!(
            header.as_slice(),
            [0xfe, 0xed, 0xfa, 0xce | 0xcf]
                | [0xce | 0xcf, 0xfa, 0xed, 0xfe]
                | [0xca, 0xfe, 0xba, 0xbe]
        )
    {
        return Err("executables and scripts cannot be opened by file links".to_owned());
    }
    Ok(())
}

pub(crate) async fn open_file_link(
    app: &AppHandle,
    project: &Project,
    url: &str,
    preview: bool,
) -> Result<Option<FileLinkPreview>, String> {
    if !matches!(project.connection.kind, ConnectionKind::Local) {
        return Err("file links require a Local project".to_owned());
    }
    let path = checked_file_path(url).await?;
    if preview {
        return read_preview(&path).await.map(Some);
    }
    // Validate both names: a harmless symlink name must not disguise an executable.
    check_system_extension(&file_path(url)?)?;
    check_system_file(&path).await?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("failed to open file link: {error}"))?;
    Ok(None)
}

// Retain the original HTML-only command contract for existing callers.
pub(crate) async fn open(app: &AppHandle, project: &Project, url: &str) -> Result<(), String> {
    if !matches!(project.connection.kind, ConnectionKind::Local) {
        return Err("file links require a Local project".to_owned());
    }
    if !is_html(&file_path(url)?) || !is_html(&checked_file_path(url).await?) {
        return Err("HTML report must resolve to an HTML file".to_owned());
    }
    open_file_link(app, project, url, false).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_local_file_urls() {
        #[cfg(not(windows))]
        for url in [
            "file:///Users/example/.answer-me-with-html/pages/report.html",
            "file://localhost/tmp/report.HTM",
            "file:///tmp/%E6%8A%A5%E5%91%8A%20page.html",
        ] {
            assert!(file_path(url).is_ok(), "{url}");
        }
        #[cfg(windows)]
        assert_eq!(
            file_path("file:///C:/Users/example/My%20Pages/report.html").unwrap(),
            PathBuf::from(r"C:\Users\example\My Pages\report.html")
        );
    }

    #[tokio::test]
    async fn checks_existence_file_type_and_symlink_target_before_opening() {
        // Keep fixtures within this checkout, not the user's system temp directory.
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target")
            .join(format!("file-link-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let report = root.join("report.html");
        std::fs::write(&report, "<!doctype html><title>Report</title>").unwrap();
        let file_url = |path: &Path| Url::from_file_path(path).unwrap().to_string();
        assert_eq!(
            checked_file_path(&file_url(&report)).await.unwrap(),
            std::fs::canonicalize(&report).unwrap()
        );
        assert!(
            checked_file_path(&file_url(&root.join("missing.html")))
                .await
                .is_err()
        );
        let directory = root.join("directory.html");
        std::fs::create_dir_all(&directory).unwrap();
        assert!(checked_file_path(&file_url(&directory)).await.is_err());
        #[cfg(unix)]
        {
            let executable = root.join("program.sh");
            std::fs::write(&executable, "#!/bin/sh").unwrap();
            let link = root.join("disguised.html");
            std::os::unix::fs::symlink(&executable, &link).unwrap();
            let canonical = checked_file_path(&file_url(&link)).await.unwrap();
            assert!(check_system_file(&canonical).await.is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn previews_bounded_utf8_text_and_blocks_executable_system_opens() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target")
            .join(format!("file-preview-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for (name, content) in [
            ("README.md", "# 说明"),
            ("main.rs", "fn main() {}"),
            ("empty.py", ""),
        ] {
            let path = root.join(name);
            std::fs::write(&path, content).unwrap();
            assert_eq!(read_preview(&path).await.unwrap().content, content);
        }
        for (name, content) in [
            ("binary.rs", vec![0, 1]),
            ("invalid.md", vec![255]),
            ("large.md", vec![b'a'; MAX_PREVIEW_BYTES as usize + 1]),
        ] {
            let path = root.join(name);
            std::fs::write(&path, content).unwrap();
            assert!(read_preview(&path).await.is_err(), "{name}");
        }
        for name in [
            "app.EXE",
            "app.exe .",
            "run.cmd",
            "link.lnk",
            "link.url",
            "run.desktop",
            "run.ps1",
            "run.js",
        ] {
            assert!(check_system_extension(Path::new(name)).is_err(), "{name}");
        }
        let sandbox = root.join("sandbox.wsb");
        std::fs::write(
            &sandbox,
            "<Configuration><LogonCommand><Command>cmd.exe</Command></LogonCommand></Configuration>",
        )
        .unwrap();
        assert!(check_system_file(&sandbox).await.is_err());
        let document = root.join("document.pdf");
        std::fs::write(&document, b"%PDF").unwrap();
        assert!(check_system_file(&document).await.is_ok());
        for header in [b"MZxx", b"\x7fELF", b"#!/x", &[0xcf, 0xfa, 0xed, 0xfe]] {
            std::fs::write(&document, header).unwrap();
            assert!(check_system_file(&document).await.is_err());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let script = root.join("script.txt");
            std::fs::write(&script, "print('safe preview')").unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(check_system_file(&script).await.is_err());
            assert!(read_preview(&script).await.is_ok());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn system_open_only_allows_known_document_extensions() {
        for name in [
            "report.HTML",
            "report.htm",
            "document.pdf",
            "photo.png",
            "notes.txt",
        ] {
            assert!(check_system_extension(Path::new(name)).is_ok(), "{name}");
        }
        for name in [
            "sandbox.wsb",
            "sandbox.WSB",
            "sandbox.wsb .",
            "unknown.custom",
            "no-extension",
            "macro.docm",
            "image.svg",
        ] {
            assert!(check_system_extension(Path::new(name)).is_err(), "{name}");
        }
    }

    #[test]
    fn rejects_network_paths_and_unsafe_urls() {
        for url in [
            "https://example.com/report.html",
            "javascript:alert(1)",
            "file://server/share/report.html",
            "file:////server/share/report.html",
            "file:///tmp/report.html/",
            "file:///tmp/report.html?x=1",
            "file:///tmp/report.html#section",
            "file:///tmp/report.html?",
            "file:///tmp/report.html#",
            "file:///tmp/report%00.html",
            "file:///tmp/report%0a.html",
            "file:///tmp/%2fserver/report.html",
            "file:///C:/report.exe:payload.html",
            "file:///tmp/report\\page.html",
            "file:///tmp/report%.md",
            "file:///tmp/report%FF.md",
        ] {
            assert!(file_path(url).is_err(), "{url}");
        }
    }
}
