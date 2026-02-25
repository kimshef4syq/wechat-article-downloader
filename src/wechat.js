const puppeteer = require('puppeteer');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

// 延迟函数
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Session文件路径
const SESSION_FILE = path.join(__dirname, '..', 'data', 'session.json');

class WeChatClient {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.token = null;
  }

  /**
   * 保存登录会话到文件
   */
  async saveSession() {
    if (!this.page) return;

    const cookies = await this.page.cookies();
    const url = this.page.url();
    const tokenMatch = url.match(/token=(\d+)/);
    const token = tokenMatch ? tokenMatch[1] : this.token;

    const sessionData = {
      cookies,
      token,
      savedAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await fs.writeFile(SESSION_FILE, JSON.stringify(sessionData, null, 2));
    console.log('会话已保存');
  }

  /**
   * 从文件加载登录会话
   */
  async loadSession() {
    try {
      const data = await fs.readFile(SESSION_FILE, 'utf-8');
      const sessionData = JSON.parse(data);
      console.log(`发现已保存的会话 (${sessionData.savedAt})`);
      return sessionData;
    } catch {
      return null;
    }
  }

  /**
   * 检查会话是否有效
   */
  async checkSession() {
    if (!this.page) return false;

    try {
      // 访问首页检查是否已登录
      await this.page.goto(
        'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN',
        { waitUntil: 'networkidle2', timeout: 10000 }
      );

      await delay(2000);

      const bodyText = await this.page.evaluate(() => document.body.innerText);
      if (bodyText.includes('请重新登录') || bodyText.includes('登录')) {
        return false;
      }

      // 获取token
      const url = this.page.url();
      const tokenMatch = url.match(/token=(\d+)/);
      if (tokenMatch) {
        this.token = tokenMatch[1];
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 使用已保存的会话恢复登录
   */
  async restoreSession() {
    const session = await this.loadSession();
    if (!session) {
      return false;
    }

    console.log('正在恢复会话...');
    this.browser = await puppeteer.launch({
      headless: config.browser.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });

    // 设置cookies
    await this.page.setCookie(...session.cookies);

    // 检查会话是否有效
    const valid = await this.checkSession();

    if (valid) {
      this.isLoggedIn = true;
      this.token = session.token || this.token;
      console.log('会话恢复成功！Token:', this.token);
      return true;
    } else {
      console.log('会话已过期，需要重新登录');
      await this.close();
      return false;
    }
  }

  /**
   * 启动浏览器并登录微信公众号
   */
  async login() {
    // 先尝试恢复已保存的会话
    const restored = await this.restoreSession();
    if (restored) {
      return true;
    }

    console.log('正在启动浏览器...');
    this.browser = await puppeteer.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });

    console.log('正在打开微信公众号登录页面...');
    await this.page.goto(config.wechat.loginUrl, {
      waitUntil: 'networkidle2',
    });

    // 等待用户扫码登录
    console.log('请使用微信扫码登录...');
    console.log('等待登录中...(超时时间: 2分钟)');

    try {
      // 等待登录成功
      await this.page.waitForFunction(
        () => {
          const url = window.location.href;
          if (url.includes('token=') && url.includes('cgi-bin')) {
            return true;
          }
          const bodyText = document.body.innerText;
          if (bodyText.includes('请重新登录')) {
            return false;
          }
          if (document.querySelector('.weui-desktop-account') ||
              document.querySelector('.weui-desktop-global-header')) {
            return true;
          }
          return false;
        },
        { timeout: config.wechat.timeout }
      );

      await delay(2000);

      // 获取token
      const currentUrl = this.page.url();
      const tokenMatch = currentUrl.match(/token=(\d+)/);
      if (tokenMatch) {
        this.token = tokenMatch[1];
      }

      if (!this.token) {
        console.error('无法获取token');
        return false;
      }

      this.isLoggedIn = true;
      console.log('登录成功！Token:', this.token);

      // 保存会话
      await this.saveSession();

      return true;
    } catch (error) {
      console.error('登录超时，请重试');
      return false;
    }
  }

  /**
   * 获取指定公众号的文章列表
   */
  async getArticleList(accountName, count = 10) {
    if (!this.isLoggedIn) {
      throw new Error('请先登录');
    }

    console.log(`正在获取公众号 "${accountName}" 的文章列表...`);

    // 如果没有token，从当前页面获取
    if (!this.token) {
      const url = this.page.url();
      const tokenMatch = url.match(/token=(\d+)/);
      if (tokenMatch) {
        this.token = tokenMatch[1];
      }
    }

    if (!this.token) {
      throw new Error('无法获取token');
    }

    console.log('正在搜索公众号...');
    const searchUrl = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&query=${encodeURIComponent(accountName)}&count=10&token=${this.token}&lang=zh_CN&f=json&ajax=1`;

    const searchResponse = await this.page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        return res.json();
      } catch (e) {
        return { error: e.message };
      }
    }, searchUrl);

    if (searchResponse.error) {
      throw new Error(`搜索请求失败: ${searchResponse.error}`);
    }

    if (searchResponse.base_resp && searchResponse.base_resp.ret !== 0) {
      console.log('搜索响应:', searchResponse);
      throw new Error(`API错误: ${searchResponse.base_resp.err_msg || searchResponse.base_resp.ret}`);
    }

    if (!searchResponse.list || searchResponse.list.length === 0) {
      console.log('未找到该公众号');
      return [];
    }

    const account = searchResponse.list[0];
    const fakeid = account.fakeid;
    console.log(`找到公众号: ${account.nickname}`);

    // 获取文章列表
    console.log('正在获取文章列表...');
    const articles = [];
    let begin = 0;
    const perPage = 5;

    while (begin < count) {
      const listUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?action=list_ex&begin=${begin}&count=${perPage}&fakeid=${fakeid}&type=9&query=&token=${this.token}&lang=zh_CN&f=json&ajax=1`;

      const listResponse = await this.page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: 'include' });
          return res.json();
        } catch {
          return {};
        }
      }, listUrl);

      if (!listResponse.app_msg_list || listResponse.app_msg_list.length === 0) {
        break;
      }

      for (const article of listResponse.app_msg_list) {
        if (articles.length >= count) break;
        articles.push({
          title: article.title,
          url: article.link,
          cover: article.cover,
          createTime: article.create_time,
          author: article.author,
        });
      }

      console.log(`已获取 ${articles.length} 篇文章...`);
      begin += perPage;
      await delay(1000);
    }

    console.log(`共找到 ${articles.length} 篇文章`);
    return articles;
  }

  /**
   * 获取文章详情
   */
  async getArticleContent(url) {
    const articlePage = await this.browser.newPage();
    await articlePage.goto(url, { waitUntil: 'networkidle2' });

    const content = await articlePage.evaluate(() => {
      const titleEl = document.querySelector('#activity-name');
      const contentEl = document.querySelector('#js_content');
      const authorEl = document.querySelector('#js_name');

      return {
        title: titleEl ? titleEl.textContent.trim() : '',
        content: contentEl ? contentEl.innerHTML : '',
        author: authorEl ? authorEl.textContent.trim() : '',
      };
    });

    await articlePage.close();
    return content;
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }
}

module.exports = WeChatClient;
