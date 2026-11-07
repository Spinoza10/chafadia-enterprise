import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Load `path` on mount and whenever it changes. Returns { data, error, loading, reload }.
 * `reload()` resolves once fresh data is in state, so callers can await it.
 */
const fetchState = (path) =>
  api.get(path).then(
    (data) => ({ data, error: "", path }),
    (err) => ({ data: null, error: err.message, path })
  );

/** `interval` (ms) re-fetches in the background while the tab is visible. */
export function useApi(path, { enabled = true, interval = 0 } = {}) {
  const active = Boolean(enabled && path);
  const [state, setState] = useState({ data: null, error: "", path: null });
  const seq = useRef(0);

  useEffect(() => {
    if (!active) return undefined;
    const id = ++seq.current;
    fetchState(path).then((next) => {
      if (id === seq.current) setState(next);
    });
    return () => {
      seq.current += 1; // ignore responses for an outdated path
    };
  }, [path, active]);

  useEffect(() => {
    if (!active || !interval) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const id = ++seq.current;
      fetchState(path).then((next) => {
        if (id === seq.current && next.data) setState(next);
      });
    }, interval);
    return () => clearInterval(timer);
  }, [path, active, interval]);

  const reload = useCallback(async () => {
    if (!active) return;
    const id = ++seq.current;
    const next = await fetchState(path);
    if (id === seq.current) setState(next);
  }, [path, active]);

  return { data: state.data, error: state.error, loading: active && state.path !== path, reload };
}

/** Wrap an async action with busy/error/message state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, message, run, setError, setMessage };
}
