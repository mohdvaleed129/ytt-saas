import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';

export function transcriptionRouter({ provider }) {
  const router = Router();

const createSchema = z.object({
  url: z.string().trim().url().max(2048),
  lang: z.string().trim().min(2).max(16).optional(),
});

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(input) {
  let parsed;

  try {
    parsed = new URL(input);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'A valid YouTube URL is required.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    throw new AppError('VALIDATION_ERROR', 'Only YouTube video URLs are supported.');
  }

  let videoId;

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0];
  } else if (parsed.pathname === '/watch') {
    videoId = parsed.searchParams.get('v');
  } else {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(parts[0])) {
      videoId = parts[1];
    }
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new AppError('VALIDATION_ERROR', 'The YouTube URL does not contain a valid video ID.');
  }

  return videoId;
}

router.post(
  '/',
  validate({ body: createSchema }),
  async (req, res) => {
    const { url, lang } = req.valid.body;
    const videoId = extractVideoId(url);

    try {
      const result = await provider.fetchNative({
        videoId,
        ...(lang ? { lang } : {}),
      });

      if (result.status === 'unavailable') {
        throw new AppError(
          'TRANSCRIPT_UNAVAILABLE',
          'No native captions are available for this video.',
          { status: 422 },
        );
      }

      return res.status(200).json({
        data: {
          videoId,
          status: 'completed',
          transcript: result.transcript,
          providerCredits: result.providerCredits,
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error?.code === 'VIDEO_NOT_FOUND') {
        throw new AppError('NOT_FOUND', 'The requested video was not found.');
      }

      if (error?.code === 'PROVIDER_RATE_LIMITED') {
        throw new AppError('RATE_LIMITED', 'The transcription provider is temporarily rate limited.');
      }

      throw error;
    }
  },
);

  return router;
}
