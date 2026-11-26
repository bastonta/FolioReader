import type { TtsAudio, TtsLang, TtsPlaybackState } from '../types/tts';
import { ttsService } from './ttsService';

/** The part of foliate-js `TTS` (tts.js) the player uses. */
interface FoliateTts {
  doc: Document;
  start(): string | undefined;
  next(): string | undefined;
  from(range: Range): string | undefined;
  setMark(mark: string): void;
}

/** The part of the foliate-js `<foliate-view>` the player uses. */
export interface TtsView {
  tts: FoliateTts | null;
  lastLocation?: { range?: Range | null } | null;
  book?: { sections?: unknown[] };
  renderer: {
    getContents(): { doc: Document; index: number }[];
    scrollToAnchor(anchor: Range, select?: boolean): Promise<void>;
    nextSection(): Promise<void>;
  };
  initTTS(granularity: 'word' | 'sentence', highlight: (range: Range) => void): Promise<void>;
}

/** One piece of text spoken at once. `mark` names the sentence in foliate-js TTS. */
export interface Utterance {
  mark: string | null;
  text: string;
  /** Language the book declares for the text (`xml:lang`), if one of ours */
  lang: TtsLang | null;
}

export interface TtsPlayerOptions {
  getView: () => TtsView | null;
  /** Installed voice chosen for each language */
  getVoices: () => Partial<Record<TtsLang, string>>;
  getSpeed: () => number;
  onStateChange: (state: TtsPlaybackState) => void;
  onError: (error: unknown) => void;
}

/** Thrown when no voice is chosen for the text; the UI asks to download one. */
export class TtsNoVoiceError extends Error {
  constructor() {
    super('No text-to-speech voice is installed');
    this.name = 'TtsNoVoiceError';
  }
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const HIGHLIGHT_NAME = 'folio-tts';
const HIGHLIGHT_STYLE_ID = 'folio-tts-highlight-style';
/** Sentences synthesized ahead of the one playing */
const LOOKAHEAD = 2;
/** Longer text is cut (at punctuation or spaces) so that one synthesis stays short */
const MAX_UTTERANCE_CHARS = 280;

const normalizeLang = (lang: string | null | undefined): TtsLang | null => {
  const base = lang?.trim().toLowerCase().split(/[-_]/)[0];
  return base === 'ru' || base === 'en' ? base : null;
};

/**
 * Language of a piece of text by its letters: Cyrillic is read by the Russian voice, Latin
 * by the English one. Text without letters keeps the language the book declares.
 */
export const detectLang = (text: string, hint: TtsLang | null): TtsLang | null => {
  const cyrillic = text.match(/[Ѐ-ӿ]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cyrillic === 0 && latin === 0) return hint;
  return cyrillic >= latin ? 'ru' : 'en';
};

const hasSpeakableText = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** Cuts text longer than `max` characters at sentence punctuation, then commas, then spaces. */
export const splitLongText = (text: string, max = MAX_UTTERANCE_CHARS): string[] => {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const pattern of [/[.!?…;:](?=\s)/g, /[,—–)](?=\s)/g, /\s/g]) {
      for (const m of window.matchAll(pattern)) cut = (m.index ?? -1) + m[0].length;
      if (cut > max / 3) break;
      cut = -1;
    }
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(hasSpeakableText);
};

/**
 * Splits the SSML foliate-js produces for one block into utterances, one per `<mark>`
 * (with `sentence` granularity, one per sentence).
 */
export const parseSsml = (ssml: string): Utterance[] => {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml');
  const root = doc.documentElement;
  const pieces: Utterance[] = [];
  if (!root || doc.getElementsByTagName('parsererror').length > 0) return pieces;

  let current: Utterance = { mark: null, text: '', lang: null };
  const flush = () => {
    const text = current.text.replace(/\s+/g, ' ').trim();
    for (const part of splitLongText(text)) pieces.push({ ...current, text: part });
  };
  const walk = (node: Node, lang: TtsLang | null) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        if (!current.text.trim()) current.lang = lang;
        current.text += (child as CharacterData).data;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (el.localName === 'mark') {
          flush();
          current = { mark: el.getAttribute('name'), text: '', lang };
        } else if (el.localName === 'break') {
          current.text += ' ';
        } else {
          walk(el, normalizeLang(el.getAttributeNS(XML_NS, 'lang')) ?? lang);
        }
      }
    }
  };
  walk(root, normalizeLang(root.getAttributeNS(XML_NS, 'lang')));
  flush();
  return pieces;
};

interface QueueItem {
  utterance: Utterance;
  audio?: Promise<TtsAudio>;
}

type HighlightWindow = Window & {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
};

/**
 * Reads the open book aloud with the voices of the core (`tts_synthesize`), starting at
 * the visible page: sentence by sentence, highlighting the sentence spoken and turning the
 * pages (and sections) as it goes.
 */
export class TtsPlayer {
  readonly #options: TtsPlayerOptions;
  #context: AudioContext | null = null;
  #source: AudioBufferSourceNode | null = null;
  #finishPlayback: (() => void) | null = null;
  /** Bumped by every start and stop: work of an older run sees it and gives up. */
  #run = 0;
  #state: TtsPlaybackState = 'idle';
  #queue: QueueItem[] = [];
  /** The TTS of the current section has no more blocks */
  #sectionEnded = false;
  #highlightedDocs = new Set<Document>();

  constructor(options: TtsPlayerOptions) {
    this.#options = options;
  }

  get state(): TtsPlaybackState {
    return this.#state;
  }

  /** Starts reading at the visible page. Call from a user gesture (audio needs one). */
  async start(): Promise<void> {
    this.stop();
    const run = ++this.#run;
    const view = this.#options.getView();
    if (!view) return;
    this.#setState('loading');
    const context = this.#ensureContext();
    try {
      await context.resume();
      await view.initTTS('sentence', (range) => this.#highlight(range));
      if (run !== this.#run || !view.tts) return;
      this.#queue = [];
      this.#sectionEnded = false;
      this.#enqueue(this.#firstSsml(view, view.tts));
      await this.#loop(run);
    } catch (err) {
      if (run !== this.#run) return;
      this.stop();
      this.#options.onError(err);
    }
  }

  pause(): void {
    if (this.#state !== 'playing' && this.#state !== 'loading') return;
    void this.#context?.suspend();
    this.#setState('paused');
  }

  resume(): void {
    if (this.#state !== 'paused') return;
    void this.#context?.resume();
    this.#setState(this.#source ? 'playing' : 'loading');
  }

  stop(): void {
    this.#run++;
    this.#queue = [];
    this.#sectionEnded = false;
    const source = this.#source;
    this.#source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // never started
      }
    }
    this.#finishPlayback?.();
    this.#finishPlayback = null;
    if (this.#context?.state === 'suspended') void this.#context.resume();
    this.#clearHighlight();
    this.#setState('idle');
  }

  /**
   * Drops audio synthesized ahead, so that a new speed or voice applies from the next
   * sentence on.
   */
  refresh(): void {
    for (const item of this.#queue) item.audio = undefined;
    if (this.#state === 'playing' || this.#state === 'paused') this.#prefetch();
  }

  dispose(): void {
    this.stop();
    void this.#context?.close();
    this.#context = null;
  }

  #setState(state: TtsPlaybackState) {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onStateChange(state);
  }

  #ensureContext(): AudioContext {
    if (!this.#context || this.#context.state === 'closed') this.#context = new AudioContext();
    return this.#context;
  }

  /** SSML to start with: from the visible page if it is in the TTS document. */
  #firstSsml(view: TtsView, tts: FoliateTts): string | undefined {
    const range = view.lastLocation?.range;
    if (range && range.startContainer.ownerDocument === tts.doc) {
      try {
        const ssml = tts.from(range);
        if (ssml) return ssml;
      } catch {
        // `from` throws when no block is at or after the range
      }
    }
    return tts.start();
  }

  /** Adds the utterances of `ssml`, then of the following blocks until one has text. */
  #enqueue(ssml: string | undefined) {
    const tts = this.#options.getView()?.tts;
    let next = ssml;
    while (next !== undefined) {
      const utterances = parseSsml(next);
      if (utterances.length > 0) {
        this.#queue.push(...utterances.map((utterance) => ({ utterance })));
        return;
      }
      next = tts?.next();
    }
    this.#sectionEnded = true;
  }

  async #loop(run: number) {
    while (run === this.#run) {
      if (this.#queue.length === 0) {
        if (!(await this.#nextSection(run))) {
          if (run === this.#run) this.stop();
          return;
        }
        continue;
      }

      this.#prefetch();
      const item = this.#queue[0];
      const audio = await item.audio!;
      if (run !== this.#run) return;
      this.#queue.shift();

      const tts = this.#options.getView()?.tts;
      if (item.utterance.mark && tts) tts.setMark(item.utterance.mark);
      // The next block is read only now: foliate-js TTS knows the sentences of one block
      // at a time, and `setMark` above had to find this one.
      if (this.#queue.length === 0 && !this.#sectionEnded && tts) {
        this.#enqueue(tts.next());
        this.#prefetch();
      }
      await this.#play(audio, run);
    }
  }

  #prefetch() {
    const speed = this.#options.getSpeed();
    for (const item of this.#queue.slice(0, LOOKAHEAD)) {
      if (item.audio) continue;
      const voice = this.#voiceFor(item.utterance);
      item.audio = voice
        ? ttsService.synthesize(voice, item.utterance.text, speed)
        : Promise.reject(new TtsNoVoiceError());
      // Awaited in the loop; this keeps a rejection of audio never awaited from being reported
      item.audio.catch(() => {});
    }
  }

  #voiceFor(utterance: Utterance): string | undefined {
    const voices = this.#options.getVoices();
    const lang = detectLang(utterance.text, utterance.lang);
    return (lang && voices[lang]) || voices.ru || voices.en;
  }

  /** Opens the next section and queues its text. False at the end of the book. */
  async #nextSection(run: number): Promise<boolean> {
    const view = this.#options.getView();
    if (!view) return false;
    const before = view.renderer.getContents()[0]?.index;
    const total = view.book?.sections?.length ?? 0;
    if (typeof before !== 'number' || before + 1 >= total) return false;

    await view.renderer.nextSection();
    if (run !== this.#run) return false;
    const after = view.renderer.getContents()[0]?.index;
    if (typeof after !== 'number' || after <= before) return false;

    await view.initTTS('sentence', (range) => this.#highlight(range));
    if (run !== this.#run || !view.tts) return false;
    this.#sectionEnded = false;
    this.#enqueue(view.tts.start());
    return true;
  }

  #play(audio: TtsAudio, run: number): Promise<void> {
    const context = this.#context;
    if (!context || audio.samples.length === 0 || run !== this.#run) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate);
      buffer.copyToChannel(audio.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const finish = () => {
        if (this.#source === source) this.#source = null;
        if (this.#finishPlayback === finish) this.#finishPlayback = null;
        resolve();
      };
      source.onended = finish;
      this.#source = source;
      this.#finishPlayback = finish;
      source.start();
      if (this.#state === 'loading') this.#setState('playing');
    });
  }

  #highlight(range: Range) {
    const doc = range.startContainer.ownerDocument;
    const win = doc?.defaultView as HighlightWindow | null;
    if (doc && win?.CSS?.highlights && typeof win.Highlight === 'function') {
      if (!doc.getElementById(HIGHLIGHT_STYLE_ID)) {
        const style = doc.createElement('style');
        style.id = HIGHLIGHT_STYLE_ID;
        style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 196, 0, 0.35); }`;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      win.CSS.highlights.set(HIGHLIGHT_NAME, new win.Highlight(range));
      this.#highlightedDocs.add(doc);
    }
    if (!this.#isVisible(range)) {
      // 'navigation' (not 'selection'): the engine would select the sentence otherwise
      void this.#options.getView()?.renderer.scrollToAnchor(range, false);
    }
  }

  #isVisible(range: Range): boolean {
    const visible = this.#options.getView()?.lastLocation?.range;
    if (!visible || visible.startContainer.ownerDocument !== range.startContainer.ownerDocument) {
      return false;
    }
    try {
      return (
        range.compareBoundaryPoints(Range.START_TO_START, visible) >= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, visible) <= 0
      );
    } catch {
      return false;
    }
  }

  #clearHighlight() {
    for (const doc of this.#highlightedDocs) {
      (doc.defaultView as HighlightWindow | null)?.CSS?.highlights?.delete(HIGHLIGHT_NAME);
    }
    this.#highlightedDocs.clear();
  }
}
