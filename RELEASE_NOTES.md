## 🦀 Agent Browser Recorder

Chrome 扩展：录制浏览器操作 → 生成 agent-browser 脚本 → 一键回放

### ✨ 核心功能

- 🎯 **Snapshot + @ref 策略** — 通过 `agent-browser snapshot -i --json` 定位元素，最可靠
- 🖱️ **全交互录制** — 点击、输入、选择、复选框、滚动、键盘、悬停、导航
- 📊 **表格数据提取** — 原生 `<table>` / ARIA 网格 / SPA 虚拟表格（Semi Design, Ant Design）
- 🌐 **跨标签页录制** — 新标签页和页面跳转自动继续录制
- ⚡ **3 种导出格式** — Node.js 脚本（推荐）/ Bash 脚本 / Batch JSON
- ▶️ **一键 Replay** — 保存脚本 + 自动复制运行命令
- 🔴 **视觉反馈** — 可拖拽 REC 指示器、点击高亮

### 📦 安装

```bash
git clone https://github.com/Jiaoma/agent-browser-recorder.git
cd agent-browser-recorder && bash build.sh
# Chrome → chrome://extensions → 开发者模式 → 加载已解压 → 选 build/
```

### 🎬 使用

1. 点击扩展图标 → **Record**
2. 正常操作页面
3. **Stop** → **⚡ Export .js** 或 **▶️ Replay**
4. `node recording.js` 运行脚本

### ✅ 已验证

- example.com 点击导航 ✅
- 群晖兼容性列表表格提取 ✅
- SPA 虚拟表格（Semi Design 风格）提取 ✅
- 跨标签页录制 ✅
- URL 含 & 参数正确传递 ✅
