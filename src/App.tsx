import { useMemo, useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MsgType, NotificationCountType } from 'matrix-js-sdk';
import {
  Badge,
  Button,
  Dialog,
  DotLoading,
  Empty,
  ErrorBlock,
  Form,
  InfiniteScroll,
  Input,
  List,
  NavBar,
  PullToRefresh,
  SearchBar,
  Space,
  TabBar,
  TextArea,
  Toast,
} from 'antd-mobile';
import {
  CompassOutline,
  LeftOutline,
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

function LoginPage() {
  const { login, error, state } = useMatrix();
  const [baseUrl, setBaseUrl] = useState('https://matrix.org');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const submitting = state === 'connecting';

  const submit = async () => {
    if (!baseUrl || !user || !password) {
      Toast.show({ content: '请完整填写服务器、账号和密码' });
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
      <section className="brand-panel">
        <div className="brand-seal">笺</div>
        <p className="eyebrow">QINGJIAN · MATRIX</p>
        <h1>把每一句话，<br />好好安放。</h1>
        <p className="brand-copy">青笺是一款为中文用户打造的简洁、安全 Matrix 聊天客户端。</p>
      </section>
      <section className="login-card">
        <div className="login-heading">
          <h2>登录</h2>
          <p>连接你的 Matrix 账号，继续会话。</p>
        </div>
        <Form layout="vertical" requiredMarkStyle="none">
          <Form.Item label="服务器地址">
            <Input value={baseUrl} onChange={setBaseUrl} placeholder="https://matrix.org" clearable />
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
          进入青笺
        </Button>
        <p className="login-tip">首次登录会创建一台“青笺 Android”设备；加密房间可在登录后完成验证或恢复密钥。</p>
      </section>
    </main>
  );
}

function RoomAvatar({ room }: { room: Room }) {
  return <div className="room-avatar">{initials(roomTitle(room))}</div>;
}

function ChatsPage({ openRoom }: { openRoom: (roomId: string) => void }) {
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
        <button className="round-button" type="button" aria-label="更多菜单"><MoreOutline /></button>
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

function DiscoverPage() {
  return (
    <section className="tab-page">
      <header className="page-header"><div><p className="eyebrow">EXPLORE</p><h2>发现</h2></div></header>
      <div className="discover-hero"><p>今天，和世界保持一点连接。</p><strong>探索你的 Matrix 空间</strong></div>
      <div className="discover-grid">
        <article><span>◌</span><strong>公共房间</strong><p>发现同好社区</p></article>
        <article><span>◇</span><strong>我的空间</strong><p>整理重要会话</p></article>
        <article><span>⌁</span><strong>邀请</strong><p>查看等待处理的邀请</p></article>
        <article><span>◎</span><strong>收藏</strong><p>回看重要消息</p></article>
      </div>
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

function ChatPage({ roomId, close }: { roomId: string; close: () => void }) {
  const { client, session, revision } = useMatrix();
  const [text, setText] = useState('');
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
      await client.sendTextMessage(room.roomId, body);
    } catch {
      setText(body);
      Toast.show({ icon: 'fail', content: '消息发送失败，请检查网络' });
    }
  };

  return (
    <main className="chat-page">
      <NavBar back="消息" onBack={close} right={<button className="plain-icon" type="button"><MoreOutline /></button>}>
        <span className="chat-title">{roomTitle(room)}</span>
      </NavBar>
      {room.hasEncryptionStateEvent() && <div className="secure-banner">⌁ 此会话已启用端到端加密</div>}
      <div className="message-scroller">
        {events.length === 0 && <Empty description="和大家打个招呼吧" />}
        {events.map((event) => {
          const mine = event.getSender() === session?.userId;
          const content = event.getContent();
          return (
            <article className={`message ${mine ? 'mine' : ''}`} key={event.getId() ?? `${event.getTs()}-${event.getSender()}`}>
              {!mine && <div className="message-avatar">{initials(event.getSender() ?? '?')}</div>}
              <div>
                {!mine && <p className="sender-name">{event.sender?.name ?? event.getSender()}</p>}
                <div className="bubble">{typeof content.body === 'string' ? content.body : '[暂不支持的消息]'}</div>
                <time>{displayTime(event.getTs())}</time>
              </div>
            </article>
          );
        })}
        <InfiniteScroll loadMore={async () => { await client.scrollback(room, 30); }} hasMore={false} />
      </div>
      <footer className="composer">
        <TextArea value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="说点什么…" />
        <button className="send-button" onClick={send} type="button" aria-label="发送消息"><SendOutline /></button>
      </footer>
    </main>
  );
}

function AppShell() {
  const { state, error } = useMatrix();
  const [activeTab, setActiveTab] = useState<TabKey>('chats');
  const [activeRoomId, setActiveRoomId] = useState<string>();

  if (state === 'loading' || state === 'connecting') {
    return <div className="splash"><div className="brand-seal small">笺</div><DotLoading color="primary" /><p>{state === 'connecting' ? '正在连接 Matrix…' : '正在准备青笺…'}</p></div>;
  }
  if (state === 'signed-out') return <LoginPage />;
  if (state === 'error') return <ErrorBlock status="default" title="暂时无法连接" description={error} fullPage />;
  if (activeRoomId) return <ChatPage roomId={activeRoomId} close={() => setActiveRoomId(undefined)} />;

  const pages: Record<TabKey, React.ReactNode> = {
    chats: <ChatsPage openRoom={setActiveRoomId} />,
    contacts: <ContactsPage />,
    discover: <DiscoverPage />,
    profile: <ProfilePage />,
  };
  return (
    <main className="app-shell">
      <div className="app-content">{pages[activeTab]}</div>
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
