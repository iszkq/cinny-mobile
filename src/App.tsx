import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MsgType, NotificationCountType, Preset } from 'matrix-js-sdk';
import { App as CapacitorApp } from '@capacitor/app';
import {
  Badge,
  Button,
  Dialog,
  DotLoading,
  Empty,
  ErrorBlock,
  Form,
  ImageViewer,
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
  SendOutline,
  SetOutline,
  UserOutline,
} from 'antd-mobile-icons';
import { MatrixProvider, useMatrix } from './matrix/MatrixProvider';

type TabKey = 'chats' | 'contacts' | 'discover' | 'profile';

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

const eventText = (event?: MatrixEvent): string => {
  if (!event) return '开始一段新的对话';
  if (event.getType() !== 'm.room.message') return '有新的房间动态';
  const content = event.getContent();
  if (content.msgtype === MsgType.Image) return '[图片]';
  if (content.msgtype === MsgType.File) return '[文件]';
  if (content.msgtype === MsgType.Audio) return '[语音]';
  return typeof content.body === 'string' ? content.body : '[消息]';
};

const initials = (name: string): string => name.trim().slice(0, 1).toUpperCase() || 'Q';

const useAuthenticatedMediaUrl = (src: string | null, accessToken?: string): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    let disposed = false;
    let objectUrl: string | undefined;
    void fetch(src, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined })
      .then((response) => { if (!response.ok) throw new Error('媒体请求失败'); return response.blob(); })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!disposed) setUrl(objectUrl);
      })
      .catch(() => { if (!disposed) setUrl(null); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [accessToken, src]);
  return url;
};

function MessageBody({ event, client, accessToken }: { event: MatrixEvent; client: NonNullable<ReturnType<typeof useMatrix>['client']>; accessToken?: string }) {
  const content = event.getContent();
  const mediaSource = typeof content.url === 'string'
    ? client.mxcUrlToHttp(content.url, 960, 960, 'scale', undefined, false, true)
    : null;
  const mediaUrl = useAuthenticatedMediaUrl(mediaSource, accessToken);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = content.msgtype === MsgType.Image;
  const isFile = content.msgtype === MsgType.File;
  if (isImage) return mediaUrl ? <>
    <button className="bubble image-bubble" type="button" onClick={() => setPreviewOpen(true)} aria-label="预览图片"><img src={mediaUrl} alt={typeof content.body === 'string' ? content.body : '图片'} /></button>
    <ImageViewer image={mediaUrl} visible={previewOpen} onClose={() => setPreviewOpen(false)} />
  </> : <div className="bubble media-loading">正在加载图片…</div>;
  if (isFile) return mediaUrl ? <div className="bubble"><a href={mediaUrl} download={typeof content.body === 'string' ? content.body : undefined}>附件：{typeof content.body === 'string' ? content.body : '下载文件'}</a></div> : <div className="bubble media-loading">正在加载附件…</div>;
  return <div className="bubble">{typeof content.body === 'string' ? content.body : '[暂不支持的消息]'}</div>;
}

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
  const imageUrl = useAuthenticatedMediaUrl(source, session?.accessToken);
  return imageUrl ? <img className="room-avatar" src={imageUrl} alt="" /> : <div className="room-avatar">{initials(roomTitle(room))}</div>;
}

function SenderAvatar({ event }: { event: MatrixEvent }) {
  const { session } = useMatrix();
  const source = session && event.sender
    ? event.sender.getAvatarUrl(session.baseUrl, 64, 64, 'crop', undefined, false, true)
    : null;
  const imageUrl = useAuthenticatedMediaUrl(source, session?.accessToken);
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

type ConversationMode = 'direct' | 'group' | 'join';

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
    if (mode !== 'join' && memberIds.length === 0) {
      Toast.show({ content: '请输入至少一个 Matrix 用户 ID' });
      return;
    }
    if (mode === 'group' && !roomName.trim()) {
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
            ? { invite: memberIds, is_direct: true, preset: Preset.TrustedPrivateChat }
            : { name: roomName.trim(), invite: memberIds, preset: Preset.PrivateChat }
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
          <button className={mode === 'join' ? 'selected' : ''} onClick={() => setMode('join')} type="button">加入房间</button>
        </div>
        {mode === 'join' ? (
          <Form layout="vertical" requiredMarkStyle="none">
            <Form.Item label="房间 ID 或别名"><Input value={roomIdOrAlias} onChange={setRoomIdOrAlias} placeholder="!room:mtx01.cc 或 #room:mtx01.cc" clearable /></Form.Item>
          </Form>
        ) : (
          <Form layout="vertical" requiredMarkStyle="none">
            {mode === 'group' && <Form.Item label="群聊名称"><Input value={roomName} onChange={setRoomName} placeholder="例如：项目讨论组" clearable /></Form.Item>}
            <Form.Item label={mode === 'direct' ? '对方 Matrix ID' : '邀请成员'}>
              <Input value={members} onChange={setMembers} placeholder="@alice:mtx01.cc，多个用逗号分隔" clearable />
            </Form.Item>
          </Form>
        )}
        <Button block color="primary" size="large" loading={submitting} onClick={submit}>{mode === 'join' ? '加入房间' : '创建并进入'}</Button>
      </section>
    </Popup>
  );
}

function ContactsPage() {
  const { client, revision } = useMatrix();
  const rooms = useMemo(
    () => client?.getRooms().filter((room) => room.getMyMembership() === 'join').slice(0, 8) ?? [],
    [client, revision]
  );
  return (
    <section className="tab-page">
      <header className="page-header"><div><p className="eyebrow">PEOPLE</p><h2>联系人</h2></div></header>
      <div className="feature-card">
        <span className="feature-icon">✦</span>
        <div><strong>常用会话</strong><p>从已加入的房间中快速找到熟悉的人。</p></div>
      </div>
      <List className="soft-list" header="最近互动">
        {rooms.map((room) => <List.Item key={room.roomId} prefix={<RoomAvatar room={room} />}>{roomTitle(room)}</List.Item>)}
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
      <div className="discover-section-title"><span>公共房间</span><Button size="mini" fill="none" loading={loading} onClick={loadPublicRooms}>刷新</Button></div>
      <List className="soft-list public-rooms">
        {publicRooms.map((room) => <List.Item key={room.room_id} description={room.topic || `${room.num_joined_members ?? 0} 位成员`} extra={<Button size="mini" color="primary" onClick={() => void joinPublicRoom(room)}>加入</Button>}>{room.name || room.room_id}</List.Item>)}
        {!loading && publicRooms.length === 0 && <List.Item description="当前服务器没有公开房间，或目录功能未开启">暂无公共房间</List.Item>}
      </List>
    </section>
  );
}

function ProfilePage() {
  const { session, logout } = useMatrix();
  const performLogout = async () => {
    const confirmed = await Dialog.confirm({ content: '退出后可随时重新登录。确定要退出青笺吗？', confirmText: '退出登录' });
    if (confirmed) await logout();
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
        <List.Item description="验证设备、恢复密钥与会话安全">隐私与安全</List.Item>
        <List.Item description="青笺 Android · 0.1.0">关于青笺</List.Item>
      </List>
      <Button className="logout-button" block fill="none" color="danger" onClick={performLogout}>退出登录</Button>
    </section>
  );
}

function RoomMenu({ room, visible, close }: { room: Room; visible: boolean; close: () => void }) {
  const { client } = useMatrix();
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState(false);
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
  return (
    <Popup visible={visible} onMaskClick={close} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}>
      <section className="new-chat-panel">
        <div className="sheet-handle" /><h2>房间操作</h2>
        <Form layout="vertical" requiredMarkStyle="none"><Form.Item label="邀请成员"><Input value={memberId} onChange={setMemberId} placeholder="@alice:mtx01.cc" clearable /></Form.Item></Form>
        <Button block color="primary" loading={busy} onClick={invite}>发送邀请</Button>
        <Button block color="danger" fill="none" className="leave-room-button" onClick={leave}>离开房间</Button>
      </section>
    </Popup>
  );
}

function ChatPage({ roomId, close }: { roomId: string; close: () => void }) {
  const { client, session, revision } = useMatrix();
  const [text, setText] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replyTo, setReplyTo] = useState<MatrixEvent>();
  const [editing, setEditing] = useState<MatrixEvent>();
  const [activeEvent, setActiveEvent] = useState<MatrixEvent>();
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const room = client?.getRoom(roomId);
  const events = useMemo(
    () => room?.getLiveTimeline().getEvents().filter((event) => event.getType() === 'm.room.message') ?? [],
    [room, revision]
  );
  if (!client || !room) return null;

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

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const toast = Toast.show({ icon: 'loading', content: '正在上传…', duration: 0 });
    try {
      const response = await client.uploadContent(file, { name: file.name, type: file.type });
      await client.sendEvent(room.roomId, 'm.room.message' as any, {
        msgtype: file.type.startsWith('image/') ? MsgType.Image : MsgType.File,
        body: file.name,
        url: response.content_uri,
        info: { mimetype: file.type, size: file.size },
      });
    } catch {
      Toast.show({ icon: 'fail', content: '文件发送失败，请检查网络或服务器限制' });
    } finally {
      toast.close();
    }
  };

  return (
    <main className="chat-page">
      <NavBar back="消息" onBack={close} right={<button className="plain-icon" type="button" onClick={() => setRoomMenuOpen(true)}><MoreOutline /></button>}>
        <span className="chat-title">{roomTitle(room)}</span>
      </NavBar>
      {room.hasEncryptionStateEvent() && <div className="secure-banner">⌁ 此会话已启用端到端加密</div>}
      <div className="message-scroller">
        <div className="history-action"><Button size="mini" fill="none" loading={loadingHistory} onClick={loadOlderMessages}>加载更早消息</Button></div>
        {events.length === 0 && <Empty description="和大家打个招呼吧" />}
        {events.map((event) => {
          const mine = event.getSender() === session?.userId;
          return (
            <article className={`message ${mine ? 'mine' : ''}`} key={event.getId() ?? `${event.getTs()}-${event.getSender()}`}>
              {!mine && <SenderAvatar event={event} />}
              <div className="message-content">
                {!mine && <p className="sender-name">{event.sender?.name ?? event.getSender()}</p>}
                <MessageBody event={event} client={client} accessToken={session?.accessToken} />
                <time>{displayTime(event.getTs())}</time>
              </div>
              <button className="message-action" onClick={() => setActiveEvent(event)} type="button" aria-label="消息操作">⋯</button>
            </article>
          );
        })}
      </div>
      <footer className="composer">
        {(replyTo || editing) && <div className="composer-context"><span>{editing ? '正在编辑消息' : `回复 ${replyTo?.sender?.name ?? replyTo?.getSender()}`}</span><button type="button" onClick={() => { setReplyTo(undefined); setEditing(undefined); }}>×</button></div>}
        <input ref={fileInput} className="file-input" type="file" onChange={uploadFile} />
        <button className="attach-button" onClick={() => fileInput.current?.click()} type="button" aria-label="发送图片或文件">＋</button>
        <TextArea value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="说点什么…" />
        <button className="send-button" onClick={send} type="button" aria-label="发送消息"><SendOutline /></button>
      </footer>
      <Popup visible={!!activeEvent} onMaskClick={() => setActiveEvent(undefined)} position="bottom" bodyStyle={{ borderRadius: '18px 18px 0 0' }}>
        <section className="message-menu">
          <Button block fill="none" onClick={() => { if (activeEvent) { setReplyTo(activeEvent); setActiveEvent(undefined); } }}>回复</Button>
          <Button block fill="none" onClick={() => { if (activeEvent) { void reactToEvent(activeEvent); setActiveEvent(undefined); } }}>👍 添加反应</Button>
          {activeEvent?.getSender() === session?.userId && <Button block fill="none" onClick={() => { const body = activeEvent!.getContent().body; setText(typeof body === 'string' ? body : ''); setEditing(activeEvent!); setActiveEvent(undefined); }}>编辑</Button>}
          {activeEvent?.getSender() === session?.userId && <Button block fill="none" color="danger" onClick={() => { if (activeEvent) void redactEvent(activeEvent); setActiveEvent(undefined); }}>撤回</Button>}
        </section>
      </Popup>
      <RoomMenu room={room} visible={roomMenuOpen} close={() => setRoomMenuOpen(false)} />
    </main>
  );
}

function AppShell() {
  const { state, error } = useMatrix();
  const [activeTab, setActiveTab] = useState<TabKey>('chats');
  const [activeRoomId, setActiveRoomId] = useState<string>();
  const [newConversationOpen, setNewConversationOpen] = useState(false);

  if (state === 'loading' || state === 'connecting') {
    return <div className="splash"><div className="brand-seal small">笺</div><DotLoading color="primary" /><p>{state === 'connecting' ? '正在连接 Matrix…' : '正在准备青笺…'}</p></div>;
  }
  if (state === 'signed-out') return <LoginPage />;
  if (state === 'error') return <ErrorBlock status="default" title="暂时无法连接" description={error} fullPage />;
  if (activeRoomId) return <ChatPage roomId={activeRoomId} close={() => setActiveRoomId(undefined)} />;

  const pages: Record<TabKey, React.ReactNode> = {
    chats: <ChatsPage openRoom={setActiveRoomId} openNewChat={() => setNewConversationOpen(true)} />,
    contacts: <ContactsPage />,
    discover: <DiscoverPage openRoom={setActiveRoomId} />,
    profile: <ProfilePage />,
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
    </main>
  );
}

export function App() {
  return <MatrixProvider><AppShell /></MatrixProvider>;
}
