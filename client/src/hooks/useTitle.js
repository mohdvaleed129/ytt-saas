import { useEffect } from 'react';
import { APP_NAME } from '../config.js';

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME}: YouTube transcripts`;
  }, [title]);
}
