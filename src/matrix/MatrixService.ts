import {
  ClientEvent,
  createClient,
  IndexedDBCryptoStore,
  IndexedDBStore,
  MatrixClient,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import type { MatrixSession } from './session';

type Credentials = {
  baseUrl: string;
  user: string;
  password: string;
};

type WellKnownClientConfig = {
  'm.homeserver'?: {
    base_url?: unknown;
  };
};

const normalizeServerUrl = (server: string): string =>
  (/^https?:\/\//i.test(server) ? server : `https://${server}`).replace(/\/+$/, '');

const discoverHomeserver = async (server: string): Promise<string> => {
  const host = normalizeServerUrl(server);
  try {
    const response = await fetch(`${host}/.well-known/matrix/client`, {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return host;
    if (!response.ok) throw new Error(`服务器发现请求失败（HTTP ${response.status}）`);

    const config = (await response.json()) as WellKnownClientConfig;
    const discovered = config['m.homeserver']?.base_url;
    if (typeof discovered === 'string' && /^https?:\/\//i.test(discovered)) {
      return normalizeServerUrl(discovered);
    }
    throw new Error('服务器发现配置中没有有效的 m.homeserver.base_url');
  } catch {
    // 网络错误时按原项目逻辑回退到用户输入的地址；随后由 versions 校验给出准确结果。
    return host;
  }
};

const validateHomeserver = async (baseUrl: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/_matrix/client/versions`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`家服务器不可用（HTTP ${response.status}）`);

  const payload = (await response.json()) as { versions?: unknown };
  if (!Array.isArray(payload.versions)) {
    throw new Error('该地址不是有效的 Matrix 家服务器');
  }
};

export class MatrixService {
  private client?: MatrixClient;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify = () => this.listeners.forEach((listener) => listener());

  getClient(): MatrixClient | undefined {
    return this.client;
  }

  async login({ baseUrl, user, password }: Credentials): Promise<MatrixSession> {
    const homeserverUrl = await discoverHomeserver(baseUrl.trim());
    await validateHomeserver(homeserverUrl);
    const temporaryClient = createClient({ baseUrl: homeserverUrl });
    const response = await temporaryClient.login('m.login.password', {
      user: user.trim(),
      password,
      initial_device_display_name: '青笺 Android',
    });

    if (!response.access_token || !response.user_id || !response.device_id) {
      throw new Error('服务器没有返回完整的登录设备信息');
    }

    return {
      baseUrl: homeserverUrl,
      accessToken: response.access_token,
      userId: response.user_id,
      deviceId: response.device_id,
    };
  }

  async start(session: MatrixSession): Promise<MatrixClient> {
    await this.stop();

    const syncStore = new IndexedDBStore({
      indexedDB: globalThis.indexedDB,
      localStorage: globalThis.localStorage,
      dbName: 'qingjian-sync-store',
    });
    const cryptoStore = new IndexedDBCryptoStore(globalThis.indexedDB, 'qingjian-crypto-store');
    const client = createClient({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
      store: syncStore,
      cryptoStore,
      timelineSupport: true,
    });

    this.client = client;
    await syncStore.startup();
    await client.initRustCrypto();

    client.on(ClientEvent.Sync, (_state: SyncState) => this.notify());
    client.on(RoomEvent.Timeline, () => this.notify());
    client.on(RoomEvent.Name, () => this.notify());
    client.on(RoomEvent.MyMembership, () => this.notify());
    client.startClient({ lazyLoadMembers: true, initialSyncLimit: 30 });
    this.notify();
    return client;
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    this.client.stopClient();
    this.client.removeAllListeners();
    this.client = undefined;
    this.notify();
  }
}
