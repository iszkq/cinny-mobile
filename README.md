# 青笺 Android

青笺是一个独立的 Matrix Android 客户端初版，使用 Ant Design Mobile 提供中文移动界面，使用 Capacitor 输出 Android APK。

## 已有能力

- Matrix 密码登录与设备创建（默认 Homeserver：`https://mtx01.cc`）
- 房间同步、会话列表、未读数与端到端加密状态标记
- 新建私聊、群聊与加入已有房间
- 房间消息浏览、加载早期消息、纯文本/图片/文件发送
- 中文移动端四栏导航：消息、联系人、发现、我的
- Capacitor Android 工程
- GitHub Actions 自动构建并上传 Debug APK

> 登录时请填写可从公网访问、已配置 TLS 证书的 `https://` Matrix 地址。App 会自动读取标准 `.well-known/matrix/client` 发现文件并连接真正的 Homeserver：例如填写默认的 `https://mtx01.cc`，实际会连接其声明的 `https://matrix.mtx01.cc`。Android 版本已启用 Capacitor 原生 HTTP，以避免 WebView 的跨域（CORS）限制。

## 本地开发（可选）

本地不必安装 Android 环境也能使用 GitHub Actions 构建 APK。若需要在本地调试网页界面：

```powershell
corepack enable
pnpm install
pnpm dev
```

若已安装 Android Studio、Android SDK 和 Java 17：

```powershell
pnpm android:sync
pnpm android:open
```

## 上传 GitHub 并云端构建 APK

在 GitHub 新建一个空仓库，例如 `qingjian-mobile`。然后在本目录执行：

```powershell
git init
git add .
git commit -m "feat: initialize Qingjian Android"
git branch -M main
git remote add origin https://github.com/你的用户名/qingjian-mobile.git
git push -u origin main
```

推送完成后，打开仓库的 **Actions** → **Build Android APK**。每次推送到 `main` 都会自动构建；构建成功后，在该工作流页面的 **Artifacts** 下载 `qingjian-android-debug-apk`，解压即可得到 `app-debug.apk`。

## 发布前必须补齐

当前版本是功能验证版，不应直接作为正式产品发布。正式发布前需要：

1. 使用 Android Keystore 签名 Release AAB/APK。
2. 配置 FCM 与 Matrix 推送网关，支持后台消息通知。
3. 将登录令牌从 Preferences 迁移至 Android Keystore 加密存储。
4. 完成加密设备验证、密钥备份恢复与完整的媒体下载管理。
5. 替换默认 Android 图标、包名 `com.qingjian.chat` 和“青笺”品牌文案。

## 许可证提醒

如果后续复制或改造 `cinny-dev` 的代码，请遵守其 AGPL-3.0-only 许可证要求。当前独立工程仅按 Matrix 协议接入服务端，并未直接复用原项目代码。
