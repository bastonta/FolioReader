/** Language of a text-to-speech voice. */
export type TtsLang = 'ru' | 'en';

/** A Piper voice the core can download and run (`tts_list_voices`). */
export interface TtsVoice {
  id: string;
  lang: TtsLang;
  name: string;
  gender: 'female' | 'male';
  /** Size of the download */
  archiveBytes: number;
  installed: boolean;
}

/** Progress of `tts_download_voice`, sent over its channel. */
export type TtsDownloadProgress =
  | { stage: 'download'; received: number; total: number | null }
  | { stage: 'extract' };

/** Audio returned by `tts_synthesize`: mono samples in [-1, 1]. */
export interface TtsAudio {
  sampleRate: number;
  samples: Float32Array<ArrayBuffer>;
}

export type TtsPlaybackState = 'idle' | 'loading' | 'playing' | 'paused';
