const puppeteer = require('puppeteer');
const config = require('./config');

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
    console.log('等待登录中...');

    try {
      // 等待登录成功的标志（出现用户名或管理界面元素）
      await this.page.waitForSelector('.weui-desktop-account', {
        timeout: config.wechat.timeout,
      });
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

    // 进入素材管理页面
    await this.page.goto(
      'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=init&lang=zh_CN',
      { waitUntil: 'networkidle2' }
    );

    // 点击新建图文 -> 超链接 -> 查找文章
    // 这里需要根据实际页面结构调整选择器
    const articles = [];

    // 监听网络请求来获取文章列表API响应
    const articleListPromise = new Promise((resolve) => {
      this.page.on('response', async (response) => {
        if (response.url().includes('appmsgext')) {
          try {
            const data = await response.json();
            if (data.app_msg_list) {
              resolve(data.app_msg_list);
            }
          } catch (e) {
            // 忽略非JSON响应
          }
        }
      });
    });

    // 点击"超链接"按钮
    await this.page.waitForSelector('#js_editor_insert_link', {
      timeout: 5000,
    });
    await this.page.click('#js_editor_insert_link');

    // 等待弹窗出现
    await this.page.waitForSelector('.weui-desktop-dialog__bd', {
      timeout: 5000,
    });

    // 输入公众号名称搜索
    await this.page.type('.weui-desktop-dialog input', accountName);
    await this.page.keyboard.press('Enter');

    // 等待搜索结果
    await this.page.waitForTimeout(2000);

    // 点击搜索结果中的公众号
    const accountSelector = '.weui-desktop-dialog .search-result__item';
    await this.page.waitForSelector(accountSelector, { timeout: 5000 });
    await this.page.click(accountSelector);

    // 等待文章列表加载
    const articleList = await Promise.race([
      articleListPromise,
      this.page.waitForTimeout(5000).then(() => []),
    ]);

    console.log(`找到 ${articleList.length} 篇文章`);

    for (const article of articleList.slice(0, count)) {
      articles.push({
        title: article.title,
        url: article.link,
        cover: article.cover,
        createTime: article.create_time,
        author: article.author,
      });
    }

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
