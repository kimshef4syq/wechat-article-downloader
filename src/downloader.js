const fs = require('fs').promises;
const path = require('path');
const TurndownService = require('turndown');
const config = require('./config');

class Downloader {
  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });

    // 自定义Turndown规则，处理微信公众号的特殊样式
    this.turndownService.addRule('removeEmptyParagraphs', {
      filter: (node) => {
        return (
          node.nodeName === 'P' &&
          node.textContent.trim() === '' &&
          node.querySelectorAll('img').length === 0
        );
      },
      replacement: () => '',
    });
  }

  /**
   * 将HTML转换为Markdown
   * @param {string} html - HTML内容
   */
  htmlToMarkdown(html) {
    return this.turndownService.turndown(html);
  }

  /**
   * 生成安全的文件名
   * @param {string} title - 文章标题
   */
  sanitizeFilename(title) {
    return title
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  /**
   * 保存文章为Markdown文件
   * @param {Object} article - 文章对象
   * @param {string} accountName - 公众号名称
   */
  async saveArticle(article, accountName) {
    const outputDir = path.join(config.save.outputDir, this.sanitizeFilename(accountName));
    await fs.mkdir(outputDir, { recursive: true });

    const filename = this.sanitizeFilename(article.title);
    const filePath = path.join(outputDir, `${filename}.md`);

    // 构建Markdown内容
    const markdown = this.buildMarkdown(article);

    await fs.writeFile(filePath, markdown, 'utf-8');
    console.log(`已保存: ${filePath}`);

    return filePath;
  }

  /**
   * 构建Markdown内容
   * @param {Object} article - 文章对象
   */
  buildMarkdown(article) {
    const frontMatter = `---
title: "${article.title}"
author: "${article.author || ''}"
url: "${article.url}"
createTime: "${new Date(article.createTime * 1000).toISOString()}"
downloadTime: "${new Date().toISOString()}"
---

`;

    const content = this.htmlToMarkdown(article.content);

    return frontMatter + `# ${article.title}\n\n` + content;
  }

  /**
   * 批量下载文章
   * @param {Array} articles - 文章列表
   * @param {string} accountName - 公众号名称
   * @param {Function} getContent - 获取文章内容的函数
   */
  async downloadAll(articles, accountName, getContent) {
    console.log(`开始下载 ${articles.length} 篇文章...`);

    const results = [];
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`[${i + 1}/${articles.length}] 正在下载: ${article.title}`);

      try {
        const content = await getContent(article.url);
        article.content = content.content;
        article.author = content.author;

        const filePath = await this.saveArticle(article, accountName);
        results.push({ success: true, filePath, article });
      } catch (error) {
        console.error(`下载失败: ${article.title}`, error.message);
        results.push({ success: false, error: error.message, article });
      }

      // 添加延迟，避免请求过于频繁
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return results;
  }
}

module.exports = Downloader;
