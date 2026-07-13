import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixService } from './MatrixService';
import { loadSession, MatrixSession, removeSession, saveSession } from './session';

type ConnectionState = 'loading' | 'signed-out' | 'connecting' | 'ready' | 'error';
type LoginInput = { baseUrl: string; user: string; password: string };

type MatrixContextValue = {
  client?: MatrixClient;
  session?: MatrixSession;
  state: ConnectionState;
  error?: string;
  revision: number;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
};

const MatrixContext = createContext<MatrixContextValue | undefined>(undefined);

export function MatrixProvider({ children }: { children: ReactNode }) {
  const service = useRef(new MatrixService()).current;
  const [state, setState] = useState<ConnectionState>('loading');
  const [session, setSession] = useState<MatrixSession>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const storedSession = await loadSession();
      if (!storedSession) {
        if (active) setState('signed-out');
        return;
      }
      try {
        if (active) setState('connecting');
        await service.start(storedSession);
        if (active) {
          setSession(storedSession);
          setState('ready');
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : '无法恢复登录状态');
          setState('error');
        }
      }
    };
    void restore();
    return () => {
      active = false;
      void service.stop();
    };
  }, [service]);

  const value = useMemo<MatrixContextValue>(
    () => ({
      client: service.getClient(),
      session,
      state,
      error,
      revision,
      login: async (input) => {
        setError(undefined);
        setState('connecting');
        try {
          const nextSession = await service.login(input);
          await saveSession(nextSession);
          await service.start(nextSession);
          setSession(nextSession);
          setState('ready');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '登录失败，请检查服务器地址和账号');
          setState('signed-out');
          throw cause;
        }
      },
      logout: async () => {
        await service.stop();
        await removeSession();
        setSession(undefined);
        setError(undefined);
        setState('signed-out');
      },
    }),
    [error, revision, service, session, state]
  );

  return <MatrixContext.Provider value={value}>{children}</MatrixContext.Provider>;
}

export const useMatrix = (): MatrixContextValue => {
  const value = useContext(MatrixContext);
  if (!value) throw new Error('useMatrix 必须在 MatrixProvider 内使用');
  return value;
};
