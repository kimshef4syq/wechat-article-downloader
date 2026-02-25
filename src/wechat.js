const puppeteer = require('puppeteer');
const config = require('./config');

// 延迟函数（替代已废弃的 waitForTimeout）
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WeChatClient {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
  }

  /**
   * 启动浏览器并登录微信公众号
   */
  async login() {
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
      // 登录成功后URL会变化，或者出现特定元素
      // 使用多种方式检测登录成功
      await this.page.waitForFunction(
        () => {
          // URL变为cgi-bin开头表示登录成功
          if (window.location.href.includes('cgi-bin')) {
            return true;
          }
          // 或者出现账号信息元素
          const accountEl = document.querySelector('.weui-desktop-account');
          if (accountEl) return true;
          // 或者出现头部导航
          const headerEl = document.querySelector('.weui-desktop-global-header');
          if (headerEl) return true;
          return false;
        },
        { timeout: config.wechat.timeout }
      );
      this.isLoggedIn = true;
      console.log('登录成功！');
      return true;
    } catch (error) {
      console.error('登录超时，请重试');
      return false;
    }
  }

  /**
   * 获取指定公众号的文章列表
   * @param {string} accountName - 公众号名称或fakeid
   * @param {number} count - 获取文章数量
   */
  async getArticleList(accountName, count = 10) {
    if (!this.isLoggedIn) {
      throw new Error('请先登录');
    }

    console.log(`正在获取公众号 "${accountName}" 的文章列表...`);

    // 先进入首页获取token
    await this.page.goto(
      'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN',
      { waitUntil: 'networkidle2' }
    );

    // 等待页面加载完成
    await delay(3000);

    // 从URL或页面获取token
    let token = '';

    // 方式1: 从URL获取
    const url = this.page.url();
    console.log('当前URL:', url);
    const tokenMatch = url.match(/[?&]token=(\d+)/);
    if (tokenMatch) {
      token = tokenMatch[1];
    }

    // 方式2: 从cookies获取
    if (!token) {
      const cookies = await this.page.cookies();
      const slbCookie = cookies.find(c => c.name === 'slb_wxtoken');
      if (slbCookie) {
        token = slbCookie.value;
      }
    }

    // 方式3: 从页面脚本内容获取
    if (!token) {
      token = await this.page.evaluate(() => {
        // 检查window对象
        if (window.wx && window.wx.data && window.wx.data.t) {
          return String(window.wx.data.t);
        }
        if (window.token) {
          return String(window.token);
        }

        // 检查脚本内容
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent || '';
          const match = text.match(/token\s*=\s*["']?(\d+)/);
          if (match) return match[1];
          const match2 = text.match(/["']token["']\s*:\s*["']?(\d+)/);
          if (match2) return match2[1];
        }

        // 检查页面HTML中的token
        const html = document.documentElement.innerHTML;
        const match3 = html.match(/token=(\d+)/);
        if (match3) return match3[1];

        return '';
      });
    }

    if (!token) {
      console.log('页面标题:', await this.page.title());
      // 尝试打印页面内容帮助调试
      const pageContent = await this.page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('页面内容预览:', pageContent);
      throw new Error('无法获取token，请确保已登录');
    }

    console.log('Token获取成功:', token);
    console.log('正在搜索公众号...');

    // 搜索公众号
    const searchUrl = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&query=${encodeURIComponent(accountName)}&count=10&token=${token}&lang=zh_CN&f=json&ajax=1`;

    const searchResponse = await this.page.evaluate(async (url) => {
      try {
        const res = await fetch(url, {
          credentials: 'include',
        });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { rawText: text };
        }
      } catch (e) {
        return { error: e.message };
      }
    }, searchUrl);

    console.log('搜索响应:', JSON.stringify(searchResponse, null, 2).substring(0, 500));

    if (searchResponse.error) {
      throw new Error(`搜索请求失败: ${searchResponse.error}`);
    }

    if (!searchResponse.list || searchResponse.list.length === 0) {
      console.log('未找到该公众号');
      return [];
    }

    // 取第一个匹配的公众号
    const account = searchResponse.list[0];
    const fakeid = account.fakeid;
    console.log(`找到公众号: ${account.nickname} (fakeid: ${fakeid})`);

    // 获取文章列表
    console.log('正在获取文章列表...');
    const articles = [];
    let begin = 0;
    const perPage = 5; // 每次请求5篇

    while (begin < count) {
      const listUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?action=list_ex&begin=${begin}&count=${perPage}&fakeid=${fakeid}&type=9&query=&token=${token}&lang=zh_CN&f=json&ajax=1`;

      const listResponse = await this.page.evaluate(async (url) => {
        const res = await fetch(url, {
          credentials: 'include',
        });
        return res.json();
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

      // 添加延迟避免请求过快
      await delay(1000);
    }

    console.log(`共找到 ${articles.length} 篇文章`);
    return articles;
  }

  /**
   * 获取文章详情（HTML内容）
   * @param {string} url - 文章URL
   */
  async getArticleContent(url) {
    const articlePage = await this.browser.newPage();
    await articlePage.goto(url, { waitUntil: 'networkidle2' });

    // 获取文章标题和内容
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
