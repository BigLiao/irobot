# 🤖 iRobot - 网页行为监控系统

一个基于 Puppeteer 和 WebSocket 的实时网页行为监控系统，可以监控和记录网页中的所有 API 调用。

## 📋 项目结构

```
irobot/
├── packages/
│   ├── dashboard/          # Web服务器 + Vue前端界面
│   │   ├── server/         # Express + WebSocket服务器
│   │   └── src/            # Vue 3 前端应用
│   └── injector/           # Puppeteer启动器 + 监控脚本
│       └── src/
│           ├── index.ts    # Puppeteer启动逻辑
│           └── monitor.ts  # 浏览器注入脚本
└── pnpm-workspace.yaml     # Monorepo配置
```

## 🚀 快速开始

### 1. 安装依赖

```bash
# 跳过Chromium下载（使用系统Chrome）
PUPPETEER_SKIP_DOWNLOAD=true pnpm install
```

### 2. 构建项目

```bash
pnpm build
```

### 3. 启动服务

```bash
./start.sh
# 或
pnpm start
```

访问 `http://localhost:3000`

### 4. 开始监控

1. 在输入框输入URL（如：`https://www.baidu.com`）
2. 点击"开始监控"
3. 在打开的浏览器中进行操作
4. 实时查看Dashboard中的API调用

## 🔄 工作原理

```
用户输入URL → Dashboard前端 → WebSocket通知服务器
    ↓
服务器spawn启动Injector进程
    ↓
Puppeteer打开Chromium → 注入监控脚本
    ↓
拦截fetch/XHR → WebSocket上报 → Dashboard实时显示
```

### 核心功能

- ✅ 拦截并监控 Fetch API
- ✅ 拦截并监控 XMLHttpRequest
- ✅ 实时 WebSocket 双向通信
- ✅ 动态启动/停止监控
- ✅ 彩色分类日志展示

## 📦 常用命令

```bash
# 根目录命令
pnpm build              # 构建所有包
pnpm start              # 启动Dashboard服务器（生产模式）
pnpm dev:dashboard      # 前端开发模式（热更新）
pnpm dev:server         # 后端开发模式（自动重启）
pnpm dev                # 同时启动前后端开发模式
pnpm clean              # 清理构建产物

# Dashboard包（packages/dashboard）
pnpm dev                # Vite开发服务器
pnpm dev:server         # 服务器开发模式（自动重启）
pnpm build              # 构建前端
pnpm build:server       # 构建服务器
pnpm server             # 启动服务器

# Injector包（packages/injector）
pnpm build              # 构建
pnpm start [URL]        # 独立运行
```

## 🎨 监控数据类型

| 类型 | 颜色 | 说明 |
|------|------|------|
| FETCH_REQUEST | 蓝色 | Fetch请求（方法、URL、Headers） |
| FETCH_RESPONSE | 绿色 | Fetch响应（状态码、Headers） |
| FETCH_ERROR | 红色 | Fetch错误 |
| XHR_REQUEST | 橙色 | XHR请求 |
| XHR_RESPONSE | 浅绿 | XHR响应 |
| XHR_ERROR | 粉色 | XHR错误 |
| SYSTEM | 紫色 | 系统消息 |

## 🛠️ 技术栈

- **前端**: Vue 3 + TypeScript + Vite
- **后端**: Express + WebSocket (ws)
- **自动化**: Puppeteer
- **构建**: esbuild + TypeScript Compiler
- **包管理**: pnpm (Monorepo)

## 🔧 配置说明

### 使用系统Chrome（推荐）

如果跳过了Chromium下载，需要配置Chrome路径。编辑 `packages/injector/src/index.ts`：

```typescript
browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
  // executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
  // executablePath: '/usr/bin/google-chrome', // Linux
  // ...其他配置
});
```

### 修改端口

修改 `packages/dashboard/server/index.ts` 中的 `PORT` 常量（默认3000）。

## 🐛 常见问题

### Q: WebSocket连接失败
**A**: 确保Dashboard服务器正在运行，端口3000未被占用。

### Q: 浏览器启动失败
**A**: 检查Chrome路径配置，确保系统已安装Chrome浏览器。

### Q: 没有捕获到API调用
**A**: 检查浏览器控制台是否有 "✅ iRobot 监控脚本已加载" 消息。

### Q: Chromium下载失败
**A**: 使用 `PUPPETEER_SKIP_DOWNLOAD=true pnpm install` 并配置系统Chrome路径。

## 🔍 开发指南

### 开发模式（推荐）

```bash
# 方式1: 同时启动前后端开发服务器（推荐）
pnpm dev                  # 前端:5173 + 后端:3000 自动重启

# 方式2: 分别启动
# 终端1: 启动后端开发服务器（自动重启）
pnpm dev:server           # http://localhost:3000

# 终端2: 启动前端开发服务器（热更新）
pnpm dev:dashboard        # http://localhost:5173
```

### 修改前端界面

```bash
# 编辑 packages/dashboard/src/App.vue
# Vite会自动热更新，无需重启
```

### 修改后端服务器

```bash
# 编辑 packages/dashboard/server/index.ts
# tsx会自动检测并重启服务器
```

### 修改监控脚本

```bash
# 编辑 packages/injector/src/monitor.ts
pnpm build:injector       # 重新构建
# 然后在Dashboard中重新开始监控
```

### 添加新的监控功能

编辑 `packages/injector/src/monitor.ts`，例如监控WebSocket：

```typescript
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  sendMessage('WEBSOCKET_CREATED', { url });
  return new OriginalWebSocket(url, protocols);
};
```

## 📝 系统架构

### WebSocket端点

- `/dashboard` - Dashboard前端连接
- `/injector` - Injector进程连接

### 消息格式

```json
{
  "type": "FETCH_REQUEST|FETCH_RESPONSE|...",
  "data": { /* 监控数据 */ },
  "timestamp": "2025-11-13T10:00:00.000Z"
}
```

### 进程管理

```
Dashboard Server (主进程)
    ├── Express HTTP Server (端口3000)
    ├── WebSocket Server (/dashboard, /injector)
    └── Injector Process (spawn子进程)
        └── Puppeteer → Chromium → 目标页面 + 监控脚本
```

## ⚠️ 注意事项

1. **仅用于开发/测试**：不建议在生产环境使用
2. **性能影响**：监控脚本会轻微影响页面性能
3. **安全策略**：已禁用浏览器安全策略以便注入
4. **端口占用**：确保3000端口未被占用

## 🎯 测试示例

### 示例1：监控百度搜索

```bash
1. 启动服务：pnpm start
2. 访问：http://localhost:3000
3. 输入：https://www.baidu.com
4. 点击"开始监控"
5. 在浏览器中搜索任何内容
6. 观察Dashboard中的API调用
```

### 示例2：监控GitHub

```bash
输入：https://github.com
浏览仓库或搜索项目
查看捕获的API请求
```

## 🚀 未来扩展

- [ ] 请求/响应内容查看
- [ ] 历史记录持久化
- [ ] 多页面同时监控
- [ ] 性能指标监控
- [ ] 自定义Hook配置
- [ ] 导出监控数据

## 📄 许可证

ISC License

---

**开发时间**：2025-11-13  
**版本**：1.0.0  
**技术支持**：查看代码注释和控制台日志
