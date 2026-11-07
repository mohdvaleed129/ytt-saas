import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiStatus } from '../api/health.js';

/** Real readiness of the backend (GET /readyz). `check` re-runs it. */
export function useApiStatus() {
  const [status, setStatus] = useState({ state: 'checking' });
  const abortRef = useRef(null);

  // First check on mount. State already starts as "checking"; setState only happens in the promise callback.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    getApiStatus({ signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setStatus(result); })
      .catch(() => { /* aborted: a newer check is running */ });
    return () => controller.abort();
  }, []);

  const check = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ state: 'checking' });
    getApiStatus({ signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setStatus(result); })
      .catch(() => { /* aborted */ });
  }, []);

  return { status, check };
}
