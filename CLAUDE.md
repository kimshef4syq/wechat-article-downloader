# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

微信公众号文章下载工具，通过 Puppeteer 模拟浏览器自动化，获取公众号文章并保存为 Markdown 格式。

## 常用命令

```bash
# 安装依赖
npm install

# 登录微信公众号（需要扫码）
node src/index.js login

# 下载指定公众号的文章（默认10篇）
node src/index.js download <公众号名称>

# 下载指定数量的文章
node src/index.js download <公众号名称> -n 20

# 下载全部文章
node src/index.js download <公众号名称> --all

# 查看已下载的公众号列表
node src/index.js list

# 查看当前配置
node src/index.js config
```

## 架构说明

```
src/
├── index.js      # CLI入口，使用commander处理命令
├── wechat.js     # WeChatClient类，处理登录和文章获取
├── downloader.js # Downloader类，处理HTML转Markdown和保存
└── config.js     # 配置文件（超时、并发数、输出目录等）

articles/         # 下载的文章保存目录
data/            # 本地数据存储（已下载账号列表）
```

### 核心类

- **WeChatClient**: 管理浏览器会话，处理微信登录、搜索公众号、获取文章列表和内容
- **Downloader**: 将HTML转换为Markdown，处理文件名清理，保存文章到本地

### 文章获取流程

1. 启动浏览器，等待用户扫码登录
2. 进入素材管理页面 → 新建图文 → 插入超链接 → 搜索公众号
3. 拦截网络请求获取文章列表API响应
4. 逐个访问文章URL，提取HTML内容
5. 使用Turndown转换为Markdown并保存

## 注意事项

- 登录需要显示浏览器窗口（headless: false），以便扫码
- 文章下载有1秒延迟，避免请求过于频繁
- 公众号后台页面结构可能变化，如遇问题需更新选择器
