#!/usr/bin/env node

const { program } = require('commander');
const WeChatClient = require('./wechat');
const Downloader = require('./downloader');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

// 数据存储路径
const DATA_FILE = path.join(__dirname, '..', 'data', 'accounts.json');

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  const dataDir = path.dirname(DATA_FILE);
  await fs.mkdir(dataDir, { recursive: true });
}

/**
 * 保存已下载的账号列表
 */
async function saveAccounts(accounts) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(accounts, null, 2));
}

/**
 * 加载已下载的账号列表
 */
async function loadAccounts() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

program
  .name('wechat-downloader')
  .description('微信公众号文章下载工具')
  .version('1.0.0');

// 登录命令
program
  .command('login')
  .description('登录微信公众号')
  .action(async () => {
    const client = new WeChatClient();
    try {
      await client.login();
      console.log('登录成功！可以开始下载文章了。');
      console.log('运行 "node src/index.js download <公众号名称>" 下载文章');
    } catch (error) {
      console.error('登录失败:', error.message);
    } finally {
      // 保持浏览器打开，等待用户操作
      console.log('按 Ctrl+C 退出');
    }
  });

// 下载命令
program
  .command('download <account>')
  .description('下载指定公众号的文章')
  .option('-n, --count <number>', '下载文章数量', '10')
  .option('-a, --all', '下载全部文章')
  .action(async (account, options) => {
    const count = options.all ? Infinity : parseInt(options.count);
    const client = new WeChatClient();
    const downloader = new Downloader();

    try {
      // 登录
      const loggedIn = await client.login();
      if (!loggedIn) {
        process.exit(1);
      }

      // 获取文章列表
      const articles = await client.getArticleList(account, count);

      if (articles.length === 0) {
        console.log('未找到文章');
        return;
      }

      // 下载文章
      const results = await downloader.downloadAll(
        articles,
        account,
        (url) => client.getArticleContent(url)
      );

      // 统计结果
      const success = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      console.log(`\n下载完成: 成功 ${success} 篇, 失败 ${failed} 篇`);

      // 保存账号记录
      const accounts = await loadAccounts();
      if (!accounts.includes(account)) {
        accounts.push(account);
        await saveAccounts(accounts);
      }
    } catch (error) {
      console.error('下载失败:', error.message);
    } finally {
      await client.close();
    }
  });

// 列表命令
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
    accounts.forEach((account, index) => {
      console.log(`  ${index + 1}. ${account}`);
    });
  });

// 配置命令
program
  .command('config')
  .description('显示当前配置')
  .action(() => {
    console.log('当前配置:');
    console.log(JSON.stringify(config, null, 2));
  });

program.parse();
