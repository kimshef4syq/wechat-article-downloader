#!/usr/bin/env node

const { program } = require('commander');
const readline = require('readline');
const WeChatClient = require('./wechat');
const Downloader = require('./downloader');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'accounts.json');

async function ensureDataDir() {
  const dataDir = path.dirname(DATA_FILE);
  await fs.mkdir(dataDir, { recursive: true });
}

async function saveAccounts(accounts) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(accounts, null, 2));
}

async function loadAccounts() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 全局客户端实例
let client = null;
let downloader = null;

/**
 * 交互式模式
 */
async function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log('=== 微信公众号文章下载工具 ===');
  console.log('命令: login | download <公众号> [数量] | list | exit');
  console.log('');

  while (true) {
    const input = await question('> ');
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'login':
          await doLogin();
          break;

        case 'download':
        case 'dl':
          if (!parts[1]) {
            console.log('用法: download <公众号名称> [数量]');
            break;
          }
          const accountName = parts[1];
          const count = parseInt(parts[2]) || 5;
          await doDownload(accountName, count);
          break;

        case 'list':
        case 'ls':
          const accounts = await loadAccounts();
          if (accounts.length === 0) {
            console.log('暂无下载记录');
          } else {
            console.log('已下载的公众号:');
            accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
          }
          break;

        case 'exit':
        case 'quit':
        case 'q':
          console.log('再见！');
          if (client) await client.close();
          rl.close();
          process.exit(0);

        case 'help':
        case '?':
          console.log('命令:');
          console.log('  login              - 登录微信公众号');
          console.log('  download <名称> [N] - 下载公众号文章(默认5篇)');
          console.log('  list               - 查看已下载的公众号');
          console.log('  exit               - 退出程序');
          break;

        case '':
          break;

        default:
          console.log(`未知命令: ${cmd}，输入 help 查看帮助`);
      }
    } catch (error) {
      console.error('错误:', error.message);
    }
  }
}

async function doLogin() {
  if (client && client.isLoggedIn) {
    console.log('已经登录了！');
    return;
  }

  client = new WeChatClient();
  downloader = new Downloader();

  const success = await client.login();
  if (success) {
    console.log('登录成功！可以开始下载文章了。');
    console.log('输入: download <公众号名称> <数量>');
  } else {
    console.log('登录失败，请重试');
    client = null;
    downloader = null;
  }
}

async function doDownload(accountName, count) {
  if (!client || !client.isLoggedIn) {
    // 尝试恢复会话
    client = new WeChatClient();
    downloader = new Downloader();

    const restored = await client.restoreSession();
    if (!restored) {
      console.log('请先登录，输入: login');
      return;
    }
  }

  try {
    console.log(`正在获取公众号 "${accountName}" 的文章列表...`);
    const articles = await client.getArticleList(accountName, count);

    if (articles.length === 0) {
      console.log('未找到文章');
      return;
    }

    const results = await downloader.downloadAll(
      articles,
      accountName,
      (url) => client.getArticleContent(url)
    );

    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(`\n下载完成: 成功 ${success} 篇, 失败 ${failed} 篇`);

    const accounts = await loadAccounts();
    if (!accounts.includes(accountName)) {
      accounts.push(accountName);
      await saveAccounts(accounts);
    }
  } catch (error) {
    console.error('下载失败:', error.message);
  }
}

// CLI 命令
program
  .name('wechat-downloader')
  .description('微信公众号文章下载工具')
  .version('1.0.0')
  .option('-i, --interactive', '交互式模式', false)
  .action(async (options) => {
    if (options.interactive || process.argv.length <= 2) {
      await interactiveMode();
    }
  });

// 单次命令模式
program
  .command('login')
  .description('登录微信公众号')
  .action(async () => {
    client = new WeChatClient();
    downloader = new Downloader();
    const success = await client.login();
    if (success) {
      console.log('登录成功！');
      // 保持浏览器打开
      console.log('浏览器保持打开，可直接运行其他命令');
    } else {
      process.exit(1);
    }
  });

program
  .command('download <account>')
  .description('下载指定公众号的文章')
  .option('-n, --count <number>', '下载文章数量', '5')
  .action(async (account, options) => {
    const count = parseInt(options.count);
    client = new WeChatClient();
    downloader = new Downloader();

    const restored = await client.restoreSession();
    if (!restored) {
      const loggedIn = await client.login();
      if (!loggedIn) process.exit(1);
    }

    await doDownload(account, count);
    // 不关闭浏览器，保持会话
    console.log('会话保持，可继续下载其他公众号');
  });

program
  .command('list')
  .description('列出已下载的公众号')
  .action(async () => {
    const accounts = await loadAccounts();
    if (accounts.length === 0) {
      console.log('暂无下载记录');
      return;
    }
    console.log('已下载的公众号:');
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  });

program.parse();
