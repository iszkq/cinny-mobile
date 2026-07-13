import { Preferences } from '@capacitor/preferences';

const SESSION_KEY = 'qingjian_matrix_session';

export type MatrixSession = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};

export const loadSession = async (): Promise<MatrixSession | undefined> => {
  const { value } = await Preferences.get({ key: SESSION_KEY });
  if (!value) return undefined;

  try {
    return JSON.parse(value) as MatrixSession;
  } catch {
    await Preferences.remove({ key: SESSION_KEY });
    return undefined;
  }
};

export const saveSession = async (session: MatrixSession): Promise<void> => {
  await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
};

export const removeSession = async (): Promise<void> => {
  await Preferences.remove({ key: SESSION_KEY });
};
