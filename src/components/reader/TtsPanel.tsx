import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, Minus, Pause, Play, Plus, Square, Trash2, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Select } from '../common/Select';
import { ttsService } from '../../services/ttsService';
import type { ReaderSettings } from '../../types/reader';
import type { TtsLang, TtsPlaybackState, TtsVoice } from '../../types/tts';

export const TTS_MIN_SPEED = 0.5;
export const TTS_MAX_SPEED = 2;
const SPEED_STEP = 0.1;

const NO_VOICE = '';

const voiceSettingKey = (lang: TtsLang): 'ttsVoiceRu' | 'ttsVoiceEn' =>
  lang === 'ru' ? 'ttsVoiceRu' : 'ttsVoiceEn';

const formatMegabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Download state of one voice: percent while downloading, null while unpacking */
type VoiceDownload = { percent: number | null };

interface TtsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  playbackState: TtsPlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
}

/** Read-aloud controls of the reader: playback, speed, and the voices to download. */
export const TtsPanel: React.FC<TtsPanelProps> = ({
  isOpen,
  onClose,
  triggerRef,
  playbackState,
  onPlay,
  onPause,
  onResume,
  onStop,
  settings,
  onUpdateSettings,
}) => {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [downloads, setDownloads] = useState<Record<string, VoiceDownload>>({});
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshVoices = useCallback(async () => {
    try {
      setVoices(await ttsService.listVoices());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (isOpen) void refreshVoices();
  }, [isOpen, refreshVoices]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!triggerRef?.current || !triggerRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, onClose, triggerRef]);

  const handleDownload = async (voice: TtsVoice) => {
    setError(null);
    setDownloads((prev) => ({ ...prev, [voice.id]: { percent: 0 } }));
    try {
      await ttsService.downloadVoice(voice.id, (progress) => {
        const percent =
          progress.stage === 'download'
            ? Math.min(100, Math.floor((progress.received / (progress.total || voice.archiveBytes)) * 100))
            : null;
        setDownloads((prev) => ({ ...prev, [voice.id]: { percent } }));
      });
      const key = voiceSettingKey(voice.lang);
      if (!settingsRef.current[key]) onUpdateSettings({ [key]: voice.id });
    } catch (err) {
      setError(t('tts.voiceDownloadFailed', { error: String(err) }));
    } finally {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[voice.id];
        return next;
      });
      await refreshVoices();
    }
  };

  const handleDelete = async (voice: TtsVoice) => {
    setError(null);
    try {
      const key = voiceSettingKey(voice.lang);
      if (settingsRef.current[key] === voice.id) {
        if (playbackState !== 'idle') onStop();
        const other = voices.find((v) => v.lang === voice.lang && v.installed && v.id !== voice.id);
        onUpdateSettings({ [key]: other?.id });
      }
      await ttsService.deleteVoice(voice.id);
    } catch (err) {
      setError(String(err));
    } finally {
      await refreshVoices();
    }
  };

  if (!isOpen) return null;

  const speed = settings.ttsSpeed ?? 1;
  const setSpeed = (value: number) => {
    const rounded = Math.round(value * 10) / 10;
    onUpdateSettings({ ttsSpeed: Math.min(TTS_MAX_SPEED, Math.max(TTS_MIN_SPEED, rounded)) });
  };
  const hasVoice = voices.some((v) => v.installed);

  const voiceSelect = (lang: TtsLang, label: string) => {
    const installed = voices.filter((v) => v.lang === lang && v.installed);
    const key = voiceSettingKey(lang);
    const selected = installed.some((v) => v.id === settings[key]) ? settings[key]! : NO_VOICE;
    return (
      <div className="settings-section">
        <label className="settings-label">{label}</label>
        <Select<string>
          value={selected}
          onChange={(val) => onUpdateSettings({ [key]: val || undefined })}
          disabled={installed.length === 0}
          options={[
            { value: NO_VOICE, label: t('tts.notSelected') },
            ...installed.map((v) => ({ value: v.id, label: v.name })),
          ]}
          aria-label={label}
        />
      </div>
    );
  };

  return (
    <>
      <div className="settings-popover-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="settings-popover tts-popover"
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('tts.readAloud')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="settings-header-bar">
          <div className="settings-drag-handle" />
          <div className="settings-header-title-row">
            <h3 className="settings-title">{t('tts.readAloud')}</h3>
            <button
              type="button"
              className="settings-close-btn"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Playback */}
        <div className="tts-controls">
          {playbackState === 'idle' ? (
            <button type="button" className="tts-primary-btn" onClick={onPlay} disabled={!hasVoice}>
              <Play size={16} />
              <span>{t('tts.play')}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                className="tts-primary-btn"
                onClick={playbackState === 'paused' ? onResume : onPause}
              >
                {playbackState === 'loading' ? (
                  <Loader2 size={16} className="spinner" />
                ) : playbackState === 'paused' ? (
                  <Play size={16} />
                ) : (
                  <Pause size={16} />
                )}
                <span>
                  {playbackState === 'loading'
                    ? t('tts.loading')
                    : playbackState === 'paused'
                      ? t('tts.resume')
                      : t('tts.pause')}
                </span>
              </button>
              <button
                type="button"
                className="tts-icon-btn"
                onClick={onStop}
                title={t('tts.stop')}
                aria-label={t('tts.stop')}
              >
                <Square size={16} />
              </button>
            </>
          )}
        </div>
        {!hasVoice && voices.length > 0 && <p className="tts-hint">{t('tts.noVoice')}</p>}

        {/* Speed */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">{t('tts.speed')}</label>
            <span className="settings-val-text">{speed.toFixed(1)}×</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => setSpeed(speed - SPEED_STEP)}
              aria-label={t('tts.speed')}
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min={TTS_MIN_SPEED}
              max={TTS_MAX_SPEED}
              step={SPEED_STEP}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="settings-slider"
              aria-label={t('tts.speed')}
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => setSpeed(speed + SPEED_STEP)}
              aria-label={t('tts.speed')}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {voiceSelect('ru', t('tts.voiceRu'))}
        {voiceSelect('en', t('tts.voiceEn'))}

        {/* Voices to download */}
        <div className="settings-section">
          <label className="settings-label">{t('tts.voices')}</label>
          <p className="tts-hint">{t('tts.voicesHint')}</p>
          {error && <p className="tts-error">{error}</p>}
          <ul className="tts-voice-list">
            {voices.map((voice) => {
              const download = downloads[voice.id];
              return (
                <li key={voice.id} className="tts-voice-item">
                  <div className="tts-voice-info">
                    <span className="tts-voice-name">{voice.name}</span>
                    <span className="tts-voice-meta">
                      {voice.lang === 'ru' ? t('tts.langRu') : t('tts.langEn')} ·{' '}
                      {voice.gender === 'female' ? t('tts.female') : t('tts.male')}
                    </span>
                  </div>
                  {download ? (
                    <span className="tts-voice-progress">
                      <Loader2 size={14} className="spinner" />
                      {download.percent === null
                        ? t('tts.installingVoice')
                        : t('tts.downloadingVoice', { percent: download.percent })}
                    </span>
                  ) : voice.installed ? (
                    <button
                      type="button"
                      className="tts-icon-btn"
                      onClick={() => handleDelete(voice)}
                      title={t('tts.deleteVoice')}
                      aria-label={t('tts.deleteVoice')}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : (
                    <button type="button" className="tts-download-btn" onClick={() => handleDownload(voice)}>
                      <Download size={14} />
                      <span>{t('tts.downloadVoice', { size: formatMegabytes(voice.archiveBytes) })}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
};

interface TtsMiniPlayerProps {
  playbackState: TtsPlaybackState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenPanel: () => void;
}

/** Playback controls kept on screen while the book is read aloud and the panel is closed. */
export const TtsMiniPlayer: React.FC<TtsMiniPlayerProps> = ({
  playbackState,
  onPause,
  onResume,
  onStop,
  onOpenPanel,
}) => {
  const { t } = useTranslation();
  if (playbackState === 'idle') return null;
  const paused = playbackState === 'paused';
  return (
    <div
      className="tts-mini-player"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="tts-icon-btn"
        onClick={paused ? onResume : onPause}
        title={paused ? t('tts.resume') : t('tts.pause')}
        aria-label={paused ? t('tts.resume') : t('tts.pause')}
      >
        {playbackState === 'loading' ? (
          <Loader2 size={16} className="spinner" />
        ) : paused ? (
          <Play size={16} />
        ) : (
          <Pause size={16} />
        )}
      </button>
      <button type="button" className="tts-mini-label" onClick={onOpenPanel}>
        {t('tts.readAloud')}
      </button>
      <button
        type="button"
        className="tts-icon-btn"
        onClick={onStop}
        title={t('tts.stop')}
        aria-label={t('tts.stop')}
      >
        <Square size={14} />
      </button>
    </div>
  );
};
