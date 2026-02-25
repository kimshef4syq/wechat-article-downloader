/**
 * 公众号文章下载工具配置
 */
module.exports = {
  // 微信公众号后台地址
  wechat: {
    loginUrl: 'https://mp.weixin.qq.com',
    timeout: 120000, // 登录超时时间（毫秒），扫码需要足够时间
  },

  // 文章保存配置
  save: {
    outputDir: './articles', // 文章保存目录
    format: 'markdown', // 保存格式
    concurrency: 3, // 并发下载数
  },

  // 浏览器配置
  browser: {
    headless: false, // 是否无头模式（登录时需要显示浏览器）
    slowMo: 50, // 操作减慢（毫秒），便于观察
  },
};
