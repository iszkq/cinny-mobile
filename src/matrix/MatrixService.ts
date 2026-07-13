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
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const temporaryClient = createClient({ baseUrl: normalizedBaseUrl });
    const response = await temporaryClient.login('m.login.password', {
      user: user.trim(),
      password,
      initial_device_display_name: '青笺 Android',
    });

    if (!response.access_token || !response.user_id || !response.device_id) {
      throw new Error('服务器没有返回完整的登录设备信息');
    }

    return {
      baseUrl: normalizedBaseUrl,
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
