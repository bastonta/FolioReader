import { isUnauthorizedError, withFreshAccessToken } from '../api/tokenManager';
import { DownloadBookOptions, fileManager } from './fileManager';
import type { ChaptersBookDownloadResult, ChaptersDownloadProgress } from '../types/browse';

/** How many times the access token may be renewed while one book is built from chapters. */
const CHAPTERS_BUILD_TOKEN_RENEWALS = 12;

/** How far a build from chapters has got, as a number that grows with every step of it. */
const chaptersBuildStage = (progress: ChaptersDownloadProgress): number => {
  const phase = progress.phase === 'chapters' ? 0 : progress.phase === 'images' ? 1 : 2;
  return phase * 1_000_000_000 + progress.done;
};

/** The session ran out during a build from chapters and could not be renewed. */
export class ChaptersBuildNoSessionError extends Error {
  constructor() {
    super('UNAUTHORIZED: the session could not be renewed during the build');
    this.name = 'ChaptersBuildNoSessionError';
  }
}

/**
 * Builds (or updates) the local EPUB of a `Chapters` book, renewing the access token
 * on the way. Building a large book can outlive several tokens: the build is repeated
 * with a new token as long as every run gets further than the runs before it (the core
 * continues an interrupted build); a run that only gets as far as an earlier one would
 * never finish, and ends with `ChaptersBuildNoSessionError`.
 */
export async function buildChaptersBook(
  options: Omit<DownloadBookOptions, 'token'> & { volume?: number },
  onProgress?: (progress: ChaptersDownloadProgress) => void,
): Promise<ChaptersBookDownloadResult> {
  let furthestRun = -1;
  return withFreshAccessToken(async (token) => {
    let reached = 0;
    try {
      return await fileManager.downloadChaptersBook({ ...options, token }, (event) => {
        reached = Math.max(reached, chaptersBuildStage(event));
        onProgress?.(event);
      });
    } catch (err) {
      if (isUnauthorizedError(err) && reached <= furthestRun) {
        throw new ChaptersBuildNoSessionError();
      }
      furthestRun = Math.max(furthestRun, reached);
      throw err;
    }
  }, CHAPTERS_BUILD_TOKEN_RENEWALS);
}
