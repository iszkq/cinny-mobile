import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MsgType, NotificationCountType, Preset } from 'matrix-js-sdk';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api';
import { CryptoEvent, ShowSasCallbacks, VerificationPhase, VerificationRequest, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api';
import { App as CapacitorApp } from '@capacitor/app';
import { encryptAttachment } from 'browser-encrypt-attachment';
import {
  Badge,
  Button,
  Dialog,
  DotLoading,
  Empty,
  ErrorBlock,
  Form,
  Input,
  List,
  NavBar,
  PullToRefresh,
  Popup,
  SearchBar,
  TabBar,
  TextArea,
  Toast,
} from 'antd-mobile';
import {
  CompassOutline,
  MessageOutline,
  MoreOutline,
  SearchOutline,
  SendOutline,
  SetOutline,
  UserOutline,
} from 'antd-mobile-icons';
import { MatrixProvider, useMatrix } from './matrix/MatrixProvider';
import { MessageBody as MatrixMessageBody, useAuthenticatedMediaUrl as resolveMediaUrl } from './features/chat/MessageMedia';
import { MessageReactions as AggregatedReactions } from './features/chat/MessageReactions';

type TabKey = 'chats' | 'contacts' | 'discover' | 'profile';
const FAVORITES_EVENT = 'in.cinny.favorite_items';
const RECENT_EMOJI_EVENT = 'io.element.recent_emoji';
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🙏', '👀', '🔥', '✅', '🤔', '💯'];
type FavoriteItem = { version: 1; id: string; eventType: string; content: Record<string, unknown>; metadata: { version: 1; sourceRoomId: string; sourceRoomName: string; sourceEventId: string; sourceSenderId?: string; sourceSenderName: string; sourceTimestamp: number; favoritedAt: number }; roomId: string; eventId?: string; sender?: string; originServerTs: number; updatedAt: number };
type ServerSearchItem = { eventId: string; roomId: string; sender?: string; body: string; timestamp: number };

const displayTime = (timestamp?: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const roomTitle = (room: Room): string => room.name || room.roomId;
const roomTopic = (room: Room): string | undefined => {
  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;
  return typeof topic === 'string' ? topic : undefined;
};

const isSpaceRoom = (room: Room): boolean => room.currentState.getStateEvents('m.room.create', '')?.getContent().type === 'm.space';

const eventText = (event?: MatrixEvent): string => {
  if (!event) return '开始一段新的对话';
  if (event.getType() === 'm.sticker') return '[贴纸]';
  if (event.getType() !== 'm.room.message') return '有新的房间动态';
  const content = event.getContent();
  if (content.msgtype === MsgType.Image) return '[图片]';
  if (content.msgtype === MsgType.File) return '[文件]';
  if (content.msgtype === MsgType.Audio) return '[语音]';
  return typeof content.body === 'string' ? content.body : '[消息]';
};

const initials = (name: string): string => name.trim().slice(0, 1).toUpperCase() || 'Q';

const sanitizedForwardContent = (content: Record<string, unknown>): Record<string, unknown> => {
  const clone = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  // A forwarded event is a new message: reply/edit and mention relations must not leak into it.
  delete clone['m.relates_to'];
  delete clone['m.mentions'];
  return clone;
};

const recentEmoji = (client: NonNullable<ReturnType<typeof useMatrix>['client']>): string[] => {
  const content = client.getAccountData(RECENT_EMOJI_EVENT as any)?.getContent() as { recent_emoji?: [string, number][] } | undefined;
  return Array.isArray(content?.recent_emoji)
    ? content.recent_emoji.slice().sort((a, b) => b[1] - a[1]).map(([emoji]) => emoji).filter((emoji) => typeof emoji === 'string').slice(0, 12)
    : [];
};

const saveRecentEmoji = async (client: NonNullable<ReturnType<typeof useMatrix>['client']>, emoji: string): Promise<void> => {
  const content = client.getAccountData(RECENT_EMOJI_EVENT as any)?.getContent() as { recent_emoji?: [string, number][] } | undefined;
  const items = Array.isArray(content?.recent_emoji) ? content.recent_emoji.map(([value, count]) => [value, count] as [string, number]) : [];
  const index = items.findIndex(([value]) => value === emoji);
  const entry: [string, number] = index >= 0 ? items.splice(index, 1)[0] : [emoji, 0];
  entry[1] += 1;
  items.unshift(entry);
  await client.setAccountData(RECENT_EMOJI_EVENT as any, { recent_emoji: items.slice(0, 100) } as any);
};

const toggleFavoriteItem = async (client: NonNullable<ReturnType<typeof useMatrix>['client']>, room: Room, event: MatrixEvent): Promise<boolean> => {
  const eventId = event.getId();
  if (!eventId) throw new Error('该消息尚未同步完成');
  const id = `${room.roomId}|${eventId}`;
  const current = (client.getAccountData(FAVORITES_EVENT as any)?.getContent() ?? {}) as { items?: Record<string, FavoriteItem> };
  const items = { ...(current.items ?? {}) };
  if (items[id]) { delete items[id]; await client.setAccountData(FAVORITES_EVENT as any, { version: 1, updatedAt: Date.now(), items } as any); return false; }
  items[id] = { version: 1, id, eventType: event.getType(), content: JSON.parse(JSON.stringify(event.getContent())), metadata: { version: 1, sourceRoomId: room.roomId, sourceRoomName: roomTitle(room), sourceEventId: eventId, sourceSenderId: event.getSender() ?? undefined, sourceSenderName: event.sender?.name ?? event.getSender() ?? '未知用户', sourceTimestamp: event.getTs(), favoritedAt: Date.now() }, roomId: room.roomId, eventId, sender: event.getSender() ?? undefined, originServerTs: event.getTs(), updatedAt: Date.now() };
  await client.setAccountData(FAVORITES_EVENT as any, { version: 1, updatedAt: Date.now(), items } as any);
  return true;
};

function LoginPage() {
  const { login, error, state } = useMatrix();
  const [baseUrl, setBaseUrl] = useState('https://mtx01.cc');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const submitting = state === 'connecting';

  const submit = async () => {
    if (!baseUrl || !user || !password) {
      Toast.show({ content: '请完整填写服务器、账号和密码' });
      return;
    }
    if (!/^https:\/\//i.test(baseUrl.trim())) {
      Toast.show({ content: '请输入以 https:// 开头的服务器地址' });
      return;
    }
    try {
      await login({ baseUrl, user, password });
      Toast.show({ icon: 'success', content: '欢迎回来' });
    } catch {
      // 错误会显示在表单下方，保留用户输入方便修正。
    }
  };

  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand" aria-label="青笺 Matrix">
          <div className="login-mark">M</div>
          <span>青笺</span>
        </div>
        <div className="login-heading">
          <h1>登录 Matrix</h1>
          <p>使用你的账号继续。</p>
        </div>
        <section className="login-card">
        <Form layout="vertical" requiredMarkStyle="none">
          <Form.Item label="服务器地址">
            <Input value={baseUrl} onChange={setBaseUrl} placeholder="https://mtx01.cc" clearable />
          </Form.Item>
          <Form.Item label="账号">
            <Input value={user} onChange={setUser} placeholder="用户名或完整 Matrix ID" clearable />
          </Form.Item>
          <Form.Item label="密码">
            <Input value={password} onChange={setPassword} type="password" placeholder="输入密码" clearable />
          </Form.Item>
        </Form>
        {error && <div className="login-error">{error}</div>}
        <Button block color="primary" size="large" loading={submitting} onClick={submit}>
          登录
        </Button>
        </section>
        <p className="login-tip">首次登录会创建一台新设备；加密房间可在登录后验证或恢复密钥。</p>
      </section>
    </main>
  );
}

function RoomAvatar({ room }: { room: Room }) {
  const { session } = useMatrix();
  const source = session ? room.getAvatarUrl(session.baseUrl, 96, 96, 'crop', undefined, true) : null;
  const imageUrl = resolveMediaUrl(source, session?.accessToken);
  return imageUrl ? <img className="room-avatar" src={imageUrl} alt="" /> : <div className="room-avatar">{initials(roomTitle(room))}</div>;
}

function SenderAvatar({ event }: { event: MatrixEvent }) {
  const { session } = useMatrix();
  const source = session && event.sender
    ? event.sender.getAvatarUrl(session.baseUrl, 64, 64, 'crop', undefined, false, true)
    : null;
  const imageUrl = resolveMediaUrl(source, session?.accessToken);
  return imageUrl ? <img className="message-avatar" src={imageUrl} alt="" /> : <div className="message-avatar">{initials(event.getSender() ?? '?')}</div>;
}

function ChatsPage({
  openRoom,
  openNewChat,
}: {
  openRoom: (roomId: string) => void;
  openNewChat: () => void;
}) {
  const { client, revision } = useMatrix();
  const [keyword, setKeyword] = useState('');
  const rooms = useMemo(() => {
    if (!client) return [];
    return client
      .getRooms()
      .filter((room) => room.getMyMembership() === 'join')
      .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
      .filter((room) => roomTitle(room).toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  }, [client, keyword, revision]);

  const refresh = async () => {
    // Matrix 同步由 SDK 持续维护；等待一个同步周期以完成下拉反馈。
    await new Promise((resolve) => window.setTimeout(resolve, client ? 420 : 0));
  };

  return (
    <section className="tab-page">
      <header className="page-header home-header">
        <div>
          <p className="eyebrow">QINGJIAN</p>
          <h2>消息</h2>
        </div>
        <button className="round-button" type="button" aria-label="新建会话" onClick={openNewChat}>＋</button>
      </header>
      <div className="search-wrap"><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索会话" /></div>
      <PullToRefresh onRefresh={refresh}>
        <div className="room-list">
          {rooms.length === 0 ? (
            <Empty description="还没有可显示的会话" />
          ) : (
            rooms.map((room) => {
              const event = room.getLiveTimeline().getEvents().at(-1);
              const unread = room.getUnreadNotificationCount(NotificationCountType.Total);
              return (
                <button className="room-row" key={room.roomId} onClick={() => openRoom(room.roomId)} type="button">
                  <Badge content={unread > 0 ? unread : null}><RoomAvatar room={room} /></Badge>
                  <span className="room-row-main">
                    <span className="room-row-title">{roomTitle(room)}</span>
                    <span className="room-row-preview">{eventText(event)}</span>
                  </span>
                  <span className="room-row-meta">
                    <time>{displayTime(event?.getTs() ?? room.getLastActiveTimestamp())}</time>
                    {room.hasEncryptionStateEvent() && <span className="encryption-dot" title="端到端加密" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PullToRefresh>
    </section>
  );
}

type ConversationMode = 'direct' | 'group' | 'space' | 'join';

function NewConversationPopup({
  visible,
  close,
  openRoom,
}: {
  visible: boolean;
  close: () => void;
  openRoom: (roomId: string) => void;
}) {
  const { client } = useMatrix();
  const [mode, setMode] = useState<ConversationMode>('direct');
  const [members, setMembers] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomIdOrAlias, setRoomIdOrAlias] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const memberIds = members.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean);
  const submit = async () => {
    if (!client) return;
    if (mode === 'join' && !roomIdOrAlias.trim()) {
      Toast.show({ content: '请输入房间 ID 或别名' });
      return;
    }
    if (mode !== 'join' && mode !== 'space' && memberIds.length === 0) {
      Toast.show({ content: '请输入至少一个 Matrix 用户 ID' });
      return;
    }
    if ((mode === 'group' || mode === 'space') && !roomName.trim()) {
      Toast.show({ content: '请输入群聊名称' });
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'join') {
        const room = await client.joinRoom(roomIdOrAlias.trim());
        openRoom(room.roomId);
      } else {
        const created = await client.createRoom(
          mode === 'direct'
            ? { invite: memberIds, is_direct: true, preset: Preset.TrustedPrivateChat, initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }] }
            : mode === 'space'
              ? { name: roomName.trim(), invite: memberIds, preset: Preset.PrivateChat, creation_content: { type: 'm.space' } }
              : { name: roomName.trim(), invite: memberIds, preset: Preset.PrivateChat, initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }] }
        );
        if (mode === 'direct') {
          const existing = (client.getAccountData('m.direct' as any)?.getContent() ?? {}) as Record<string, string[]>;
          const updated = { ...existing };
          memberIds.forEach((memberId) => {
            updated[memberId] = [...new Set([...(updated[memberId] ?? []), created.room_id])];
          });
          await client.setAccountData('m.direct' as any, updated as any);
        }
        openRoom(created.room_id);
      }
      close();
    } catch (cause) {
      Toast.show({ icon: 'fail', content: cause instanceof Error ? cause.message : '操作失败，请稍后重试' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}>
      <section className="new-chat-panel">
        <div className="sheet-handle" />
        <h2>新建会话</h2>
        <div className="mode-tabs">
          <button className={mode === 'direct' ? 'selected' : ''} onClick={() => setMode('direct')} type="button">私聊</button>
          <button className={mode === 'group' ? 'selected' : ''} onClick={() => setMode('group')} type="button">群聊</button>
          <button className={mode === 'space' ? 'selected' : ''} onClick={() => setMode('space')} type="button">空间</button>
          <button className={mode === 'join' ? 'selected' : ''} onClick={() => setMode('join')} type="button">加入房间</button>
        </div>
        {mode === 'join' ? (
          <Form layout="vertical" requiredMarkStyle="none">
            <Form.Item label="房间 ID 或别名"><Input value={roomIdOrAlias} onChange={setRoomIdOrAlias} placeholder="!room:mtx01.cc 或 #room:mtx01.cc" clearable /></Form.Item>
          </Form>
        ) : (
          <Form layout="vertical" requiredMarkStyle="none">
            {(mode === 'group' || mode === 'space') && <Form.Item label={mode === 'space' ? '空间名称' : '群聊名称'}><Input value={roomName} onChange={setRoomName} placeholder={mode === 'space' ? '例如：工作与项目' : '例如：项目讨论组'} clearable /></Form.Item>}
            <Form.Item label={mode === 'direct' ? '对方 Matrix ID' : mode === 'space' ? '邀请成员（可选）' : '邀请成员'}>
              <Input value={members} onChange={setMembers} placeholder="@alice:mtx01.cc，多个用逗号分隔" clearable />
            </Form.Item>
          </Form>
        )}
        <Button block color="primary" size="large" loading={submitting} onClick={submit}>{mode === 'join' ? '加入房间' : mode === 'space' ? '创建空间' : '创建并进入'}</Button>
      </section>
    </Popup>
  );
}

function ContactsPage({ openRoom, openNewChat }: { openRoom: (roomId: string) => void; openNewChat: () => void }) {
  const { client, revision } = useMatrix();
  const rooms = useMemo(
    () => client?.getRooms().filter((room) => room.getMyMembership() === 'join').slice(0, 8) ?? [],
    [client, revision]
  );
  const directRoomIds = useMemo(() => {
    if (!client) return new Set<string>();
    const direct = (client.getAccountData('m.direct' as any)?.getContent() ?? {}) as Record<string, string[]>;
    return new Set(Object.values(direct).flat());
  }, [client, revision]);
  const directRooms = rooms.filter((room) => directRoomIds.has(room.roomId));
  return (
    <section className="tab-page">
      <header className="page-header"><div><p className="eyebrow">PEOPLE</p><h2>联系人</h2></div></header>
      <div className="feature-card">
        <span className="feature-icon">✦</span>
        <div><strong>常用会话</strong><p>从已加入的房间中快速找到熟悉的人。</p></div>
      </div>
      <List className="soft-list" header="最近互动">
        {directRooms.map((room) => <List.Item key={room.roomId} prefix={<RoomAvatar room={room} />} description={room.getMembers().find((member) => member.userId !== client?.getUserId())?.userId} onClick={() => openRoom(room.roomId)}>{roomTitle(room)}</List.Item>)}
        {directRooms.length === 0 && <List.Item onClick={openNewChat}>新建私聊后会显示在这里</List.Item>}
      </List>
    </section>
  );
}

type PublicRoom = { room_id: string; name?: string; topic?: string; num_joined_members?: number };

function DiscoverPage({ openRoom }: { openRoom: (roomId: string) => void }) {
  const { client, revision } = useMatrix();
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const invites = useMemo(
    () => client?.getRooms().filter((room) => room.getMyMembership() === 'invite') ?? [],
    [client, revision]
  );
  const spaces = useMemo(
    () => client?.getRooms().filter((room) => room.getMyMembership() === 'join' && isSpaceRoom(room)) ?? [],
    [client, revision]
  );
  const loadPublicRooms = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.publicRooms({ limit: 20 });
      setPublicRooms(result.chunk as PublicRoom[]);
    } catch {
      Toast.show({ icon: 'fail', content: '公共房间加载失败' });
    } finally { setLoading(false); }
  };
  useEffect(() => { void loadPublicRooms(); }, [client]);
  const acceptInvite = async (room: Room) => {
    if (!client) return;
    try { await client.joinRoom(room.roomId); openRoom(room.roomId); } catch { Toast.show({ icon: 'fail', content: '接受邀请失败' }); }
  };
  const rejectInvite = async (room: Room) => {
    if (!client) return;
    try { await client.leave(room.roomId); } catch { Toast.show({ icon: 'fail', content: '拒绝邀请失败' }); }
  };
  const joinPublicRoom = async (room: PublicRoom) => {
    if (!client) return;
    try { const joined = await client.joinRoom(room.room_id); openRoom(joined.roomId); } catch { Toast.show({ icon: 'fail', content: '加入房间失败' }); }
  };
  return (
    <section className="tab-page">
      <header className="page-header"><div><p className="eyebrow">EXPLORE</p><h2>发现</h2></div></header>
      {invites.length > 0 && <List className="soft-list" header="房间邀请">
        {invites.map((room) => <List.Item key={room.roomId} description={roomTopic(room) || '邀请你加入此房间'} extra={<div className="invite-actions"><button onClick={() => void acceptInvite(room)}>接受</button><button onClick={() => void rejectInvite(room)}>拒绝</button></div>}>{roomTitle(room)}</List.Item>)}
      </List>}
      {spaces.length > 0 && <List className="soft-list" header="空间">
        {spaces.map((space) => <List.Item key={space.roomId} prefix={<RoomAvatar room={space} />} description={roomTopic(space) || '整理相关房间'} onClick={() => openRoom(space.roomId)}>{roomTitle(space)}</List.Item>)}
      </List>}
      <div className="discover-section-title"><span>公共房间</span><Button size="mini" fill="none" loading={loading} onClick={loadPublicRooms}>刷新</Button></div>
      <List className="soft-list public-rooms">
        {publicRooms.map((room) => <List.Item key={room.room_id} description={room.topic || `${room.num_joined_members ?? 0} 位成员`} extra={<Button size="mini" color="primary" onClick={() => void joinPublicRoom(room)}>加入</Button>}>{room.name || room.room_id}</List.Item>)}
        {!loading && publicRooms.length === 0 && <List.Item description="当前服务器没有公开房间，或目录功能未开启">暂无公共房间</List.Item>}
      </List>
    </section>
  );
}

function SpacePage({ space, close, openRoom }: { space: Room; close: () => void; openRoom: (roomId: string) => void }) {
  const { client, session, revision } = useMatrix();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const childIds = useMemo(() => space.currentState.getStateEvents('m.space.child')
    .map((event) => event.getStateKey())
    .filter((id): id is string => typeof id === 'string'), [revision, space]);
  const children = useMemo(() => childIds.map((id) => client?.getRoom(id)).filter((room): room is Room => !!room), [childIds, client, revision]);
  const candidates = useMemo(() => client?.getRooms()
    .filter((room) => room.getMyMembership() === 'join' && !isSpaceRoom(room) && room.roomId !== space.roomId && !childIds.includes(room.roomId))
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp()) ?? [], [childIds, client, revision, space.roomId]);
  const addRoom = async (roomId: string) => {
    if (!client) return;
    setSaving(true);
    try {
      const via = session ? [new URL(session.baseUrl).hostname] : [];
      await client.sendStateEvent(space.roomId, 'm.space.child' as any, { via }, roomId);
      setPickerOpen(false);
      Toast.show({ icon: 'success', content: '已加入此空间' });
    } catch { Toast.show({ icon: 'fail', content: '无法加入空间，请检查空间权限' }); }
    finally { setSaving(false); }
  };
  return <main className="space-page"><NavBar back="发现" onBack={close}>{roomTitle(space)}</NavBar><section className="space-content"><p className="space-topic">{roomTopic(space) || '把相关房间集中在这里。'}</p><div className="space-section-heading"><span>房间</span><Button size="small" color="primary" onClick={() => setPickerOpen(true)}>添加房间</Button></div><div className="room-list">{children.map((room) => <button className="room-row" key={room.roomId} type="button" onClick={() => openRoom(room.roomId)}><RoomAvatar room={room} /><span className="room-row-main"><span className="room-row-title">{roomTitle(room)}</span><span className="room-row-preview">{roomTopic(room) || '进入房间查看消息'}</span></span></button>)}{children.length === 0 && <Empty description="还没有房间，添加一个开始整理。" />}</div></section><Popup visible={pickerOpen} onMaskClick={() => setPickerOpen(false)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>添加到空间</h2><div className="forward-list">{candidates.map((room) => <button key={room.roomId} type="button" onClick={() => void addRoom(room.roomId)}><RoomAvatar room={room} /><span>{roomTitle(room)}</span><b>＋</b></button>)}{candidates.length === 0 && <Empty description="没有可加入的房间" />}</div>{saving && <DotLoading color="primary" />}</section></Popup></main>;
}

function CryptoRecoveryPopup({ visible, close }: { visible: boolean; close: () => void }) {
  const { client } = useMatrix();
  const [recoveryKey, setRecoveryKey] = useState('');
  const [progress, setProgress] = useState<string>();
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    const crypto = client?.getCrypto();
    if (!crypto || !recoveryKey.trim()) return;
    setBusy(true); setProgress('正在验证恢复密钥…');
    try {
      const backup = await crypto.getKeyBackupInfo();
      if (!backup?.version) throw new Error('当前账号没有可恢复的密钥备份。');
      await crypto.storeSessionBackupPrivateKey(decodeRecoveryKey(recoveryKey.trim()), backup.version);
      setProgress('正在恢复加密消息…');
      const result = await crypto.restoreKeyBackup({ progressCallback: (state) => setProgress(state.stage === 'load_keys' ? `正在恢复：${state.successes} / ${state.total}` : '正在下载密钥备份…') });
      setProgress(`恢复完成，已导入 ${result.imported} 个会话密钥。`);
    } catch (cause) { setProgress(cause instanceof Error ? cause.message : '恢复失败，请检查恢复密钥。'); }
    finally { setBusy(false); }
  };
  return <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>恢复加密密钥</h2><p className="crypto-help">输入另一台已验证设备提供的恢复密钥。密钥只用于本机恢复加密消息。</p><Form layout="vertical" requiredMarkStyle="none"><Form.Item label="恢复密钥"><Input value={recoveryKey} onChange={setRecoveryKey} type="password" placeholder="输入恢复密钥" clearable /></Form.Item></Form>{progress && <p className="crypto-progress">{progress}</p>}<Button block color="primary" loading={busy} onClick={restore}>恢复消息密钥</Button></section></Popup>;
}

function DeviceVerificationPopup({ request, close }: { request?: VerificationRequest; close: () => void }) {
  const [phase, setPhase] = useState(request?.phase);
  const [sas, setSas] = useState<ShowSasCallbacks>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!request) return undefined;
    const refresh = () => setPhase(request.phase);
    request.on(VerificationRequestEvent.Change, refresh);
    refresh();
    return () => { request.removeListener(VerificationRequestEvent.Change, refresh); };
  }, [request]);
  if (!request || phase === undefined) return null;
  const start = async () => {
    setBusy(true);
    try {
      const verifier = await request.startVerification('m.sas.v1');
      verifier.on(VerifierEvent.ShowSas, setSas);
      await verifier.verify();
    } catch { Toast.show({ icon: 'fail', content: '设备验证未完成' }); }
    finally { setBusy(false); }
  };
  const accept = async () => { setBusy(true); try { await request.accept(); } finally { setBusy(false); } };
  const cancel = () => { if (request.phase !== VerificationPhase.Done && request.phase !== VerificationPhase.Cancelled) void request.cancel(); close(); };
  const message = phase === VerificationPhase.Done ? '设备验证已完成。' : phase === VerificationPhase.Cancelled ? '设备验证已取消。' : phase === VerificationPhase.Ready ? '另一台设备已接受。开始后请比对两端显示的表情。' : request.initiatedByMe ? '验证请求已发送，请在另一台已登录设备上接受。' : '收到一条设备验证请求。';
  return <Popup visible onMaskClick={cancel} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>验证新设备</h2><p className="crypto-help">{message}</p>{sas ? <><div className="sas-emojis">{sas.sas.emoji?.map(([emoji, name]) => <span key={`${emoji}-${name}`}><b>{emoji}</b><small>{name}</small></span>)}</div><Button block color="primary" loading={busy} onClick={() => void sas.confirm()}>表情一致</Button><Button block fill="none" onClick={() => { sas.mismatch(); close(); }}>表情不一致</Button></> : phase === VerificationPhase.Ready ? <Button block color="primary" loading={busy} onClick={start}>开始表情验证</Button> : !request.initiatedByMe && phase === VerificationPhase.Requested ? <Button block color="primary" loading={busy} onClick={accept}>接受验证</Button> : phase === VerificationPhase.Done || phase === VerificationPhase.Cancelled ? <Button block onClick={close}>完成</Button> : <Button block fill="none" onClick={cancel}>取消</Button>}</section></Popup>;
}

function FavoritesPopup({ visible, close, openRoom }: { visible: boolean; close: () => void; openRoom: (roomId: string) => void }) {
  const { client, revision } = useMatrix();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  useEffect(() => {
    if (!visible || !client) return;
    const content = (client.getAccountData(FAVORITES_EVENT as any)?.getContent() ?? {}) as { items?: Record<string, FavoriteItem> };
    setItems(Object.values(content.items ?? {}).sort((a, b) => b.metadata.favoritedAt - a.metadata.favoritedAt));
  }, [client, revision, visible]);
  const remove = async (id: string) => {
    if (!client) return;
    const content = (client.getAccountData(FAVORITES_EVENT as any)?.getContent() ?? {}) as { items?: Record<string, FavoriteItem> };
    const next = { ...(content.items ?? {}) };
    delete next[id];
    try {
      await client.setAccountData(FAVORITES_EVENT as any, { version: 1, updatedAt: Date.now(), items: next } as any);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch { Toast.show({ icon: 'fail', content: '取消收藏失败' }); }
  };
  return <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>收藏消息</h2><div className="favorites-list">{items.map((item) => <article key={item.id}><button className="favorite-open" type="button" onClick={() => { close(); openRoom(item.metadata.sourceRoomId); }}><b>{item.metadata.sourceRoomName}</b><span>{typeof item.content.body === 'string' ? item.content.body : '[媒体消息]'}</span><small>{item.metadata.sourceSenderName} · {displayTime(item.metadata.sourceTimestamp)}</small></button><button className="favorite-remove" type="button" aria-label="取消收藏" onClick={() => void remove(item.id)}>×</button></article>)}{items.length === 0 && <Empty description="还没有收藏消息" />}</div></section></Popup>;
}

function ProfilePage({ onRequestVerification, openRoom }: { onRequestVerification: (request: VerificationRequest) => void; openRoom: (roomId: string) => void }) {
  const { client, session, logout } = useMatrix();
  const [cryptoOpen, setCryptoOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const performLogout = async () => {
    const confirmed = await Dialog.confirm({ content: '退出后可随时重新登录。确定要退出青笺吗？', confirmText: '退出登录' });
    if (confirmed) await logout();
  };
  const requestVerification = async () => {
    const crypto = client?.getCrypto();
    if (!crypto) return;
    try {
      onRequestVerification(await crypto.requestOwnUserVerification());
      Toast.show({ icon: 'success', content: '验证请求已发送，请在另一台设备上接受' });
    } catch { Toast.show({ icon: 'fail', content: '无法创建验证请求' }); }
  };
  return (
    <section className="tab-page">
      <header className="page-header"><div><p className="eyebrow">ME</p><h2>我的</h2></div></header>
      <div className="profile-card">
        <div className="profile-avatar">{initials(session?.userId ?? 'Q')}</div>
        <div><strong>{session?.userId}</strong><p>{session?.baseUrl}</p></div>
      </div>
      <List className="soft-list">
        <List.Item description="消息提示、声音与勿扰时间">通知与提醒</List.Item>
        <List.Item description="验证设备、恢复密钥与会话安全" onClick={() => setCryptoOpen(true)}>加密与密钥</List.Item>
        <List.Item description="在另一台已登录设备上确认表情验证码" onClick={() => void requestVerification()}>验证新设备</List.Item>
        <List.Item description="跨设备同步的已收藏消息" onClick={() => setFavoritesOpen(true)}>消息收藏</List.Item>
        <List.Item description="青笺 Android · 0.1.0">关于青笺</List.Item>
      </List>
      <Button className="logout-button" block fill="none" color="danger" onClick={performLogout}>退出登录</Button>
      <CryptoRecoveryPopup visible={cryptoOpen} close={() => setCryptoOpen(false)} />
      <FavoritesPopup visible={favoritesOpen} close={() => setFavoritesOpen(false)} openRoom={openRoom} />
    </section>
  );
}

function RoomMenu({ room, visible, close, openMembers }: { room: Room; visible: boolean; close: () => void; openMembers: () => void }) {
  const { client } = useMatrix();
  const [memberId, setMemberId] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setName(roomTitle(room));
    setTopic(roomTopic(room) ?? '');
  }, [room, visible]);
  const invite = async () => {
    if (!client || !memberId.trim()) return;
    setBusy(true);
    try {
      await client.invite(room.roomId, memberId.trim());
      setMemberId('');
      Toast.show({ icon: 'success', content: '已发送邀请' });
    } catch {
      Toast.show({ icon: 'fail', content: '邀请失败，请检查用户 ID 和权限' });
    } finally { setBusy(false); }
  };
  const leave = async () => {
    if (!client) return;
    const confirmed = await Dialog.confirm({ content: `确定离开“${roomTitle(room)}”吗？`, confirmText: '离开房间' });
    if (!confirmed) return;
    try { await client.leave(room.roomId); close(); } catch { Toast.show({ icon: 'fail', content: '离开房间失败' }); }
  };
  const saveRoomDetails = async () => {
    if (!client || !name.trim()) return;
    setBusy(true);
    try {
      await client.sendStateEvent(room.roomId, 'm.room.name' as any, { name: name.trim() });
      await client.sendStateEvent(room.roomId, 'm.room.topic' as any, { topic: topic.trim() });
      Toast.show({ icon: 'success', content: '房间资料已更新' });
    } catch { Toast.show({ icon: 'fail', content: '无法更新房间资料，请检查房间权限' }); }
    finally { setBusy(false); }
  };
  return (
    <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}>
      <section className="new-chat-panel">
        <div className="sheet-handle" /><h2>房间操作</h2>
        <Form layout="vertical" requiredMarkStyle="none"><Form.Item label="房间名称"><Input value={name} onChange={setName} clearable /></Form.Item><Form.Item label="房间话题"><Input value={topic} onChange={setTopic} clearable /></Form.Item></Form>
        <Button block fill="outline" loading={busy} onClick={saveRoomDetails}>保存房间资料</Button>
        <Form layout="vertical" requiredMarkStyle="none"><Form.Item label="邀请成员"><Input value={memberId} onChange={setMemberId} placeholder="@alice:mtx01.cc" clearable /></Form.Item></Form>
        <Button block color="primary" loading={busy} onClick={invite}>发送邀请</Button>
        <Button block fill="none" onClick={() => { close(); openMembers(); }}>查看成员与权限</Button>
        <Button block color="danger" fill="none" className="leave-room-button" onClick={leave}>离开房间</Button>
      </section>
    </Popup>
  );
}

function RoomMembersPopup({ room, visible, close }: { room: Room; visible: boolean; close: () => void }) {
  const { session, revision } = useMatrix();
  const [keyword, setKeyword] = useState('');
  const members = useMemo(() => room.getMembers()
    .filter((member) => member.membership === 'join' || member.membership === 'invite')
    .filter((member) => `${member.name} ${member.userId}`.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
    .sort((a, b) => (a.userId === session?.userId ? -1 : 0) - (b.userId === session?.userId ? -1 : 0)), [keyword, revision, room, session?.userId]);
  return <Popup visible={visible} onMaskClick={close} position="right" bodyStyle={{ width: '86vw', maxWidth: 380 }}><section className="members-panel"><NavBar onBack={close}>成员</NavBar><div className="members-panel-body"><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索成员" /><p className="members-count">{members.length} 位成员</p><List>{members.map((member) => <List.Item key={member.userId} prefix={<div className="member-avatar">{initials(member.name || member.userId)}</div>} description={member.userId} extra={member.userId === session?.userId ? '我' : member.membership === 'invite' ? '已邀请' : undefined}>{member.name || member.userId}</List.Item>)}</List></div></section></Popup>;
}

function PinnedMessagesPopup({ room, visible, close, openEvent }: { room: Room; visible: boolean; close: () => void; openEvent: (eventId: string) => void }) {
  const { revision } = useMatrix();
  const pinnedIds = useMemo(() => {
    const content = room.currentState.getStateEvents('m.room.pinned_events', '')?.getContent() as { pinned?: unknown } | undefined;
    return Array.isArray(content?.pinned) ? content.pinned.filter((id): id is string => typeof id === 'string') : [];
  }, [revision, room]);
  const timeline = room.getUnfilteredTimelineSet();
  return <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>置顶消息</h2><div className="pinned-list">{pinnedIds.map((id) => {
    const event = timeline.findEventById(id);
    return <button key={id} type="button" onClick={() => { close(); openEvent(id); }}><b>{event?.sender?.name ?? event?.getSender() ?? '历史消息'}</b><span>{event ? eventText(event) : '点按定位此条历史消息'}</span></button>;
  })}{pinnedIds.length === 0 && <Empty description="暂无置顶消息" />}</div></section></Popup>;
}

function ForwardMessagePopup({ event, sourceRoomId, close }: { event?: MatrixEvent; sourceRoomId: string; close: () => void }) {
  const { client, revision } = useMatrix();
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const rooms = useMemo(() => client?.getRooms().filter((room) => room.roomId !== sourceRoomId && room.getMyMembership() === 'join') ?? [], [client, revision, sourceRoomId]);
  if (!event || !client) return null;
  const forward = async () => {
    if (targets.length === 0) { Toast.show({ content: '请选择至少一个目标会话' }); return; }
    setBusy(true);
    try {
      const content = sanitizedForwardContent(event.getContent());
      // Matrix reactions/edits are relations, not stand-alone messages. Only forward content
      // events and use sendMessage so encrypted target rooms are handled by the SDK.
      if (event.getType() === 'm.sticker') {
        await Promise.all(targets.map((roomId) => client.sendEvent(roomId, 'm.sticker' as any, content)));
      } else if (event.getType() === 'm.room.message') {
        await Promise.all(targets.map((roomId) => client.sendMessage(roomId, content as any)));
      } else {
        throw new Error('该事件类型不能转发');
      }
      Toast.show({ icon: 'success', content: `已转发到 ${targets.length} 个会话` }); close();
    } catch { Toast.show({ icon: 'fail', content: '转发失败，请检查目标房间权限' }); } finally { setBusy(false); }
  };
  return <Popup visible onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>转发消息</h2><div className="forward-list">{rooms.map((room) => <button key={room.roomId} className={targets.includes(room.roomId) ? 'selected' : ''} onClick={() => setTargets((value) => value.includes(room.roomId) ? value.filter((id) => id !== room.roomId) : [...value, room.roomId])} type="button"><RoomAvatar room={room} /><span>{roomTitle(room)}</span><b>{targets.includes(room.roomId) ? '✓' : ''}</b></button>)}</div><Button block color="primary" loading={busy} onClick={forward}>转发</Button></section></Popup>;
}

function ChatPage({ roomId, close }: { roomId: string; close: () => void }) {
  const { client, session, revision } = useMatrix();
  const [text, setText] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replyTo, setReplyTo] = useState<MatrixEvent>();
  const [editing, setEditing] = useState<MatrixEvent>();
  const [activeEvent, setActiveEvent] = useState<MatrixEvent>();
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [cryptoOpen, setCryptoOpen] = useState(false);
  const [forwardEvent, setForwardEvent] = useState<MatrixEvent>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverMatches, setServerMatches] = useState<ServerSearchItem[]>([]);
  const [searchingServer, setSearchingServer] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactionEvent, setReactionEvent] = useState<MatrixEvent>();
  const eventNodes = useRef<Record<string, HTMLElement | null>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  const room = client?.getRoom(roomId);
  const events = useMemo(
    () => room?.getLiveTimeline().getEvents().filter((event) => event.getType() === 'm.room.message' || event.getType() === 'm.sticker' || event.isDecryptionFailure()) ?? [],
    [room, revision]
  );
  useEffect(() => {
    const latest = events.at(-1);
    if (client && latest && !latest.isDecryptionFailure()) void client.sendReadReceipt(latest).catch(() => undefined);
  }, [client, events, revision]);
  if (!client || !room) return null;
  const searchMatches = searchQuery.trim() ? events.filter((event) => eventText(event).toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())).slice(-30) : [];
  const emojis = Array.from(new Set([...recentEmoji(client), ...QUICK_EMOJIS]));

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      if (editing?.getId()) {
        await client.sendEvent(room.roomId, 'm.room.message' as any, {
          msgtype: MsgType.Text,
          body: `* ${body}`,
          'm.new_content': { msgtype: MsgType.Text, body },
          'm.relates_to': { rel_type: 'm.replace', event_id: editing.getId() },
        });
        setEditing(undefined);
      } else if (replyTo?.getId()) {
        await client.sendEvent(room.roomId, 'm.room.message' as any, {
          msgtype: MsgType.Text,
          body,
          'm.relates_to': { 'm.in_reply_to': { event_id: replyTo.getId() } },
        });
        setReplyTo(undefined);
      } else {
        await client.sendTextMessage(room.roomId, body);
      }
    } catch {
      setText(body);
      Toast.show({ icon: 'fail', content: '消息发送失败，请检查网络' });
    }
  };

  const reactToEvent = async (event: MatrixEvent) => {
    if (!event.getId()) return;
    try {
      await client.sendEvent(room.roomId, 'm.reaction' as any, {
        'm.relates_to': { rel_type: 'm.annotation', event_id: event.getId(), key: '👍' },
      });
    } catch {
      Toast.show({ icon: 'fail', content: '添加反应失败' });
    }
  };

  const applyEmoji = async (emoji: string) => {
    setText((value) => `${value}${emoji}`);
    setEmojiOpen(false);
    try { await saveRecentEmoji(client, emoji); } catch { /* Account data is optional; sending must stay available. */ }
  };

  const addReaction = async (emoji: string) => {
    if (!reactionEvent?.getId()) return;
    try {
      await client.sendEvent(room.roomId, 'm.reaction' as any, {
        'm.relates_to': { rel_type: 'm.annotation', event_id: reactionEvent.getId(), key: emoji },
      });
      await saveRecentEmoji(client, emoji).catch(() => undefined);
      setReactionEvent(undefined);
    } catch { Toast.show({ icon: 'fail', content: '添加表情反应失败' }); }
  };

  const searchServer = async () => {
    const term = searchQuery.trim();
    if (!term) return;
    setSearchingServer(true);
    try {
      const response = await client.search({
        body: {
          search_categories: {
            room_events: {
              search_term: term,
              order_by: 'recent' as any,
              filter: { limit: 30, rooms: [room.roomId] },
              event_context: { before_limit: 0, after_limit: 0, include_profile: false },
            },
          },
        },
      });
      const results = response.search_categories.room_events.results ?? [];
      setServerMatches(results.map(({ result }) => ({
        eventId: result.event_id,
        roomId: result.room_id,
        sender: result.sender,
        body: typeof result.content?.body === 'string' ? result.content.body : '[非文本消息]',
        timestamp: result.origin_server_ts,
      })));
    } catch {
      Toast.show({ icon: 'fail', content: '服务器搜索失败，已保留本地结果' });
      setServerMatches([]);
    } finally { setSearchingServer(false); }
  };

  const openSearchResult = async (item: ServerSearchItem) => {
    try {
      await client.getEventTimeline(room.getUnfilteredTimelineSet(), item.eventId);
      window.setTimeout(() => eventNodes.current[item.eventId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      setSearchOpen(false);
    } catch { Toast.show({ icon: 'fail', content: '无法定位这条历史消息' }); }
  };

  const speakEvent = (event: MatrixEvent) => {
    const body = event.getContent().body;
    if (typeof body !== 'string' || !body.trim()) return;
    if (!('speechSynthesis' in window)) { Toast.show({ content: '当前设备不支持文本朗读' }); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(body);
    utterance.lang = 'zh-CN';
    window.speechSynthesis.speak(utterance);
    Toast.show({ content: '正在朗读，点其他消息可切换' });
  };

  const scrollToEvent = async (eventId: string) => {
    try {
      await client.getEventTimeline(room.getUnfilteredTimelineSet(), eventId);
      window.setTimeout(() => eventNodes.current[eventId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    } catch { Toast.show({ icon: 'fail', content: '无法定位这条历史消息' }); }
  };

  const togglePinned = async (event: MatrixEvent) => {
    const eventId = event.getId();
    if (!eventId) return;
    const state = room.currentState.getStateEvents('m.room.pinned_events', '')?.getContent() as { pinned?: unknown } | undefined;
    const pinned = Array.isArray(state?.pinned) ? state.pinned.filter((id): id is string => typeof id === 'string') : [];
    const included = pinned.includes(eventId);
    try {
      await client.sendStateEvent(room.roomId, 'm.room.pinned_events' as any, { pinned: included ? pinned.filter((id) => id !== eventId) : [...pinned, eventId] });
      Toast.show({ icon: 'success', content: included ? '已取消置顶' : '已置顶消息' });
    } catch { Toast.show({ icon: 'fail', content: '无法更新置顶消息，请检查房间权限' }); }
  };

  const redactEvent = async (event: MatrixEvent) => {
    if (!event.getId()) return;
    const confirmed = await Dialog.confirm({ content: '撤回后其他成员将无法查看该消息。', confirmText: '撤回' });
    if (!confirmed) return;
    try {
      await client.redactEvent(room.roomId, event.getId()!);
    } catch {
      Toast.show({ icon: 'fail', content: '撤回失败' });
    }
  };
  const favoriteEvent = async (event: MatrixEvent) => {
    try {
      const added = await toggleFavoriteItem(client, room, event);
      Toast.show({ icon: 'success', content: added ? '已收藏消息' : '已取消收藏' });
    } catch (cause) { Toast.show({ icon: 'fail', content: cause instanceof Error ? cause.message : '收藏失败' }); }
  };

  const loadOlderMessages = async () => {
    setLoadingHistory(true);
    try {
      await client.scrollback(room, 30);
    } catch {
      Toast.show({ icon: 'fail', content: '历史消息加载失败' });
    } finally {
      setLoadingHistory(false);
    }
  };

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>, sticker = false) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const toast = Toast.show({ icon: 'loading', content: '正在上传…', duration: 0 });
    try {
      const encrypted = room.hasEncryptionStateEvent();
      const encryptedAttachment = encrypted ? await encryptAttachment(await file.arrayBuffer()) : undefined;
      const uploadFile = encryptedAttachment
        ? new File([encryptedAttachment.data], file.name, { type: file.type || 'application/octet-stream' })
        : file;
      const response = await client.uploadContent(uploadFile, { name: file.name, type: uploadFile.type });
      const mediaLocation = encryptedAttachment
        ? { file: { ...encryptedAttachment.info, url: response.content_uri } }
        : { url: response.content_uri };
      if (sticker) {
        await client.sendEvent(room.roomId, 'm.sticker' as any, { body: file.name, info: { mimetype: file.type, size: file.size }, ...mediaLocation });
      } else {
        await client.sendEvent(room.roomId, 'm.room.message' as any, {
          msgtype: file.type.startsWith('image/') ? MsgType.Image : file.type.startsWith('audio/') ? MsgType.Audio : file.type.startsWith('video/') ? MsgType.Video : MsgType.File,
          body: file.name,
          info: { mimetype: file.type, size: file.size },
          ...mediaLocation,
        });
      }
    } catch {
      Toast.show({ icon: 'fail', content: '文件发送失败，请检查网络或服务器限制' });
    } finally {
      toast.close();
    }
  };

  return (
    <main className="chat-page">
      <NavBar back="消息" onBack={close} right={<span className="chat-header-actions"><button className="plain-icon pin-header-button" type="button" aria-label="置顶消息" onClick={() => setPinnedOpen(true)}>⌑</button><button className="plain-icon" type="button" onClick={() => setSearchOpen(true)}><SearchOutline /></button><button className="plain-icon" type="button" onClick={() => setRoomMenuOpen(true)}><MoreOutline /></button></span>}>
        <span className="chat-title">{roomTitle(room)}</span>
      </NavBar>
      {room.hasEncryptionStateEvent() && <div className="secure-banner">⌁ 此会话已启用端到端加密</div>}
      <div className="message-scroller">
        <div className="history-action"><Button size="mini" fill="none" loading={loadingHistory} onClick={loadOlderMessages}>加载更早消息</Button></div>
        {events.length === 0 && <Empty description="和大家打个招呼吧" />}
        {events.map((event) => {
          const mine = event.getSender() === session?.userId;
          const cannotDecrypt = event.isDecryptionFailure();
          return (
            <article ref={(node) => { const id = event.getId(); if (id) eventNodes.current[id] = node; }} className={`message ${mine ? 'mine' : ''}`} key={event.getId() ?? `${event.getTs()}-${event.getSender()}`}>
              {!mine && <SenderAvatar event={event} />}
              <div className="message-content">
                {!mine && <p className="sender-name">{event.sender?.name ?? event.getSender()}</p>}
                {(() => {
                  const relation = event.getContent()['m.relates_to'] as { 'm.in_reply_to'?: { event_id?: string } } | undefined;
                  const replyId = relation?.['m.in_reply_to']?.event_id;
                  const replied = replyId ? room.getUnfilteredTimelineSet().findEventById(replyId) : undefined;
                  return replyId ? <button type="button" className="reply-preview" onClick={() => void scrollToEvent(replyId)}><b>{replied?.sender?.name ?? replied?.getSender() ?? '回复消息'}</b><span>{replied ? eventText(replied) : '点按定位原消息'}</span></button> : null;
                })()}
                {cannotDecrypt ? <div className="bubble decrypt-failure">无法解密此消息。<Button size="mini" fill="none" onClick={() => setCryptoOpen(true)}>恢复密钥</Button></div> : <MatrixMessageBody event={event} client={client} accessToken={session?.accessToken} />}
                <time>{displayTime(event.getTs())}</time>
                {!cannotDecrypt && <AggregatedReactions room={room} event={event} />}
              </div>
              <button className="message-action" onClick={() => setActiveEvent(event)} type="button" aria-label="消息操作">⋯</button>
            </article>
          );
        })}
      </div>
      <footer className="composer">
        {(replyTo || editing) && <div className="composer-context"><span>{editing ? '正在编辑消息' : `回复 ${replyTo?.sender?.name ?? replyTo?.getSender()}`}</span><button type="button" onClick={() => { setReplyTo(undefined); setEditing(undefined); }}>×</button></div>}
        <input ref={fileInput} className="file-input" type="file" onChange={uploadFile} />
        <input ref={stickerInput} className="file-input" type="file" accept="image/*" onChange={(event) => void uploadFile(event, true)} />
        <button className="attach-button" onClick={() => fileInput.current?.click()} type="button" aria-label="发送图片或文件">＋</button>
        <button className="sticker-button" onClick={() => stickerInput.current?.click()} type="button" aria-label="发送贴纸">◇</button>
        <button className="emoji-button" onClick={() => setEmojiOpen((open) => !open)} type="button" aria-label="表情">☺</button>
        <TextArea value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="说点什么…" />
        <button className="send-button" onClick={send} type="button" aria-label="发送消息"><SendOutline /></button>
      </footer>
      <Popup visible={!!activeEvent} onMaskClick={() => setActiveEvent(undefined)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}>
        <section className="message-menu">
          <Button block fill="none" onClick={() => { if (activeEvent) { setReplyTo(activeEvent); setActiveEvent(undefined); } }}>回复</Button>
          <Button block fill="none" onClick={() => { if (activeEvent) { setReactionEvent(activeEvent); setActiveEvent(undefined); } }}>添加表情反应</Button>
          {activeEvent?.getContent().msgtype === MsgType.Text && <Button block fill="none" onClick={() => { if (activeEvent) speakEvent(activeEvent); setActiveEvent(undefined); }}>朗读文本</Button>}
          <Button block fill="none" onClick={() => { if (activeEvent) { void favoriteEvent(activeEvent); setActiveEvent(undefined); } }}>收藏消息</Button>
          <Button block fill="none" onClick={() => { if (activeEvent) { setForwardEvent(activeEvent); setActiveEvent(undefined); } }}>转发消息</Button>
          <Button block fill="none" onClick={() => { if (activeEvent) { void togglePinned(activeEvent); setActiveEvent(undefined); } }}>置顶/取消置顶</Button>
          {activeEvent?.getSender() === session?.userId && <Button block fill="none" onClick={() => { const body = activeEvent!.getContent().body; setText(typeof body === 'string' ? body : ''); setEditing(activeEvent!); setActiveEvent(undefined); }}>编辑</Button>}
          {activeEvent?.getSender() === session?.userId && <Button block fill="none" color="danger" onClick={() => { if (activeEvent) void redactEvent(activeEvent); setActiveEvent(undefined); }}>撤回</Button>}
        </section>
      </Popup>
      <RoomMenu room={room} visible={roomMenuOpen} close={() => setRoomMenuOpen(false)} openMembers={() => setMembersOpen(true)} />
      <RoomMembersPopup room={room} visible={membersOpen} close={() => setMembersOpen(false)} />
      <PinnedMessagesPopup room={room} visible={pinnedOpen} close={() => setPinnedOpen(false)} openEvent={(eventId) => void scrollToEvent(eventId)} />
      <CryptoRecoveryPopup visible={cryptoOpen} close={() => setCryptoOpen(false)} />
      <ForwardMessagePopup event={forwardEvent} sourceRoomId={room.roomId} close={() => setForwardEvent(undefined)} />
      <Popup visible={emojiOpen} onMaskClick={() => setEmojiOpen(false)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="emoji-panel"><div className="sheet-handle" /><h2>表情</h2><div className="emoji-grid">{emojis.map((emoji) => <button key={emoji} type="button" onClick={() => void applyEmoji(emoji)}>{emoji}</button>)}</div></section></Popup>
      <Popup visible={!!reactionEvent} onMaskClick={() => setReactionEvent(undefined)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="emoji-panel"><div className="sheet-handle" /><h2>添加表情反应</h2><div className="emoji-grid">{emojis.map((emoji) => <button key={emoji} type="button" onClick={() => void addReaction(emoji)}>{emoji}</button>)}</div></section></Popup>
      <Popup visible={searchOpen} onMaskClick={() => setSearchOpen(false)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}><section className="new-chat-panel"><div className="sheet-handle" /><h2>搜索消息</h2><div className="search-input-row"><Input value={searchQuery} onChange={(value) => { setSearchQuery(value); setServerMatches([]); }} placeholder="输入关键词" clearable /><Button size="small" color="primary" loading={searchingServer} onClick={() => void searchServer()}>全量搜索</Button></div><p className="search-hint">本地结果即时显示；“全量搜索”会查询服务器历史记录。</p><div className="search-results">{searchMatches.map((event) => <button key={`local-${event.getId()}`} type="button" onClick={() => { const id = event.getId(); if (id) eventNodes.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setSearchOpen(false); }}><b>{event.sender?.name ?? event.getSender()}</b><span>{eventText(event)}</span></button>)}{serverMatches.map((item) => <button key={`server-${item.eventId}`} type="button" onClick={() => void openSearchResult(item)}><b>{item.sender ?? 'Matrix 用户'} · {displayTime(item.timestamp)}</b><span>{item.body}</span></button>)}{searchQuery && searchMatches.length === 0 && serverMatches.length === 0 && !searchingServer && <p>没有匹配结果</p>}</div></section></Popup>
    </main>
  );
}

function AppShell() {
  const { state, error, client } = useMatrix();
  const [activeTab, setActiveTab] = useState<TabKey>('chats');
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [verification, setVerification] = useState<VerificationRequest>();

  useEffect(() => {
    if (!client?.getCrypto()) return undefined;
    const receive = (request: VerificationRequest) => setVerification(request);
    client.on(CryptoEvent.VerificationRequestReceived, receive);
    return () => { client.removeListener(CryptoEvent.VerificationRequestReceived, receive); };
  }, [client]);

  useEffect(() => {
    let removed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener('backButton', () => {
      if (activeRoomId) {
        setActiveRoomId(undefined);
        return;
      }
      if (newConversationOpen) setNewConversationOpen(false);
    }).then((handle) => {
      if (removed) void handle.remove();
      else listener = handle;
    });
    return () => { removed = true; if (listener) void listener.remove(); };
  }, [activeRoomId, newConversationOpen]);

  if (state === 'loading' || state === 'connecting') {
    return <div className="splash"><div className="brand-seal small">笺</div><DotLoading color="primary" /><p>{state === 'connecting' ? '正在连接 Matrix…' : '正在准备青笺…'}</p></div>;
  }
  if (state === 'signed-out') return <LoginPage />;
  if (state === 'error') return <ErrorBlock status="default" title="暂时无法连接" description={error} fullPage />;
  if (activeRoomId) {
    const activeRoom = client?.getRoom(activeRoomId);
    return <>{activeRoom && isSpaceRoom(activeRoom)
      ? <SpacePage space={activeRoom} close={() => setActiveRoomId(undefined)} openRoom={setActiveRoomId} />
      : <ChatPage roomId={activeRoomId} close={() => setActiveRoomId(undefined)} />}
      <DeviceVerificationPopup request={verification} close={() => setVerification(undefined)} /></>;
  }

  const pages: Record<TabKey, React.ReactNode> = {
    chats: <ChatsPage openRoom={setActiveRoomId} openNewChat={() => setNewConversationOpen(true)} />,
    contacts: <ContactsPage openRoom={setActiveRoomId} openNewChat={() => setNewConversationOpen(true)} />,
    discover: <DiscoverPage openRoom={setActiveRoomId} />,
    profile: <ProfilePage onRequestVerification={setVerification} openRoom={setActiveRoomId} />,
  };
  return (
    <main className="app-shell">
      <div className="app-content">{pages[activeTab]}</div>
      <NewConversationPopup
        visible={newConversationOpen}
        close={() => setNewConversationOpen(false)}
        openRoom={setActiveRoomId}
      />
      <nav className="bottom-nav">
        <TabBar activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)}>
          <TabBar.Item key="chats" icon={<MessageOutline />} title="消息" />
          <TabBar.Item key="contacts" icon={<UserOutline />} title="联系人" />
          <TabBar.Item key="discover" icon={<CompassOutline />} title="发现" />
          <TabBar.Item key="profile" icon={<SetOutline />} title="我的" />
        </TabBar>
      </nav>
      <DeviceVerificationPopup request={verification} close={() => setVerification(undefined)} />
    </main>
  );
}

export function App() {
  return <MatrixProvider><AppShell /></MatrixProvider>;
}
