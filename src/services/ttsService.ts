import { Channel, invoke } from '@tauri-apps/api/core';
import type { TtsAudio, TtsDownloadProgress, TtsVoice } from '../types/tts';

/** Decodes `tts_synthesize` output: `u32` LE sample rate, then mono `f32` LE samples. */
const decodePcm = (buffer: ArrayBuffer): TtsAudio => {
  if (buffer.byteLength < 4) throw new Error('Speech synthesis returned no audio');
  const sampleRate = new DataView(buffer).getUint32(0, true);
  const count = Math.floor((buffer.byteLength - 4) / 4);
  // Copy: the samples start at byte 4, which a Float32Array view of the buffer would
  // need to be aligned to anyway, and the copy is cheap next to synthesis.
  const samples = new Float32Array(count);
  const view = new DataView(buffer, 4);
  for (let i = 0; i < count; i++) samples[i] = view.getFloat32(i * 4, true);
  return { sampleRate, samples };
};

export const ttsService = {
  listVoices(): Promise<TtsVoice[]> {
    return invoke<TtsVoice[]>('tts_list_voices');
  },

  async downloadVoice(voiceId: string, onProgress?: (p: TtsDownloadProgress) => void): Promise<void> {
    const channel = new Channel<TtsDownloadProgress>();
    if (onProgress) channel.onmessage = onProgress;
    await invoke('tts_download_voice', { voiceId, onProgress: channel });
  },

  deleteVoice(voiceId: string): Promise<void> {
    return invoke('tts_delete_voice', { voiceId });
  },

  async synthesize(voiceId: string, text: string, speed: number): Promise<TtsAudio> {
    const buffer = await invoke<ArrayBuffer>('tts_synthesize', { voiceId, text, speed });
    return decodePcm(buffer);
  },
};
