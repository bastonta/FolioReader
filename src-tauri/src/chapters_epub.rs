//! Builds a local EPUB 3 file from the chapters of a Folio `Chapters` book.
//!
//! Such books have no file on the server (`/download` answers 409), so the reader
//! assembles one on device. The layout mirrors the server-side compiler
//! (`file_processor::chapters_epub`): paragraphs are lightweight markdown where only
//! images (`![alt](url)` and `<img src>`) are interpreted, everything else is emitted
//! as escaped text with line breaks.
//!
//! Differences from the server compiler that matter for an updatable local copy:
//! - chapter documents are named after the chapter id (`ch-<id>.xhtml`), so an update
//!   can copy unchanged chapters from the previous file instead of downloading them;
//! - `META-INF/folio-chapters.json` records which chapters and illustrations the file
//!   holds;
//! - spine `itemref`s carry no ids, so every CFI is purely positional
//!   (`/6/{2 * (index + 1)}`) and can be converted to and from a chapter id.
//!
//! A book can also be built one volume at a time ([`VolumeScope`]): such a copy holds the
//! chapters of a single volume, is titled `{title} — Том {n}`, carries series metadata and
//! records in its manifest where it sits in the whole book.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Seek, Write};
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::{CompressionMethod, ZipArchive};

/// Archive entry describing the chapters stored in a locally built EPUB.
pub const MANIFEST_PATH: &str = "META-INF/folio-chapters.json";
/// Bumped whenever the rendering changes in a way that makes old chapter documents unusable.
pub const MANIFEST_VERSION: u32 = 1;

const CONTENT_DIR: &str = "OEBPS";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestChapter {
    pub id: String,
    /// Server `updated` timestamp the chapter document was rendered from.
    #[serde(default)]
    pub updated: Option<String>,
    pub volume: f32,
    pub chapter: f32,
    pub name: String,
    /// Illustration file names referenced by the chapter.
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersManifest {
    pub version: u32,
    pub book_id: String,
    pub language: String,
    /// Cover file name inside `OEBPS/`, e.g. `cover.jpg`.
    #[serde(default)]
    pub cover: Option<String>,
    /// Volume the file holds; absent in a copy of the whole book.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f32>,
    /// Chapters of the book in the volumes before this one (volume copies only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters_before: Option<u32>,
    /// Chapters in the whole book when the file was built (volume copies only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_chapters: Option<u32>,
    pub chapters: Vec<ManifestChapter>,
}

/// The part of a book a volume copy holds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VolumeScope {
    pub volume: f32,
    /// Chapters of the book in the volumes before this one.
    pub chapters_before: usize,
    /// Chapters in the whole book.
    pub book_chapters: usize,
}

#[derive(Debug, Clone)]
pub struct EpubMeta {
    pub book_id: String,
    /// Title of the book; a volume copy appends its volume ([`volume_title`]).
    pub title: String,
    pub author: String,
    /// Already normalised with [`normalize_language`].
    pub language: String,
    pub description: Option<String>,
    /// `Some` when the file holds a single volume, `None` for the whole book.
    pub scope: Option<VolumeScope>,
}

// ================= TEXT HELPERS =================

/// Whether XML 1.0 can carry the character at all. The rest — control characters,
/// `U+FFFE`, `U+FFFF` — make a document ill-formed even as character references: one of
/// them in a chapter name takes the whole table of contents with it.
fn is_xml_char(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\r' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..='\u{10FFFF}'
    )
}

fn escape_text(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            c if is_xml_char(c) => escaped.push(c),
            // Dropped: there is no way to write it
            _ => {}
        }
    }
    escaped
}

fn escape_attr(s: &str) -> String {
    escape_text(s).replace('"', "&quot;")
}

fn format_number(n: f32) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Language tag used in the package and chapter documents (`en` when the server has none).
pub fn normalize_language(language: Option<&str>) -> String {
    let lang = language.map(str::trim).unwrap_or("");
    let valid = !lang.is_empty()
        && lang.len() <= 35
        && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        lang.to_string()
    } else {
        "en".to_string()
    }
}

fn is_russian(lang: &str) -> bool {
    let lower = lang.to_ascii_lowercase();
    lower == "ru" || lower.starts_with("ru-")
}

fn chapter_word(lang: &str) -> &'static str {
    if is_russian(lang) {
        "Глава"
    } else {
        "Chapter"
    }
}

fn volume_word(lang: &str) -> &'static str {
    if is_russian(lang) { "Том" } else { "Volume" }
}

/// Title of a copy that holds a single volume: `{title} — Том {n}`.
pub fn volume_title(lang: &str, title: &str, volume: f32) -> String {
    format!(
        "{} — {} {}",
        title.trim(),
        volume_word(lang),
        format_number(volume)
    )
}

/// File name stem of a volume copy: `{stem} - Vol {NN}`. Whole volumes are padded to two
/// digits so that files sort in reading order; a fractional volume keeps its fraction
/// (`Vol 03.5`).
pub fn volume_file_stem(stem: &str, volume: f32) -> String {
    let whole = volume.trunc();
    let number = if !volume.is_finite() || volume < 0.0 {
        format_number(volume)
    } else if volume.fract() == 0.0 {
        format!("{:02}", whole as i64)
    } else {
        let formatted = format_number(volume);
        let fraction = formatted.split_once('.').map(|(_, f)| f).unwrap_or("0");
        format!("{:02}.{fraction}", whole as i64)
    };
    format!("{stem} - Vol {number}")
}

/// `dc:identifier` of a built EPUB.
fn publication_identifier(meta: &EpubMeta) -> String {
    match &meta.scope {
        Some(scope) => format!(
            "urn:folio:{}:volume:{}",
            meta.book_id,
            format_number(scope.volume)
        ),
        None => format!("urn:uuid:{}", meta.book_id),
    }
}

/// Table of contents label of a chapter.
fn chapter_label(lang: &str, chapter: f32, name: &str) -> String {
    let name = name.trim();
    let number = format_number(chapter);
    if name.is_empty() {
        format!("{} {number}", chapter_word(lang))
    } else if name.starts_with(&number) {
        name.to_string()
    } else {
        format!("{number}. {name}")
    }
}

/// Keeps only characters that are safe in an archive entry name and an XML id.
fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// File name (relative to `OEBPS/`) of a chapter document.
pub fn chapter_file_name(chapter_id: &str) -> String {
    format!("ch-{}.xhtml", sanitize_id(chapter_id))
}

/// Archive entry name of a chapter document.
pub fn chapter_entry_name(chapter_id: &str) -> String {
    format!("{CONTENT_DIR}/{}", chapter_file_name(chapter_id))
}

/// Archive entry name of an illustration.
pub fn image_entry_name(filename: &str) -> String {
    format!("{CONTENT_DIR}/images/{filename}")
}

/// Archive entry name of a file stored directly under `OEBPS/` (the cover).
pub fn content_entry_name(filename: &str) -> String {
    format!("{CONTENT_DIR}/{filename}")
}

/// Illustration file names are embedded as archive entries and `src` attributes, so only
/// plain names are accepted (no separators, no parent references, no characters that need
/// URL escaping).
fn is_safe_image_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Extracts the illustration file name from an image URL that points into the book's own
/// image store (`/api/books/{id}/images/{file}`, optionally with a scheme and host).
fn local_image_name(url: &str, image_url_prefix: &str) -> Option<String> {
    let rest = if let Some(rest) = url.strip_prefix(image_url_prefix) {
        rest
    } else if url.starts_with("http://") || url.starts_with("https://") {
        let pos = url.find(image_url_prefix)?;
        &url[pos + image_url_prefix.len()..]
    } else {
        return None;
    };
    let file = rest.split(['?', '#']).next().unwrap_or("");
    is_safe_image_name(file).then(|| file.to_string())
}

/// Media type of an image, by extension first and by magic bytes as a fallback.
pub fn image_media_type(filename: &str, bytes: Option<&[u8]>) -> &'static str {
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => return "image/jpeg",
        "png" => return "image/png",
        "gif" => return "image/gif",
        "webp" => return "image/webp",
        "svg" => return "image/svg+xml",
        "avif" => return "image/avif",
        "bmp" => return "image/bmp",
        _ => {}
    }
    bytes
        .and_then(sniff_image)
        .map(|(_, mime)| mime)
        .unwrap_or("image/jpeg")
}

/// Detects a raster image format by its magic bytes; returns (extension, media type).
pub fn sniff_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(("png", "image/png"))
    } else if bytes.starts_with(b"GIF8") {
        Some(("gif", "image/gif"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

// ================= CHAPTER RENDERING =================

/// Converts one markdown-ish paragraph to XHTML, collecting referenced local image file names.
fn paragraph_to_xhtml(
    paragraph: &str,
    image_url_prefix: &str,
    used_images: &mut Vec<String>,
) -> String {
    let mut out = String::new();
    let mut text = String::new();
    let mut rest = paragraph;

    let flush_text = |text: &mut String, out: &mut String| {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let lines: Vec<String> = trimmed.lines().map(escape_text).collect();
            out.push_str("<p>");
            out.push_str(&lines.join("<br/>"));
            out.push_str("</p>\n");
        }
        text.clear();
    };

    while !rest.is_empty() {
        let md = rest.find("![");
        let html = rest.find("<img");
        let next = match (md, html) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(pos) = next else {
            text.push_str(rest);
            break;
        };

        text.push_str(&rest[..pos]);
        let tail = &rest[pos..];

        let parsed = if tail.starts_with("![") {
            parse_markdown_image(tail)
        } else {
            parse_html_image(tail)
        };

        match parsed {
            Some((alt, url, consumed)) => {
                flush_text(&mut text, &mut out);
                if let Some(file) = local_image_name(&url, image_url_prefix) {
                    if !used_images.contains(&file) {
                        used_images.push(file.clone());
                    }
                    out.push_str(&format!(
                        "<figure><img src=\"images/{}\" alt=\"{}\"/></figure>\n",
                        escape_attr(&file),
                        escape_attr(&alt)
                    ));
                } else if !alt.trim().is_empty() {
                    // External image: keep only its caption
                    out.push_str(&format!("<p><em>{}</em></p>\n", escape_text(alt.trim())));
                }
                rest = &tail[consumed..];
            }
            None => {
                // Not an image after all: emit the marker literally
                let marker_len = if tail.starts_with("![") { 2 } else { 4 };
                text.push_str(&tail[..marker_len]);
                rest = &tail[marker_len..];
            }
        }
    }

    flush_text(&mut text, &mut out);
    out
}

/// Parses `![alt](url "title")` at the start of `s`; returns (alt, url, consumed bytes).
fn parse_markdown_image(s: &str) -> Option<(String, String, usize)> {
    let close_alt = s.find("](")?;
    let alt = &s[2..close_alt];
    let after = &s[close_alt + 2..];
    let close = after.find(')')?;
    let inner = after[..close].trim();
    let url = inner.split_whitespace().next().unwrap_or("").to_string();
    if url.is_empty() {
        return None;
    }
    Some((alt.to_string(), url, close_alt + 2 + close + 1))
}

/// Parses `<img ... src="url" ...>` at the start of `s`; returns (alt, url, consumed bytes).
fn parse_html_image(s: &str) -> Option<(String, String, usize)> {
    let end = s.find('>')?;
    let tag = &s[..end];
    let url = extract_attr(tag, "src")?;
    let alt = extract_attr(tag, "alt").unwrap_or_default();
    Some((alt, url, end + 1))
}

fn extract_attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut search = 0;
    while let Some(rel) = lower[search..].find(name) {
        let idx = search + rel;
        let after = lower[idx + name.len()..].trim_start();
        if after.starts_with('=') {
            let value_start =
                idx + name.len() + (lower[idx + name.len()..].len() - after.len()) + 1;
            let value = tag[value_start..].trim_start();
            let quote = value.chars().next()?;
            if quote == '"' || quote == '\'' {
                let inner = &value[1..];
                let close = inner.find(quote)?;
                return Some(inner[..close].to_string());
            }
            let end = value
                .find(|c: char| c.is_whitespace() || c == '>')
                .unwrap_or(value.len());
            return Some(value[..end].to_string());
        }
        search = idx + name.len();
    }
    None
}

/// Renders a chapter to an XHTML document.
/// Returns the document and the illustration file names it references.
pub fn render_chapter(
    lang: &str,
    chapter: f32,
    name: &str,
    paragraphs: &[String],
    image_url_prefix: &str,
) -> (String, Vec<String>) {
    let mut used_images: Vec<String> = Vec::new();
    let mut body = String::new();
    for paragraph in paragraphs {
        body.push_str(&paragraph_to_xhtml(
            paragraph,
            image_url_prefix,
            &mut used_images,
        ));
    }
    if body.is_empty() {
        body.push_str("<p></p>\n");
    }

    let title = if name.trim().is_empty() {
        chapter_label(lang, chapter, name)
    } else {
        name.trim().to_string()
    };
    let heading = escape_text(&title);
    let doc = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">
<head>
  <meta charset="UTF-8"/>
  <title>{heading}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body epub:type="bodymatter">
  <section epub:type="chapter">
    <h2>{heading}</h2>
{body}  </section>
</body>
</html>
"#
    );
    (doc, used_images)
}

const STYLESHEET: &str = r#"body { font-family: serif; line-height: 1.5; margin: 1em; }
h2 { text-align: center; margin: 1.5em 0 1em; }
p { margin: 0 0 0.9em; text-indent: 1.2em; }
figure { margin: 1em 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
"#;

const CONTAINER_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"#;

// ================= EPUB WRITER =================

fn zip_err(e: impl std::fmt::Display) -> String {
    format!("Failed to write EPUB: {e}")
}

/// Incremental EPUB writer: chapter documents and illustrations are appended as they
/// arrive (downloaded or copied from the previous file), the package document, the
/// navigation document and the chapter manifest are written by [`EpubWriter::finish`].
pub struct EpubWriter<W: Write + Seek> {
    zip: ZipWriter<W>,
    chapters: HashSet<String>,
    /// (file name, media type) in the order they were added.
    images: Vec<(String, String)>,
    /// (file name, media type)
    cover: Option<(String, String)>,
}

impl<W: Write + Seek> EpubWriter<W> {
    pub fn new(writer: W) -> Result<Self, String> {
        let mut zip = ZipWriter::new(writer);
        // The `mimetype` entry must come first and must not be compressed.
        zip.start_file("mimetype", Self::stored())
            .map_err(zip_err)?;
        zip.write_all(b"application/epub+zip").map_err(zip_err)?;
        zip.start_file("META-INF/container.xml", Self::deflated())
            .map_err(zip_err)?;
        zip.write_all(CONTAINER_XML.as_bytes()).map_err(zip_err)?;
        Ok(Self {
            zip,
            chapters: HashSet::new(),
            images: Vec::new(),
            cover: None,
        })
    }

    fn stored() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
    }

    fn deflated() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
    }

    pub fn has_image(&self, filename: &str) -> bool {
        self.images.iter().any(|(name, _)| name == filename)
    }

    /// Adds a freshly rendered chapter document.
    pub fn add_chapter(&mut self, chapter_id: &str, xhtml: &str) -> Result<(), String> {
        if !self.chapters.insert(chapter_id.to_string()) {
            return Ok(());
        }
        self.zip
            .start_file(chapter_entry_name(chapter_id), Self::deflated())
            .map_err(zip_err)?;
        self.zip.write_all(xhtml.as_bytes()).map_err(zip_err)
    }

    /// Copies a chapter document from a previously built EPUB without recompressing it.
    pub fn copy_chapter<R: Read + Seek>(
        &mut self,
        source: &mut ZipArchive<R>,
        chapter_id: &str,
    ) -> Result<(), String> {
        if self.chapters.contains(chapter_id) {
            return Ok(());
        }
        let entry = source
            .by_name(&chapter_entry_name(chapter_id))
            .map_err(|e| format!("Failed to reuse chapter {chapter_id}: {e}"))?;
        self.zip.raw_copy_file(entry).map_err(zip_err)?;
        self.chapters.insert(chapter_id.to_string());
        Ok(())
    }

    /// Adds an illustration.
    pub fn add_image(&mut self, filename: &str, bytes: &[u8]) -> Result<(), String> {
        if self.has_image(filename) {
            return Ok(());
        }
        if !is_safe_image_name(filename) {
            return Err(format!("Unsupported illustration file name '{filename}'"));
        }
        self.zip
            .start_file(image_entry_name(filename), Self::stored())
            .map_err(zip_err)?;
        self.zip.write_all(bytes).map_err(zip_err)?;
        self.images.push((
            filename.to_string(),
            image_media_type(filename, Some(bytes)).to_string(),
        ));
        Ok(())
    }

    /// Copies an illustration from a previously built EPUB.
    pub fn copy_image<R: Read + Seek>(
        &mut self,
        source: &mut ZipArchive<R>,
        filename: &str,
    ) -> Result<(), String> {
        if self.has_image(filename) {
            return Ok(());
        }
        let entry = source
            .by_name(&image_entry_name(filename))
            .map_err(|e| format!("Failed to reuse illustration {filename}: {e}"))?;
        self.zip.raw_copy_file(entry).map_err(zip_err)?;
        self.images.push((
            filename.to_string(),
            image_media_type(filename, None).to_string(),
        ));
        Ok(())
    }

    /// Stores the cover image; `extension` and the media type are detected from the bytes.
    pub fn set_cover(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.cover.is_some() {
            return Ok(());
        }
        let (extension, mime) = sniff_image(bytes).unwrap_or(("jpg", "image/jpeg"));
        let filename = format!("cover.{extension}");
        self.zip
            .start_file(content_entry_name(&filename), Self::stored())
            .map_err(zip_err)?;
        self.zip.write_all(bytes).map_err(zip_err)?;
        self.cover = Some((filename, mime.to_string()));
        Ok(())
    }

    /// Copies the cover of a previously built EPUB (`filename` comes from its manifest).
    pub fn copy_cover<R: Read + Seek>(
        &mut self,
        source: &mut ZipArchive<R>,
        filename: &str,
    ) -> Result<(), String> {
        if self.cover.is_some() {
            return Ok(());
        }
        let valid = filename.starts_with("cover.")
            && filename[6..].chars().all(|c| c.is_ascii_alphanumeric())
            && filename.len() > 6;
        if !valid {
            return Err(format!("Unexpected cover file name '{filename}'"));
        }
        let entry = source
            .by_name(&content_entry_name(filename))
            .map_err(|e| format!("Failed to reuse cover: {e}"))?;
        self.zip.raw_copy_file(entry).map_err(zip_err)?;
        self.cover = Some((
            filename.to_string(),
            image_media_type(filename, None).to_string(),
        ));
        Ok(())
    }

    /// Writes the navigation document, the package document and the chapter manifest, then
    /// closes the archive. `chapters` defines the reading order; every chapter must have
    /// been added with [`Self::add_chapter`] or [`Self::copy_chapter`].
    pub fn finish(
        mut self,
        meta: &EpubMeta,
        chapters: &[ManifestChapter],
    ) -> Result<(W, ChaptersManifest), String> {
        if chapters.is_empty() {
            return Err("Book has no chapters".to_string());
        }
        if let Some(missing) = chapters.iter().find(|c| !self.chapters.contains(&c.id)) {
            return Err(format!(
                "Chapter {} was not written to the EPUB",
                missing.id
            ));
        }

        let lang = meta.language.as_str();
        let book_title = if meta.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            meta.title.trim().to_string()
        };
        let title = match &meta.scope {
            Some(scope) => volume_title(lang, &book_title, scope.volume),
            None => book_title.clone(),
        };

        let nav_xhtml = build_nav(lang, &title, chapters);
        self.zip
            .start_file(content_entry_name("nav.xhtml"), Self::deflated())
            .map_err(zip_err)?;
        self.zip.write_all(nav_xhtml.as_bytes()).map_err(zip_err)?;

        self.zip
            .start_file(content_entry_name("style.css"), Self::deflated())
            .map_err(zip_err)?;
        self.zip.write_all(STYLESHEET.as_bytes()).map_err(zip_err)?;

        let opf = build_opf(
            meta,
            &title,
            &book_title,
            chapters,
            &self.images,
            self.cover.as_ref(),
        );
        self.zip
            .start_file(content_entry_name("content.opf"), Self::deflated())
            .map_err(zip_err)?;
        self.zip.write_all(opf.as_bytes()).map_err(zip_err)?;

        let manifest = ChaptersManifest {
            version: MANIFEST_VERSION,
            book_id: meta.book_id.clone(),
            language: meta.language.clone(),
            cover: self.cover.as_ref().map(|(name, _)| name.clone()),
            volume: meta.scope.map(|s| s.volume),
            chapters_before: meta.scope.map(|s| s.chapters_before as u32),
            book_chapters: meta.scope.map(|s| s.book_chapters as u32),
            chapters: chapters.to_vec(),
        };
        let manifest_json = serde_json::to_vec(&manifest).map_err(zip_err)?;
        self.zip
            .start_file(MANIFEST_PATH, Self::deflated())
            .map_err(zip_err)?;
        self.zip.write_all(&manifest_json).map_err(zip_err)?;

        let writer = self.zip.finish().map_err(zip_err)?;
        Ok((writer, manifest))
    }
}

fn build_nav(lang: &str, title: &str, chapters: &[ManifestChapter]) -> String {
    // Group by volume when there is more than one
    let mut volumes: BTreeMap<i64, Vec<&ManifestChapter>> = BTreeMap::new();
    for chapter in chapters {
        volumes
            .entry((chapter.volume * 1000.0) as i64)
            .or_default()
            .push(chapter);
    }

    let mut nav_items = String::new();
    if volumes.len() > 1 {
        for entries in volumes.values() {
            let Some(first) = entries.first() else {
                continue;
            };
            nav_items.push_str(&format!(
                "      <li><a href=\"{}\">{} {}</a>\n        <ol>\n",
                chapter_file_name(&first.id),
                volume_word(lang),
                format_number(first.volume)
            ));
            for chapter in entries {
                nav_items.push_str(&format!(
                    "          <li><a href=\"{}\">{}</a></li>\n",
                    chapter_file_name(&chapter.id),
                    escape_text(&chapter_label(lang, chapter.chapter, &chapter.name))
                ));
            }
            nav_items.push_str("        </ol>\n      </li>\n");
        }
    } else {
        for chapter in chapters {
            nav_items.push_str(&format!(
                "      <li><a href=\"{}\">{}</a></li>\n",
                chapter_file_name(&chapter.id),
                escape_text(&chapter_label(lang, chapter.chapter, &chapter.name))
            ));
        }
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">
<head>
  <meta charset="UTF-8"/>
  <title>{title}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>{title}</h1>
    <ol>
{nav_items}    </ol>
  </nav>
</body>
</html>
"#,
        title = escape_text(title),
    )
}

fn build_opf(
    meta: &EpubMeta,
    title: &str,
    book_title: &str,
    chapters: &[ManifestChapter],
    images: &[(String, String)],
    cover: Option<&(String, String)>,
) -> String {
    let lang = meta.language.as_str();
    let modified = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let mut manifest = String::new();
    manifest.push_str(
        "    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n",
    );
    manifest.push_str("    <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n");
    if let Some((filename, mime)) = cover {
        manifest.push_str(&format!(
            "    <item id=\"cover-image\" href=\"{}\" media-type=\"{}\" properties=\"cover-image\"/>\n",
            escape_attr(filename),
            escape_attr(mime)
        ));
    }
    for chapter in chapters {
        manifest.push_str(&format!(
            "    <item id=\"ch-{}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>\n",
            sanitize_id(&chapter.id),
            chapter_file_name(&chapter.id)
        ));
    }
    for (i, (filename, mime)) in images.iter().enumerate() {
        manifest.push_str(&format!(
            "    <item id=\"img{}\" href=\"images/{}\" media-type=\"{}\"/>\n",
            i + 1,
            escape_attr(filename),
            escape_attr(mime)
        ));
    }

    // No ids on itemrefs: CFIs stay purely positional (see module docs).
    let spine: String = chapters
        .iter()
        .map(|c| format!("    <itemref idref=\"ch-{}\"/>\n", sanitize_id(&c.id)))
        .collect();

    let description_xml = meta
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| format!("    <dc:description>{}</dc:description>\n", escape_text(d)))
        .unwrap_or_default();
    let cover_meta = if cover.is_some() {
        "    <meta name=\"cover\" content=\"cover-image\"/>\n"
    } else {
        ""
    };
    // A volume copy is one book of a series named after the whole book.
    let series_meta = meta
        .scope
        .map(|scope| {
            let index = format_number(scope.volume);
            format!(
                concat!(
                    "    <meta property=\"belongs-to-collection\" id=\"series\">{name}</meta>\n",
                    "    <meta refines=\"#series\" property=\"collection-type\">series</meta>\n",
                    "    <meta refines=\"#series\" property=\"group-position\">{index}</meta>\n",
                    "    <meta name=\"calibre:series\" content=\"{attr}\"/>\n",
                    "    <meta name=\"calibre:series_index\" content=\"{index}\"/>\n",
                ),
                name = escape_text(book_title),
                attr = escape_attr(book_title),
                index = index,
            )
        })
        .unwrap_or_default();

    // `metadata`, `manifest`, `spine` must stay in this order: CFIs address the spine as
    // the third child of `package` (`/6`).
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="{lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">{identifier}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator id="creator">{author}</dc:creator>
    <dc:language>{lang}</dc:language>
{description}    <meta property="dcterms:modified">{modified}</meta>
{cover_meta}{series_meta}  </metadata>
  <manifest>
{manifest}  </manifest>
  <spine>
{spine}  </spine>
</package>
"#,
        identifier = escape_text(&publication_identifier(meta)),
        title = escape_text(title),
        author = escape_text(meta.author.trim()),
        description = description_xml,
    )
}

// ================= READING A PREVIOUS BUILD =================

/// What a previously built EPUB can contribute to an update.
#[derive(Debug, Clone)]
pub struct ExistingEpub {
    pub manifest: ChaptersManifest,
    /// Names of all archive entries.
    pub entries: HashSet<String>,
}

impl ExistingEpub {
    /// The stored document of `chapter` can be reused when nothing it was rendered from
    /// has changed on the server.
    pub fn reusable_chapter(
        &self,
        language: &str,
        id: &str,
        updated: Option<&str>,
        volume: f32,
        chapter: f32,
        name: &str,
    ) -> Option<&ManifestChapter> {
        if self.manifest.version != MANIFEST_VERSION || self.manifest.language != language {
            return None;
        }
        let stored = self.manifest.chapters.iter().find(|c| c.id == id)?;
        let same = stored.updated.as_deref() == updated
            && stored.volume == volume
            && stored.chapter == chapter
            && stored.name == name;
        (same && self.entries.contains(&chapter_entry_name(id))).then_some(stored)
    }

    pub fn has_image(&self, filename: &str) -> bool {
        self.entries.contains(&image_entry_name(filename))
    }

    /// Whether the file is the copy of `book_id` holding `volume` (`None`: the whole book).
    /// Copies of different scopes are different files and never replace one another.
    pub fn is_copy_of(&self, book_id: &str, volume: Option<f32>) -> bool {
        self.manifest.book_id == book_id && self.manifest.volume == volume
    }

    /// Cover file name, when the previous build embedded one.
    pub fn cover(&self) -> Option<&str> {
        let cover = self.manifest.cover.as_deref()?;
        self.entries
            .contains(&content_entry_name(cover))
            .then_some(cover)
    }
}

/// Reads the chapter manifest of an EPUB built by this module.
/// Returns `None` for any other EPUB (or an unreadable file).
pub fn read_existing<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Option<ExistingEpub> {
    let manifest: ChaptersManifest = {
        let mut entry = archive.by_name(MANIFEST_PATH).ok()?;
        let mut raw = Vec::new();
        entry.read_to_end(&mut raw).ok()?;
        serde_json::from_slice(&raw).ok()?
    };
    let entries = archive
        .file_names()
        .filter_map(|name| name.ok().map(|n| n.into_owned()))
        .collect();
    Some(ExistingEpub { manifest, entries })
}

// ================= CFI HELPERS =================

const CFI_SPINE_PREFIX: &str = "epubcfi(/6/";

/// Splits a CFI into (spine step number, rest of the CFI after the number).
fn split_spine_step(cfi: &str) -> Option<(usize, &str)> {
    let rest = cfi.trim().strip_prefix(CFI_SPINE_PREFIX)?;
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let step: usize = rest[..digits].parse().ok()?;
    Some((step, &rest[digits..]))
}

/// Spine index (0-based) addressed by a CFI: `/6/{2 * (index + 1)}`.
pub fn cfi_spine_index(cfi: &str) -> Option<usize> {
    let (step, _) = split_spine_step(cfi)?;
    (step >= 2 && step % 2 == 0).then(|| step / 2 - 1)
}

/// CFI of the beginning of the spine item at `position`.
pub fn chapter_start_cfi(position: usize) -> String {
    format!("{CFI_SPINE_PREFIX}{}!/4)", (position + 1) * 2)
}

/// Rewrites the spine step of a CFI when its chapter moved to another position
/// (`moved` maps old spine indexes to new ones). Returns `None` when nothing changes.
pub fn remap_cfi_spine(cfi: &str, moved: &HashMap<usize, usize>) -> Option<String> {
    let (_, rest) = split_spine_step(cfi)?;
    let old = cfi_spine_index(cfi)?;
    let new = *moved.get(&old)?;
    if new == old {
        return None;
    }
    Some(format!("{CFI_SPINE_PREFIX}{}{rest}", (new + 1) * 2))
}

/// Moves the spine step of a CFI by `delta` spine items (a volume copy addresses its
/// first chapter as spine item 0, the server counts from the start of the book).
/// Returns `None` for anything that is not a spine-addressed CFI or would leave the spine.
pub fn shift_cfi_spine(cfi: &str, delta: i64) -> Option<String> {
    let (_, rest) = split_spine_step(cfi)?;
    let old = cfi_spine_index(cfi)? as i64;
    let new = old.checked_add(delta)?;
    if new < 0 {
        return None;
    }
    Some(format!("{CFI_SPINE_PREFIX}{}{rest}", (new + 1) * 2))
}

// ================= PERCENTAGES OF A VOLUME COPY =================
//
// The server keeps one reading percentage per book, in the scale of the whole book. A
// volume copy covers `chapters_in_copy` chapters that start `chapters_before` chapters
// into a book of `book_chapters`.

fn scale_total(chapters_before: usize, chapters_in_copy: usize, book_chapters: usize) -> usize {
    // Counts recorded at build time may lag behind one another
    book_chapters.max(chapters_before + chapters_in_copy)
}

/// Reading percentage inside a volume copy -> percentage of the whole book.
pub fn copy_to_book_percent(
    percent: f32,
    chapters_before: usize,
    chapters_in_copy: usize,
    book_chapters: usize,
) -> f32 {
    let total = scale_total(chapters_before, chapters_in_copy, book_chapters);
    if total == 0 || percent.is_nan() {
        return percent;
    }
    // f64: a few thousand chapters times a percentage should not pick up f32 noise
    let fraction = (f64::from(percent) / 100.0).clamp(0.0, 1.0);
    let chapters_read = chapters_before as f64 + fraction * chapters_in_copy as f64;
    (chapters_read / total as f64 * 100.0).clamp(0.0, 100.0) as f32
}

/// Percentage of the whole book -> reading percentage inside a volume copy (0 before the
/// copy starts, 100 after it ends).
pub fn book_to_copy_percent(
    percent: f32,
    chapters_before: usize,
    chapters_in_copy: usize,
    book_chapters: usize,
) -> f32 {
    let total = scale_total(chapters_before, chapters_in_copy, book_chapters);
    if total == 0 || chapters_in_copy == 0 || percent.is_nan() {
        return percent;
    }
    let chapters_read = (f64::from(percent) / 100.0).clamp(0.0, 1.0) * total as f64;
    let fraction = (chapters_read - chapters_before as f64) / chapters_in_copy as f64;
    (fraction.clamp(0.0, 1.0) * 100.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const PREFIX: &str = "/api/books/b1/images/";

    fn meta() -> EpubMeta {
        EpubMeta {
            book_id: "00000000-0000-0000-0000-000000000001".into(),
            title: "Test & Title".into(),
            author: "Author".into(),
            language: "ru".into(),
            description: Some("Desc <b>".into()),
            scope: None,
        }
    }

    fn manifest_chapter(id: &str, volume: f32, chapter: f32, name: &str) -> ManifestChapter {
        ManifestChapter {
            id: id.into(),
            updated: Some("2026-01-01T00:00:00Z".into()),
            volume,
            chapter,
            name: name.into(),
            images: Vec::new(),
        }
    }

    fn read_entry(archive: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str) -> String {
        let mut out = String::new();
        archive
            .by_name(name)
            .expect("entry exists")
            .read_to_string(&mut out)
            .expect("utf-8 entry");
        out
    }

    #[test]
    fn test_characters_xml_cannot_carry_are_dropped() {
        assert_eq!(
            escape_text("a\u{0}b\u{8}c\u{1b}[0m\u{b}\u{c}d\u{ffff}e\tf\ng"),
            "abc[0mde\tf\ng"
        );
        assert_eq!(
            escape_attr("\"q\u{1f}\" & <я 🙂>"),
            "&quot;q&quot; &amp; &lt;я 🙂&gt;"
        );

        // A chapter name and a book title with control characters still give documents
        // an XML parser accepts: nothing it would reject is left in any of them
        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let (doc, _) = render_chapter("en", 1.0, "Na\u{1}me", &["Te\u{2}xt".to_string()], PREFIX);
        writer.add_chapter("c1", &doc).expect("chapter");
        let meta = EpubMeta {
            title: "Ti\u{3}tle".into(),
            author: "Au\u{4}thor".into(),
            description: Some("De\u{5}sc".into()),
            ..meta()
        };
        let chapters = vec![manifest_chapter("c1", 1.0, 1.0, "Na\u{1}me")];
        let (cursor, _) = writer.finish(&meta, &chapters).expect("finish");
        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        for (entry, expected) in [
            ("OEBPS/nav.xhtml", "Name"),
            ("OEBPS/content.opf", "<dc:title>Title</dc:title>"),
            ("OEBPS/content.opf", "Author"),
            ("OEBPS/content.opf", "Desc"),
            (chapter_entry_name("c1").as_str(), "Text"),
        ] {
            let text = read_entry(&mut archive, entry);
            assert!(text.contains(expected), "{entry}: {expected}");
            assert!(text.chars().all(is_xml_char), "{entry}");
        }
    }

    #[test]
    fn test_paragraph_images_and_escaping() {
        let mut used = Vec::new();
        let html = paragraph_to_xhtml(
            "Intro <tag> ![pic](/api/books/b1/images/a1.png) tail\nline2 <img src=\"https://x/y.jpg\" alt=\"ext\">",
            PREFIX,
            &mut used,
        );
        assert!(html.contains("<p>Intro &lt;tag&gt;</p>"));
        assert!(html.contains("<figure><img src=\"images/a1.png\" alt=\"pic\"/></figure>"));
        assert!(html.contains("<p>tail<br/>line2</p>"));
        assert!(html.contains("<p><em>ext</em></p>"));
        assert_eq!(used, vec!["a1.png".to_string()]);
    }

    #[test]
    fn test_local_image_name_rules() {
        assert_eq!(
            local_image_name("/api/books/b1/images/a.png?v=2", PREFIX).as_deref(),
            Some("a.png")
        );
        assert_eq!(
            local_image_name("https://folio.example/api/books/b1/images/a.png", PREFIX).as_deref(),
            Some("a.png")
        );
        assert_eq!(
            local_image_name("/api/books/b1/images/../x.png", PREFIX),
            None
        );
        assert_eq!(
            local_image_name("/api/books/b1/images/a/b.png", PREFIX),
            None
        );
        assert_eq!(local_image_name("/api/books/b2/images/a.png", PREFIX), None);
        assert_eq!(local_image_name("https://x/y.jpg", PREFIX), None);
    }

    #[test]
    fn test_render_chapter_heading_and_empty_body() {
        let (doc, images) = render_chapter("ru", 3.0, "  ", &[], PREFIX);
        assert!(doc.contains("<h2>Глава 3</h2>"));
        assert!(doc.contains("<p></p>"));
        assert!(images.is_empty());

        let (doc, _) = render_chapter("en", 1.5, "A & B", &["text".to_string()], PREFIX);
        assert!(doc.contains("<h2>A &amp; B</h2>"));
        assert!(doc.contains("<p>text</p>"));
        assert!(doc.contains("xml:lang=\"en\""));
    }

    #[test]
    fn test_chapter_label() {
        assert_eq!(chapter_label("en", 2.0, ""), "Chapter 2");
        assert_eq!(chapter_label("en", 2.0, "2. Name"), "2. Name");
        assert_eq!(chapter_label("en", 2.5, "Name"), "2.5. Name");
    }

    #[test]
    fn test_build_epub_structure() {
        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let (doc1, images1) = render_chapter(
            "ru",
            1.0,
            "First",
            &[
                "![i](/api/books/b1/images/x.jpg)".to_string(),
                "a & b".to_string(),
            ],
            PREFIX,
        );
        let (doc2, _) = render_chapter("ru", 2.0, "Second", &["b".to_string()], PREFIX);
        // Documents may arrive in any order; the reading order comes from `finish`.
        writer.add_chapter("c2", &doc2).expect("chapter 2");
        writer.add_chapter("c1", &doc1).expect("chapter 1");
        writer
            .add_image("x.jpg", &[0xFF, 0xD8, 0xFF])
            .expect("image");
        writer
            .set_cover(&[0x89, b'P', b'N', b'G', 1])
            .expect("cover");

        let mut first = manifest_chapter("c1", 1.0, 1.0, "First");
        first.images = images1;
        let chapters = vec![first, manifest_chapter("c2", 1.0, 2.0, "Second")];
        let (cursor, manifest) = writer.finish(&meta(), &chapters).expect("finish");
        assert_eq!(manifest.cover.as_deref(), Some("cover.png"));

        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        {
            let first = archive.by_index(0).expect("first entry");
            assert_eq!(first.name().expect("name"), "mimetype");
            assert_eq!(first.compression(), CompressionMethod::Stored);
        }

        let opf = read_entry(&mut archive, "OEBPS/content.opf");
        assert!(opf.contains("<dc:title>Test &amp; Title</dc:title>"));
        assert!(opf.contains("<dc:identifier id=\"pub-id\">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>"));
        assert!(
            opf.contains("href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\"")
        );
        assert!(opf.contains("href=\"images/x.jpg\" media-type=\"image/jpeg\""));
        // Reading order follows `chapters`, itemrefs carry no ids
        let c1 = opf.find("<itemref idref=\"ch-c1\"/>").expect("c1 in spine");
        let c2 = opf.find("<itemref idref=\"ch-c2\"/>").expect("c2 in spine");
        assert!(c1 < c2);
        // metadata, manifest, spine order keeps CFIs positional
        let metadata_pos = opf.find("<metadata").expect("metadata");
        let manifest_pos = opf.find("<manifest>").expect("manifest");
        let spine_pos = opf.find("<spine>").expect("spine");
        assert!(metadata_pos < manifest_pos && manifest_pos < spine_pos);

        let nav = read_entry(&mut archive, "OEBPS/nav.xhtml");
        assert!(nav.contains("<a href=\"ch-c1.xhtml\">1. First</a>"));
        assert!(!nav.contains("Том"));

        let ch1 = read_entry(&mut archive, "OEBPS/ch-c1.xhtml");
        assert!(ch1.contains("<h2>First</h2>"));
        assert!(ch1.contains("a &amp; b"));
        assert!(ch1.contains("<img src=\"images/x.jpg\""));

        let existing = read_existing(&mut archive).expect("manifest is readable");
        assert_eq!(existing.manifest, manifest);
        assert_eq!(
            existing.manifest.chapters[0].images,
            vec!["x.jpg".to_string()]
        );
        assert!(existing.has_image("x.jpg"));
        assert_eq!(existing.cover(), Some("cover.png"));
    }

    #[test]
    fn test_nav_groups_by_volume() {
        let chapters = vec![
            manifest_chapter("a", 1.0, 1.0, "One"),
            manifest_chapter("b", 2.0, 1.0, ""),
        ];
        let nav = build_nav("ru", "T", &chapters);
        assert!(nav.contains("<a href=\"ch-a.xhtml\">Том 1</a>"));
        assert!(nav.contains("<a href=\"ch-b.xhtml\">Том 2</a>"));
        assert!(nav.contains("<li><a href=\"ch-b.xhtml\">Глава 1</a></li>"));
    }

    #[test]
    fn test_volume_copy_metadata() {
        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let (doc, _) = render_chapter("ru", 7.0, "Seventh", &["text".to_string()], PREFIX);
        writer.add_chapter("c7", &doc).expect("chapter");
        let mut meta = meta();
        meta.scope = Some(VolumeScope {
            volume: 3.0,
            chapters_before: 40,
            book_chapters: 100,
        });
        let chapters = vec![manifest_chapter("c7", 3.0, 7.0, "Seventh")];
        let (cursor, manifest) = writer.finish(&meta, &chapters).expect("finish");
        assert_eq!(manifest.volume, Some(3.0));
        assert_eq!(manifest.chapters_before, Some(40));
        assert_eq!(manifest.book_chapters, Some(100));

        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        let opf = read_entry(&mut archive, "OEBPS/content.opf");
        assert!(opf.contains("<dc:title>Test &amp; Title — Том 3</dc:title>"));
        assert!(opf.contains(
            "<dc:identifier id=\"pub-id\">urn:folio:00000000-0000-0000-0000-000000000001:volume:3</dc:identifier>"
        ));
        assert!(opf.contains("<meta name=\"calibre:series\" content=\"Test &amp; Title\"/>"));
        assert!(opf.contains("<meta name=\"calibre:series_index\" content=\"3\"/>"));
        assert!(opf.contains(
            "<meta property=\"belongs-to-collection\" id=\"series\">Test &amp; Title</meta>"
        ));
        assert!(
            opf.contains("<meta refines=\"#series\" property=\"collection-type\">series</meta>")
        );
        assert!(opf.contains("<meta refines=\"#series\" property=\"group-position\">3</meta>"));
        // Series metadata stays inside `metadata`, the spine is still the third child
        assert!(opf.find("calibre:series").expect("series") < opf.find("<manifest>").expect("m"));

        // One volume: a flat table of contents under the volume title
        let nav = read_entry(&mut archive, "OEBPS/nav.xhtml");
        assert!(nav.contains("<h1>Test &amp; Title — Том 3</h1>"));
        assert!(nav.contains("<li><a href=\"ch-c7.xhtml\">7. Seventh</a></li>"));

        let raw = read_entry(&mut archive, MANIFEST_PATH);
        assert!(raw.contains("\"volume\":3.0"));
        assert!(raw.contains("\"chaptersBefore\":40"));
        assert!(raw.contains("\"bookChapters\":100"));

        let existing = read_existing(&mut archive).expect("manifest");
        assert!(existing.is_copy_of("00000000-0000-0000-0000-000000000001", Some(3.0)));
        assert!(!existing.is_copy_of("00000000-0000-0000-0000-000000000001", None));
        assert!(!existing.is_copy_of("00000000-0000-0000-0000-000000000001", Some(4.0)));
        assert!(!existing.is_copy_of("00000000-0000-0000-0000-000000000002", Some(3.0)));
    }

    #[test]
    fn test_whole_book_manifest_has_no_volume_fields() {
        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let (doc, _) = render_chapter("ru", 1.0, "First", &["text".to_string()], PREFIX);
        writer.add_chapter("c1", &doc).expect("chapter");
        let chapters = vec![manifest_chapter("c1", 1.0, 1.0, "First")];
        let (cursor, _) = writer.finish(&meta(), &chapters).expect("finish");
        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        let raw: serde_json::Value =
            serde_json::from_str(&read_entry(&mut archive, MANIFEST_PATH)).expect("json");
        let fields = raw.as_object().expect("object");
        assert!(!fields.contains_key("volume"));
        assert!(!fields.contains_key("chaptersBefore"));
        assert!(!fields.contains_key("bookChapters"));
        let opf = read_entry(&mut archive, "OEBPS/content.opf");
        assert!(!opf.contains("calibre:series"));
        let existing = read_existing(&mut archive).expect("manifest");
        assert!(existing.is_copy_of("00000000-0000-0000-0000-000000000001", None));
    }

    #[test]
    fn test_volume_names() {
        assert_eq!(volume_title("ru", " Книга ", 3.0), "Книга — Том 3");
        assert_eq!(volume_title("en", "Book", 1.5), "Book — Volume 1.5");
        assert_eq!(volume_file_stem("Book", 3.0), "Book - Vol 03");
        assert_eq!(volume_file_stem("Book", 14.0), "Book - Vol 14");
        assert_eq!(volume_file_stem("Book", 120.0), "Book - Vol 120");
        assert_eq!(volume_file_stem("Book", 3.5), "Book - Vol 03.5");
        assert_eq!(volume_file_stem("Book", 0.0), "Book - Vol 00");
    }

    #[test]
    fn test_update_reuses_unchanged_chapters() {
        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let (doc1, _) = render_chapter("ru", 1.0, "First", &["old text".to_string()], PREFIX);
        writer.add_chapter("c1", &doc1).expect("chapter");
        writer
            .add_image("x.jpg", &[0xFF, 0xD8, 0xFF, 7])
            .expect("image");
        writer.set_cover(&[0xFF, 0xD8, 0xFF, 1]).expect("cover");
        let mut first = manifest_chapter("c1", 1.0, 1.0, "First");
        first.images = vec!["x.jpg".to_string()];
        let (cursor, _) = writer.finish(&meta(), &[first.clone()]).expect("finish");

        let mut old = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("old archive");
        let existing = read_existing(&mut old).expect("existing");
        let updated = first.updated.as_deref();
        assert!(
            existing
                .reusable_chapter("ru", "c1", updated, 1.0, 1.0, "First")
                .is_some()
        );
        // Any change on the server invalidates the stored document
        assert!(
            existing
                .reusable_chapter("ru", "c1", Some("2026-02-02T00:00:00Z"), 1.0, 1.0, "First")
                .is_none()
        );
        assert!(
            existing
                .reusable_chapter("ru", "c1", updated, 1.0, 1.0, "Renamed")
                .is_none()
        );
        assert!(
            existing
                .reusable_chapter("en", "c1", updated, 1.0, 1.0, "First")
                .is_none()
        );
        assert!(
            existing
                .reusable_chapter("ru", "c9", updated, 1.0, 1.0, "First")
                .is_none()
        );

        let mut writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        writer.copy_chapter(&mut old, "c1").expect("copy chapter");
        writer.copy_image(&mut old, "x.jpg").expect("copy image");
        writer
            .copy_cover(&mut old, "cover.jpg")
            .expect("copy cover");
        let (doc2, _) = render_chapter("ru", 2.0, "Second", &["new".to_string()], PREFIX);
        writer.add_chapter("c2", &doc2).expect("new chapter");
        let chapters = vec![first, manifest_chapter("c2", 1.0, 2.0, "Second")];
        let (cursor, _) = writer.finish(&meta(), &chapters).expect("finish update");

        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        assert!(read_entry(&mut archive, "OEBPS/ch-c1.xhtml").contains("old text"));
        assert!(read_entry(&mut archive, "OEBPS/ch-c2.xhtml").contains("new"));
        let mut image = Vec::new();
        archive
            .by_name("OEBPS/images/x.jpg")
            .expect("image copied")
            .read_to_end(&mut image)
            .expect("image bytes");
        assert_eq!(image, vec![0xFF, 0xD8, 0xFF, 7]);
        let opf = read_entry(&mut archive, "OEBPS/content.opf");
        assert!(opf.contains("href=\"cover.jpg\""));
        assert!(opf.contains("href=\"images/x.jpg\""));
    }

    #[test]
    fn test_finish_requires_chapters() {
        let writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        assert!(writer.finish(&meta(), &[]).is_err());

        let writer = EpubWriter::new(Cursor::new(Vec::new())).expect("writer");
        let chapters = vec![manifest_chapter("missing", 1.0, 1.0, "x")];
        assert!(writer.finish(&meta(), &chapters).is_err());
    }

    #[test]
    fn test_foreign_epub_has_no_manifest() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("mimetype", SimpleFileOptions::default())
            .expect("start");
        zip.write_all(b"application/epub+zip").expect("write");
        let cursor = zip.finish().expect("finish");
        let mut archive = ZipArchive::new(Cursor::new(cursor.into_inner())).expect("archive");
        assert!(read_existing(&mut archive).is_none());
    }

    #[test]
    fn test_cfi_helpers() {
        assert_eq!(cfi_spine_index("epubcfi(/6/2!/4/2/1:0)"), Some(0));
        assert_eq!(cfi_spine_index("epubcfi(/6/14!/4/2,/1:0,/1:5)"), Some(6));
        assert_eq!(cfi_spine_index("epubcfi(/6/8)"), Some(3));
        assert_eq!(cfi_spine_index("epubcfi(/6/8[id]!/4)"), Some(3));
        assert_eq!(cfi_spine_index("epubcfi(/6/7!/4)"), None);
        assert_eq!(cfi_spine_index("epubcfi(/6/0!/4)"), None);
        assert_eq!(cfi_spine_index("ch:abc"), None);
        assert_eq!(cfi_spine_index(""), None);

        assert_eq!(chapter_start_cfi(0), "epubcfi(/6/2!/4)");
        assert_eq!(cfi_spine_index(&chapter_start_cfi(41)), Some(41));

        let moved = HashMap::from([(1usize, 2usize), (5, 5)]);
        assert_eq!(
            remap_cfi_spine("epubcfi(/6/4!/4/2,/1:0,/1:5)", &moved).as_deref(),
            Some("epubcfi(/6/6!/4/2,/1:0,/1:5)")
        );
        assert_eq!(remap_cfi_spine("epubcfi(/6/12!/4)", &moved), None);
        assert_eq!(remap_cfi_spine("epubcfi(/6/2!/4)", &moved), None);
        assert_eq!(remap_cfi_spine("not a cfi", &moved), None);

        assert_eq!(
            shift_cfi_spine("epubcfi(/6/4!/4/2,/1:0,/1:5)", 40).as_deref(),
            Some("epubcfi(/6/84!/4/2,/1:0,/1:5)")
        );
        assert_eq!(
            shift_cfi_spine("epubcfi(/6/84!/4/2/1:3)", -40).as_deref(),
            Some("epubcfi(/6/4!/4/2/1:3)")
        );
        assert_eq!(
            shift_cfi_spine("epubcfi(/6/2!/4)", 0).as_deref(),
            Some("epubcfi(/6/2!/4)")
        );
        assert_eq!(shift_cfi_spine("epubcfi(/6/4!/4)", -2), None);
        assert_eq!(shift_cfi_spine("ch:abc", 3), None);
    }

    #[test]
    fn test_volume_copy_percentages() {
        // A volume of 50 chapters that starts 100 chapters into a book of 200
        assert_eq!(copy_to_book_percent(0.0, 100, 50, 200), 50.0);
        assert_eq!(copy_to_book_percent(50.0, 100, 50, 200), 62.5);
        assert_eq!(copy_to_book_percent(100.0, 100, 50, 200), 75.0);
        assert_eq!(book_to_copy_percent(62.5, 100, 50, 200), 50.0);
        // Positions outside the copy clamp to its ends
        assert_eq!(book_to_copy_percent(10.0, 100, 50, 200), 0.0);
        assert_eq!(book_to_copy_percent(90.0, 100, 50, 200), 100.0);
        // The last volume ends the book
        assert_eq!(copy_to_book_percent(100.0, 150, 50, 200), 100.0);
        // The book grew after the copy was built: its own chapters still count
        assert_eq!(copy_to_book_percent(100.0, 150, 60, 200), 100.0);
        // Nothing known about the book: the value passes through
        assert_eq!(copy_to_book_percent(40.0, 0, 0, 0), 40.0);
        assert_eq!(book_to_copy_percent(40.0, 10, 0, 0), 40.0);
    }

    #[test]
    fn test_normalize_language() {
        assert_eq!(normalize_language(Some(" ru ")), "ru");
        assert_eq!(normalize_language(Some("zh-Hans")), "zh-Hans");
        assert_eq!(normalize_language(Some("")), "en");
        assert_eq!(normalize_language(Some("\"><x")), "en");
        assert_eq!(normalize_language(None), "en");
    }
}
