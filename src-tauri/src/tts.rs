//! Offline text-to-speech: Piper voices run by sherpa-onnx.
//!
//! Voices are downloaded on demand from the sherpa-onnx `tts-models` release
//! (`vits-piper-{id}.tar.bz2`) and unpacked into `{base}/tts/voices/{id}/`. Every archive carries
//! its own copy of `espeak-ng-data` (the phonemizer's dictionaries); one copy is kept in
//! `{base}/tts/espeak-ng-data` and shared by all voices. espeak-ng is initialised once per
//! process with the first directory it is given, so that directory must outlive any voice.
//!
//! Synthesis returns raw PCM to the frontend, which plays it with the Web Audio API:
//! `u32` LE sample rate followed by mono `f32` LE samples.

use serde::Serialize;
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const VOICES_BASE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

/// Loaded engines kept in memory: one Russian and one English voice cover a mixed book.
const MAX_LOADED_ENGINES: usize = 2;

const MIN_SPEED: f32 = 0.5;
const MAX_SPEED: f32 = 2.5;

/// A voice the application offers. `id` is the Piper voice name; the archive is
/// `vits-piper-{id}.tar.bz2` and holds `vits-piper-{id}/{id}.onnx`, `tokens.txt` and
/// `espeak-ng-data/`.
struct VoiceSpec {
    id: &'static str,
    lang: &'static str,
    name: &'static str,
    gender: &'static str,
    /// Size of the archive, shown before the download starts.
    archive_bytes: u64,
}

const VOICES: &[VoiceSpec] = &[
    VoiceSpec {
        id: "ru_RU-irina-medium",
        lang: "ru",
        name: "Irina",
        gender: "female",
        archive_bytes: 67_153_308,
    },
    VoiceSpec {
        id: "ru_RU-denis-medium",
        lang: "ru",
        name: "Denis",
        gender: "male",
        archive_bytes: 67_190_991,
    },
    VoiceSpec {
        id: "ru_RU-dmitri-medium",
        lang: "ru",
        name: "Dmitri",
        gender: "male",
        archive_bytes: 67_188_551,
    },
    VoiceSpec {
        id: "ru_RU-ruslan-medium",
        lang: "ru",
        name: "Ruslan",
        gender: "male",
        archive_bytes: 67_210_684,
    },
    VoiceSpec {
        id: "en_US-lessac-medium",
        lang: "en",
        name: "Lessac (US)",
        gender: "female",
        archive_bytes: 67_230_653,
    },
    VoiceSpec {
        id: "en_US-amy-medium",
        lang: "en",
        name: "Amy (US)",
        gender: "female",
        archive_bytes: 67_223_746,
    },
    VoiceSpec {
        id: "en_US-ryan-medium",
        lang: "en",
        name: "Ryan (US)",
        gender: "male",
        archive_bytes: 67_213_100,
    },
    VoiceSpec {
        id: "en_GB-alan-medium",
        lang: "en",
        name: "Alan (UK)",
        gender: "male",
        archive_bytes: 67_220_121,
    },
];

fn find_voice(voice_id: &str) -> Result<&'static VoiceSpec, String> {
    VOICES
        .iter()
        .find(|v| v.id == voice_id)
        .ok_or_else(|| format!("Unknown voice '{voice_id}'"))
}

struct Engine {
    voice_id: String,
    tts: OfflineTts,
    /// One synthesis at a time per engine.
    busy: std::sync::Mutex<()>,
}

#[derive(Default)]
pub struct TtsState {
    /// Most recently used first.
    engines: Mutex<Vec<Arc<Engine>>>,
    downloads: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub id: String,
    pub lang: String,
    pub name: String,
    pub gender: String,
    pub archive_bytes: u64,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "stage")]
pub enum TtsDownloadProgress {
    Download { received: u64, total: Option<u64> },
    Extract,
}

fn tts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::get_app_base_dir(app)?.join("tts"))
}

fn voices_dir(tts_dir: &Path) -> PathBuf {
    tts_dir.join("voices")
}

fn shared_espeak_dir(tts_dir: &Path) -> PathBuf {
    tts_dir.join("espeak-ng-data")
}

fn voice_dir(tts_dir: &Path, voice_id: &str) -> PathBuf {
    voices_dir(tts_dir).join(voice_id)
}

fn model_path(voice_dir: &Path, voice_id: &str) -> PathBuf {
    voice_dir.join(format!("{voice_id}.onnx"))
}

fn is_installed(tts_dir: &Path, voice_id: &str) -> bool {
    let dir = voice_dir(tts_dir, voice_id);
    model_path(&dir, voice_id).is_file()
        && dir.join("tokens.txt").is_file()
        && shared_espeak_dir(tts_dir).is_dir()
}

#[tauri::command]
pub async fn tts_list_voices(app: tauri::AppHandle) -> Result<Vec<TtsVoice>, String> {
    let dir = tts_dir(&app)?;
    Ok(VOICES
        .iter()
        .map(|v| TtsVoice {
            id: v.id.to_string(),
            lang: v.lang.to_string(),
            name: v.name.to_string(),
            gender: v.gender.to_string(),
            archive_bytes: v.archive_bytes,
            installed: is_installed(&dir, v.id),
        })
        .collect())
}

#[tauri::command]
pub async fn tts_download_voice(
    app: tauri::AppHandle,
    state: tauri::State<'_, TtsState>,
    voice_id: String,
    on_progress: Channel<TtsDownloadProgress>,
) -> Result<(), String> {
    let spec = find_voice(&voice_id)?;
    let dir = tts_dir(&app)?;

    if !state.downloads.lock().await.insert(voice_id.clone()) {
        return Err(format!("Voice '{voice_id}' is already being downloaded"));
    }
    let result = download_and_install(&dir, spec, &on_progress).await;
    state.downloads.lock().await.remove(&voice_id);
    result
}

async fn download_and_install(
    tts_dir: &Path,
    spec: &VoiceSpec,
    on_progress: &Channel<TtsDownloadProgress>,
) -> Result<(), String> {
    let voices = voices_dir(tts_dir);
    tokio::fs::create_dir_all(&voices)
        .await
        .map_err(|e| format!("Failed to create '{}': {e}", voices.display()))?;

    let tag = uuid::Uuid::now_v7();
    let archive_path = voices.join(format!(".{}.tar.bz2.part-{tag}", spec.id));
    let extract_dir = voices.join(format!(".{}.extract-{tag}", spec.id));

    let result = async {
        download_archive(spec, &archive_path, on_progress).await?;
        let _ = on_progress.send(TtsDownloadProgress::Extract);

        let archive = archive_path.clone();
        let extract = extract_dir.clone();
        let tts_dir = tts_dir.to_path_buf();
        let voice_id = spec.id.to_string();
        tokio::task::spawn_blocking(move || {
            install_archive(&archive, &extract, &tts_dir, &voice_id)
        })
        .await
        .map_err(|e| format!("Voice installation task failed: {e}"))?
    }
    .await;

    let _ = tokio::fs::remove_file(&archive_path).await;
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;
    result
}

async fn download_archive(
    spec: &VoiceSpec,
    archive_path: &Path,
    on_progress: &Channel<TtsDownloadProgress>,
) -> Result<(), String> {
    let url = format!("{VOICES_BASE_URL}/vits-piper-{}.tar.bz2", spec.id);
    let client = crate::fs_manager::download_client()?;
    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Voice download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Server returned status {} when downloading the voice",
            response.status()
        ));
    }

    let total = response.content_length().or(Some(spec.archive_bytes));
    let mut file = tokio::fs::File::create(archive_path)
        .await
        .map_err(|e| format!("Failed to create '{}': {e}", archive_path.display()))?;

    let mut received: u64 = 0;
    let mut reported: u64 = 0;
    let _ = on_progress.send(TtsDownloadProgress::Download { received, total });
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Voice download interrupted: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write the voice archive: {e}"))?;
        received += chunk.len() as u64;
        if received - reported >= 512 * 1024 {
            reported = received;
            let _ = on_progress.send(TtsDownloadProgress::Download { received, total });
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to write the voice archive: {e}"))?;
    let _ = on_progress.send(TtsDownloadProgress::Download { received, total });
    Ok(())
}

/// Unpacks the archive, checks it holds the voice, moves `espeak-ng-data` to the shared place
/// (or drops it if that exists already) and puts the voice into `voices/{id}`.
fn install_archive(
    archive_path: &Path,
    extract_dir: &Path,
    tts_dir: &Path,
    voice_id: &str,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path)
        .map_err(|e| format!("Failed to open the voice archive: {e}"))?;
    std::fs::create_dir_all(extract_dir)
        .map_err(|e| format!("Failed to create '{}': {e}", extract_dir.display()))?;
    // `unpack` refuses entries that would land outside `extract_dir`.
    tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(file)))
        .unpack(extract_dir)
        .map_err(|e| format!("Failed to unpack the voice archive: {e}"))?;

    let unpacked = extract_dir.join(format!("vits-piper-{voice_id}"));
    if !model_path(&unpacked, voice_id).is_file() || !unpacked.join("tokens.txt").is_file() {
        return Err("The voice archive does not contain the model".to_string());
    }

    let espeak = unpacked.join("espeak-ng-data");
    let shared = shared_espeak_dir(tts_dir);
    if !shared.is_dir() {
        if !espeak.is_dir() {
            return Err("The voice archive does not contain espeak-ng-data".to_string());
        }
        std::fs::rename(&espeak, &shared)
            .map_err(|e| format!("Failed to install espeak-ng-data: {e}"))?;
    } else if espeak.exists() {
        std::fs::remove_dir_all(&espeak)
            .map_err(|e| format!("Failed to remove the extra espeak-ng-data: {e}"))?;
    }

    let target = voice_dir(tts_dir, voice_id);
    if target.exists() {
        std::fs::remove_dir_all(&target)
            .map_err(|e| format!("Failed to replace '{}': {e}", target.display()))?;
    }
    std::fs::rename(&unpacked, &target).map_err(|e| format!("Failed to install the voice: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn tts_delete_voice(
    app: tauri::AppHandle,
    state: tauri::State<'_, TtsState>,
    voice_id: String,
) -> Result<(), String> {
    find_voice(&voice_id)?;
    state
        .engines
        .lock()
        .await
        .retain(|engine| engine.voice_id != voice_id);
    let dir = voice_dir(&tts_dir(&app)?, &voice_id);
    if dir.exists() {
        tokio::fs::remove_dir_all(&dir)
            .await
            .map_err(|e| format!("Failed to delete the voice: {e}"))?;
    }
    Ok(())
}

fn engine_threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(2, |n| n.get());
    let limit = if cfg!(target_os = "android") { 2 } else { 4 };
    cores.clamp(1, limit) as i32
}

fn create_engine(tts_dir: &Path, voice_id: &str) -> Result<Engine, String> {
    let dir = voice_dir(tts_dir, voice_id);
    let path = |p: PathBuf| p.to_string_lossy().into_owned();
    let config = OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            vits: OfflineTtsVitsModelConfig {
                model: Some(path(model_path(&dir, voice_id))),
                tokens: Some(path(dir.join("tokens.txt"))),
                data_dir: Some(path(shared_espeak_dir(tts_dir))),
                ..Default::default()
            },
            num_threads: engine_threads(),
            ..Default::default()
        },
        max_num_sentences: 1,
        ..Default::default()
    };
    let tts = OfflineTts::create(&config)
        .ok_or_else(|| format!("Failed to load the voice '{voice_id}'"))?;
    Ok(Engine {
        voice_id: voice_id.to_string(),
        tts,
        busy: std::sync::Mutex::new(()),
    })
}

async fn get_engine(
    state: &TtsState,
    tts_dir: &Path,
    voice_id: &str,
) -> Result<Arc<Engine>, String> {
    // Held while a voice loads so that the same voice is never loaded twice.
    let mut engines = state.engines.lock().await;
    if let Some(pos) = engines.iter().position(|e| e.voice_id == voice_id) {
        let engine = engines.remove(pos);
        engines.insert(0, engine.clone());
        return Ok(engine);
    }

    if !is_installed(tts_dir, voice_id) {
        return Err(format!("Voice '{voice_id}' is not installed"));
    }
    let dir = tts_dir.to_path_buf();
    let id = voice_id.to_string();
    let engine = Arc::new(
        tokio::task::spawn_blocking(move || create_engine(&dir, &id))
            .await
            .map_err(|e| format!("Voice loading task failed: {e}"))??,
    );
    engines.insert(0, engine.clone());
    engines.truncate(MAX_LOADED_ENGINES);
    Ok(engine)
}

/// Text the engine is given: the C API takes a NUL-terminated string, so an interior NUL
/// would cut the text (and the wrapper panics on it).
fn clean_text(text: &str) -> String {
    text.replace('\0', " ").trim().to_string()
}

fn encode_pcm(sample_rate: i32, samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + samples.len() * 4);
    out.extend_from_slice(&(sample_rate.max(0) as u32).to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

fn synthesize_blocking(engine: &Engine, text: &str, speed: f32) -> Result<Vec<u8>, String> {
    let _guard = engine
        .busy
        .lock()
        .map_err(|_| "The voice engine is unavailable".to_string())?;
    let config = GenerationConfig {
        speed,
        ..Default::default()
    };
    let audio = engine
        .tts
        .generate_with_config(text, &config, None::<fn(&[f32], f32) -> bool>)
        .ok_or_else(|| "Speech synthesis failed".to_string())?;
    Ok(encode_pcm(audio.sample_rate(), audio.samples()))
}

/// Synthesizes `text` with an installed voice. Returns `u32` LE sample rate + `f32` LE samples.
#[tauri::command]
pub async fn tts_synthesize(
    app: tauri::AppHandle,
    state: tauri::State<'_, TtsState>,
    voice_id: String,
    text: String,
    speed: Option<f32>,
) -> Result<Response, String> {
    find_voice(&voice_id)?;
    let text = clean_text(&text);
    let engine = get_engine(&state, &tts_dir(&app)?, &voice_id).await?;
    if text.is_empty() {
        return Ok(Response::new(encode_pcm(engine.tts.sample_rate(), &[])));
    }
    let speed = speed.unwrap_or(1.0);
    let speed = if speed.is_finite() {
        speed.clamp(MIN_SPEED, MAX_SPEED)
    } else {
        1.0
    };
    let bytes = tokio::task::spawn_blocking(move || synthesize_blocking(&engine, &text, speed))
        .await
        .map_err(|e| format!("Speech synthesis task failed: {e}"))??;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_ids_are_unique_and_languages_known() {
        let mut ids = HashSet::new();
        for v in VOICES {
            assert!(ids.insert(v.id), "duplicate voice {}", v.id);
            assert!(
                matches!(v.lang, "ru" | "en"),
                "unexpected language {}",
                v.lang
            );
            assert!(v.id.starts_with(if v.lang == "ru" { "ru_RU-" } else { "en_" }));
        }
    }

    #[test]
    fn clean_text_strips_nul_and_whitespace() {
        assert_eq!(clean_text("  a\0b \n"), "a b");
    }

    #[test]
    fn pcm_layout() {
        let bytes = encode_pcm(22050, &[0.5, -1.0]);
        assert_eq!(&bytes[..4], &22050u32.to_le_bytes());
        assert_eq!(&bytes[4..8], &0.5f32.to_le_bytes());
        assert_eq!(&bytes[8..12], &(-1.0f32).to_le_bytes());
    }

    /// Runs the real engine with a voice unpacked in the sherpa-onnx layout.
    /// `FOLIO_TTS_TEST_VOICE_DIR=/path/to/vits-piper-ru_RU-irina-medium cargo test -- --ignored`
    #[test]
    #[ignore]
    fn synthesizes_with_a_real_voice() {
        let src = PathBuf::from(
            std::env::var("FOLIO_TTS_TEST_VOICE_DIR").expect("FOLIO_TTS_TEST_VOICE_DIR"),
        );
        let voice_id = src
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix("vits-piper-"))
            .expect("directory named vits-piper-{id}")
            .to_string();
        let tmp = std::env::temp_dir().join(format!("folio-tts-test-{}", uuid::Uuid::now_v7()));
        let voice = voice_dir(&tmp, &voice_id);
        std::fs::create_dir_all(&voice).unwrap();
        for f in [format!("{voice_id}.onnx"), "tokens.txt".to_string()] {
            std::fs::copy(src.join(&f), voice.join(&f)).unwrap();
        }
        copy_dir(&src.join("espeak-ng-data"), &shared_espeak_dir(&tmp));

        let engine = create_engine(&tmp, &voice_id).expect("engine");
        let text = std::env::var("FOLIO_TTS_TEST_TEXT")
            .unwrap_or_else(|_| "Привет! Это проверка синтеза речи.".to_string());
        let bytes = synthesize_blocking(&engine, &text, 1.0).expect("audio");
        let rate = u32::from_le_bytes(bytes[..4].try_into().unwrap());
        let samples = (bytes.len() - 4) / 4;
        assert!(rate > 8000);
        assert!(
            samples > rate as usize / 2,
            "less than half a second of audio"
        );
        if let Ok(out) = std::env::var("FOLIO_TTS_TEST_WAV") {
            let pcm: Vec<f32> = bytes[4..]
                .as_chunks::<4>()
                .0
                .iter()
                .map(|c| f32::from_le_bytes(*c))
                .collect();
            sherpa_onnx::write(&out, &pcm, rate as i32);
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn copy_dir(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_dir(&entry.path(), &target);
            } else {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }
}
