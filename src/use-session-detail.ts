import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionDetail } from "../shared/types";
import { api } from "./api";

export function useDetail(
  sessionId: string | undefined,
  student: string,
  notify: (error: string) => void,
  keepOverview = false,
) {
  const scope = `${sessionId || ""}/${student}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const report = useRef(notify);
  report.current = notify;
  const pending = useRef<AbortController | null>(null);
  const lastError = useRef("");
  const [snapshot, setSnapshot] = useState<{
    detail: SessionDetail;
    scope: string;
    updatedAt: number;
  } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!sessionId) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const next = await api<SessionDetail>(
        `/sessions/${sessionId}${student ? `?student=${encodeURIComponent(student)}` : ""}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || currentScope.current !== scope) return;
      setSnapshot((previous) =>
        previous?.detail.session.id === next.session.id &&
        previous.detail.session.revision > next.session.revision
          ? previous
          : { detail: next, scope, updatedAt: Date.now() },
      );
      setError("");
      lastError.current = "";
    } catch (e) {
      if (controller.signal.aborted || currentScope.current !== scope) return;
      const message = (e as Error).message;
      setError(message);
      if (lastError.current !== message) report.current(message);
      lastError.current = message;
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [sessionId, student, scope]);
  useEffect(() => {
    setError("");
    lastError.current = "";
    void load();
    const timer = setInterval(() => {
      if (!pending.current) void load();
    }, 3000);
    return () => {
      clearInterval(timer);
      pending.current?.abort();
      pending.current = null;
    };
  }, [load]);
  const sameSession = snapshot?.detail.session.id === sessionId;
  return {
    detail:
      sameSession && (keepOverview || snapshot?.scope === scope)
        ? snapshot!.detail
        : null,
    load,
    error,
    updatedAt: sameSession ? snapshot!.updatedAt : null,
  };
}
