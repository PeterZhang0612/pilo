use std::{
    fs::{File, FileTimes, OpenOptions},
    io::{self, Cursor, Write},
    time::{Duration, SystemTime},
};

use serde_json::json;

use super::*;

const PROJECT: &str = "/title-regression";
const HEADER: &str = "{\"type\":\"session\",\"id\":\"original\",\"cwd\":\"/title-regression\"}\n";
const PREVIEW: &str =
    "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"first message\"}}\n";

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new(body: &[u8]) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/session-index-tests")
            .join(format!("{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fixture = Self {
            path: dir.join("session.jsonl"),
        };
        std::fs::write(&fixture.path, body).unwrap();
        fixture
    }

    fn stat(&self) -> SessionFileStat {
        session_file_stat(self.path.clone()).unwrap()
    }

    fn read(&self) -> (SessionFile, usize) {
        let file = File::open(&self.path).unwrap();
        let mut reader = TrackedReader::new(&file);
        let summary =
            read_session_summary_from(&self.stat(), PROJECT, &mut reader, || file.metadata().ok())
                .unwrap()
                .unwrap();
        (summary, reader.bytes)
    }

    fn append(&self, bytes: &[u8]) {
        OpenOptions::new()
            .append(true)
            .open(&self.path)
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }

    fn rewrite(&self, bytes: &[u8]) {
        let modified = std::fs::metadata(&self.path).unwrap().modified().unwrap();
        std::fs::write(&self.path, bytes).unwrap();
        File::options()
            .write(true)
            .open(&self.path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified + Duration::from_secs(1)))
            .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        session_name_scans().lock().unwrap().remove(&self.path);
        let _ = std::fs::remove_dir_all(self.path.parent().unwrap());
    }
}

struct TrackedReader<R> {
    inner: R,
    bytes: usize,
    fail_read_after: Option<usize>,
    fail_seek_at: Option<u64>,
}

impl<R> TrackedReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            bytes: 0,
            fail_read_after: None,
            fail_seek_at: None,
        }
    }
}

impl<R: Read> Read for TrackedReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let limit = match self.fail_read_after {
            Some(limit) if self.bytes >= limit => {
                return Err(io::Error::other("injected read failure"));
            }
            Some(limit) => buffer.len().min(limit - self.bytes),
            None => buffer.len(),
        };
        let count = self.inner.read(&mut buffer[..limit])?;
        self.bytes += count;
        Ok(count)
    }
}

impl<R: Seek> Seek for TrackedReader<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        if matches!(position, SeekFrom::Start(offset) if Some(offset) == self.fail_seek_at) {
            return Err(io::Error::other("injected seek failure"));
        }
        self.inner.seek(position)
    }
}

fn title(name: &str) -> Vec<u8> {
    format!("{}\n", json!({ "type": "session_info", "name": name })).into_bytes()
}

fn pad_to(body: &mut Vec<u8>, size: usize) {
    assert!(body.len() < size);
    body.resize(size - 1, b'x');
    body.push(b'\n');
}

fn hidden_title_body(name: Option<&str>, size: usize) -> Vec<u8> {
    let mut body = format!("{HEADER}{PREVIEW}").into_bytes();
    pad_to(&mut body, 280 * 1024);
    if let Some(name) = name {
        body.extend(title(name));
    }
    pad_to(&mut body, size);
    body
}

#[test]
fn recovers_latest_title_between_windows_without_changing_jsonl() {
    let mut body = hidden_title_body(Some("旧标题"), 300 * 1024);
    body.extend(title("新标题"));
    pad_to(&mut body, 400 * 1024);
    let fixture = Fixture::new(&body);
    let (summary, bytes) = fixture.read();
    assert_eq!(summary.name.as_deref(), Some("新标题"));
    assert_eq!(
        summary.first_user_message_preview.as_deref(),
        Some("first message")
    );
    assert!(
        bytes >= body.len(),
        "the first missing-title recovery must scan history"
    );
    assert_eq!(std::fs::read(&fixture.path).unwrap(), body);
}

#[test]
fn recovers_titles_split_at_each_prefix_stage_boundary() {
    for stage in SESSION_INDEX_PREFIX_STAGES {
        let mut body = format!("{HEADER}{PREVIEW}").into_bytes();
        let line = title("跨窗口标题");
        pad_to(&mut body, HEADER.len() + stage - line.len() / 2);
        body.extend(line);
        pad_to(&mut body, 400 * 1024);
        let fixture = Fixture::new(&body);
        assert_eq!(
            fixture.read().0.name.as_deref(),
            Some("跨窗口标题"),
            "stage {stage}"
        );
    }
}

#[test]
fn named_fast_path_does_not_scan_full_history() {
    let mut body = format!("{HEADER}{PREVIEW}").into_bytes();
    body.extend(title("fast"));
    pad_to(&mut body, 4 * 1024 * 1024);
    let fixture = Fixture::new(&body);
    let (summary, bytes) = fixture.read();
    assert_eq!(summary.name.as_deref(), Some("fast"));
    assert!(bytes < 64 * 1024, "read {bytes} bytes");
    assert!(
        !session_name_scans()
            .lock()
            .unwrap()
            .contains_key(&fixture.path)
    );
}

#[test]
fn cached_named_and_untitled_files_read_only_windows_and_append_overlap() {
    for name in [Some("cached"), None] {
        let mut body = hidden_title_body(name, 4 * 1024 * 1024);
        let fixture = Fixture::new(&body);
        assert_eq!(fixture.read().0.name.as_deref(), name);
        let (summary, bytes) = fixture.read();
        assert_eq!(summary.name.as_deref(), name);
        assert!(bytes < 320 * 1024, "unchanged cached read: {bytes}");

        let mut appended = title("appended");
        pad_to(&mut appended, 128 * 1024);
        fixture.append(&appended);
        body.extend(&appended);
        let (summary, bytes) = fixture.read();
        assert_eq!(summary.name.as_deref(), Some("appended"));
        assert!(
            bytes <= 400 * 1024 + appended.len(),
            "incremental read: {bytes}"
        );
        assert_eq!(std::fs::read(&fixture.path).unwrap(), body);
    }
}

#[test]
fn split_title_survives_append_larger_than_tail_window() {
    for exact_limit in [false, true] {
        let name = if exact_limit {
            "x".repeat(SESSION_INDEX_MAX_PARSE_BYTES - (title("").len() - 1))
        } else {
            "分两次写入的标题".to_owned()
        };
        let mut body = hidden_title_body(None, 1024 * 1024);
        let line = title(&name);
        // The longest accepted line may be complete except for its final newline.
        let split = if exact_limit {
            line.len() - 1
        } else {
            line.len() / 2
        };
        body.extend(&line[..split]);
        let fixture = Fixture::new(&body);
        assert_eq!(fixture.read().0.name, None);
        let mut appended = line[split..].to_vec();
        pad_to(&mut appended, 128 * 1024);
        fixture.append(&appended);
        assert_eq!(fixture.read().0.name.as_deref(), Some(name.as_str()));
    }
}

#[test]
fn invalidates_progress_on_rewrite_shrink_header_or_boundary_change() {
    for change in ["same-size", "shrink", "header", "boundary"] {
        let body = hidden_title_body(Some("before"), 1024 * 1024);
        let fixture = Fixture::new(&body);
        assert_eq!(fixture.read().0.name.as_deref(), Some("before"));
        let size = if change == "shrink" {
            512 * 1024
        } else {
            body.len()
        };
        let mut changed = hidden_title_body(Some("after!"), size);
        match change {
            "header" => {
                let offset = HEADER.find("original").unwrap();
                changed[offset..offset + 8].copy_from_slice(b"replaced");
                changed.extend_from_slice(b"{}\n");
            }
            "boundary" => {
                changed[body.len() - 2] = b'y';
                changed.extend_from_slice(b"{}\n");
            }
            _ => {}
        }
        fixture.rewrite(&changed);
        let (summary, bytes) = fixture.read();
        assert_eq!(summary.name.as_deref(), Some("after!"), "{change}");
        assert!(
            bytes >= changed.len(),
            "{change} reused stale progress: {bytes}"
        );
    }
}

#[test]
fn headerless_prefix_is_preserved_after_cached_boundary_seek() {
    let mut body = b"{\"type\":\"message\",\"id\":\"first\",\"message\":{\"role\":\"user\",\"content\":\"first message\"}}\n".to_vec();
    pad_to(&mut body, 300 * 1024);
    let mut fixture = Fixture::new(&body);
    let recovered = fixture
        .path
        .with_file_name("2026-10-14T12-34-56-789Z_01234567-89ab-cdef-0123-456789abcdef.jsonl");
    std::fs::rename(&fixture.path, &recovered).unwrap();
    fixture.path = recovered;
    for _ in 0..2 {
        let (summary, _) = fixture.read();
        assert_eq!(
            summary.first_user_message_preview.as_deref(),
            Some("first message")
        );
        assert_eq!(summary.header["id"], "01234567-89ab-cdef-0123-456789abcdef");
    }
    assert_eq!(std::fs::read(&fixture.path).unwrap(), body);
}

#[test]
fn growth_during_scan_does_not_cache_stale_snapshot() {
    let body = hidden_title_body(None, 400 * 1024);
    let fixture = Fixture::new(&body);
    let file = File::open(&fixture.path).unwrap();
    let summary = read_session_summary_from(&fixture.stat(), PROJECT, &file, || {
        fixture.append(&title("written during scan"));
        file.metadata().ok()
    })
    .unwrap()
    .unwrap();
    assert_eq!(summary.name, None);
    assert!(
        !session_name_scans()
            .lock()
            .unwrap()
            .contains_key(&fixture.path)
    );
    assert_eq!(
        fixture.read().0.name.as_deref(),
        Some("written during scan")
    );
}

#[test]
fn recovery_obeys_snapshot_size_and_ignores_incomplete_final_line() {
    let mut body = title("complete");
    body.extend(b"{\"type\":\"session_info\",\"name\":\"unfinished\"}");
    let size = body.len() as u64;
    body.extend_from_slice(b"\n");
    body.extend(title("outside snapshot"));
    let mut reader = TrackedReader::new(Cursor::new(body));
    let mut summary = SessionIndexSummary::default();
    scan_session_name(&mut reader, size, 0, &mut summary).unwrap();
    assert_eq!(summary.name.as_deref(), Some("complete"));
    assert_eq!(reader.bytes as u64, size);
    assert!(summary.name_scanned);
}

#[test]
fn recovery_accepts_bom_crlf_and_exact_parse_limit_but_skips_oversized_lines() {
    let mut body = b"\xef\xbb\xbf{\"type\":\"session_info\",\"name\":\"BOM\"}\r\n".to_vec();
    body.extend(title(&"x".repeat(SESSION_INDEX_MAX_PARSE_BYTES)));
    body.extend(b"{\"type\":\"session_info\"}\n");
    let mut summary = SessionIndexSummary::default();
    scan_session_name(&mut Cursor::new(&body), body.len() as u64, 0, &mut summary).unwrap();
    assert_eq!(summary.name.as_deref(), Some("BOM"));

    let empty_line = title("");
    let name = "x".repeat(SESSION_INDEX_MAX_PARSE_BYTES - (empty_line.len() - 1));
    let exact = title(&name);
    assert_eq!(exact.len(), SESSION_INDEX_MAX_PARSE_BYTES + 1);
    scan_session_name(
        &mut Cursor::new(&exact),
        exact.len() as u64,
        0,
        &mut summary,
    )
    .unwrap();
    assert_eq!(summary.name.as_deref(), Some(name.as_str()));
}

#[test]
fn missing_names_do_not_clear_title_but_blank_names_do() {
    let mut body = title("before");
    body.extend(b"{\"type\":\"session_info\"}\n{\"type\":\"session_info\",\"name\":null}\n");
    let mut summary = SessionIndexSummary::default();
    scan_session_name(&mut Cursor::new(&body), body.len() as u64, 0, &mut summary).unwrap();
    assert_eq!(summary.name.as_deref(), Some("before"));
    body.extend(title("  "));
    scan_session_name(&mut Cursor::new(&body), body.len() as u64, 0, &mut summary).unwrap();
    assert_eq!(summary.name.as_deref(), Some("  "));
}

#[test]
fn recovery_does_not_extract_conversation_previews() {
    let body = format!("{PREVIEW}{{\"type\":\"session_info\",\"name\":\"title\"}}\n");
    let mut summary = SessionIndexSummary::default();
    scan_session_name(
        &mut Cursor::new(body.as_bytes()),
        body.len() as u64,
        0,
        &mut summary,
    )
    .unwrap();
    assert_eq!(summary.name.as_deref(), Some("title"));
    assert_eq!(summary.first_user_message_preview, None);
}

#[test]
fn recovery_propagates_seek_read_and_skip_failures_without_completed_progress() {
    let body = vec![b'x'; 2 * SESSION_INDEX_MAX_PARSE_BYTES];
    for failure in ["seek", "read", "oversized-skip", "boundary-skip"] {
        let mut reader = TrackedReader::new(Cursor::new(&body));
        let start = if failure == "boundary-skip" { 1 } else { 0 };
        match failure {
            "seek" => reader.fail_seek_at = Some(start),
            "oversized-skip" => reader.fail_read_after = Some(SESSION_INDEX_MAX_PARSE_BYTES + 8192),
            _ => reader.fail_read_after = Some(0),
        }
        let mut summary = SessionIndexSummary::default();
        let error =
            scan_session_name(&mut reader, body.len() as u64, start, &mut summary).unwrap_err();
        assert!(error.contains("injected"), "{failure}: {error}");
        assert!(!summary.name_scanned, "{failure}");
    }
}

#[test]
fn boundary_read_propagates_io_failures() {
    for seek_failure in [true, false] {
        let mut reader = TrackedReader::new(Cursor::new(vec![0; 512]));
        if seek_failure {
            reader.fail_seek_at = Some(256);
        } else {
            reader.fail_read_after = Some(0);
        }
        assert!(
            read_name_scan_boundary(&mut reader, 512)
                .unwrap_err()
                .contains("injected")
        );
    }
}
