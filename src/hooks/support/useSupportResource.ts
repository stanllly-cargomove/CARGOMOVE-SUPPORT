import { useEffect, useState } from 'react';

/** Abort requests on navigation and hide data belonging to an earlier key. */
export function useSupportResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ key, data: null, error: '', loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key, data: null, error: '', loading: true });
    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ key, data, error: '', loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load support data.',
            loading: false,
          });
      });
    return () => controller.abort();
  }, [key]);
  return result.key === key
    ? result
    : { key, data: null, error: '', loading: true };
}
