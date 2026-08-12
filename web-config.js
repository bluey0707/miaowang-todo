// 电脑网页端的公开配置。这里绝对不要填写 DeepSeek API Key。
// 如需让网页调用同一个 aiPlanner 云函数，请在云开发控制台创建 Publishable Key，
// 并把它填入 accessKey；同时开启匿名登录并把网页域名加入 Web 安全域名。
window.GENTLE_WEB_CONFIG = {
  env: "cloud1-d4gou1my5b1ea5ee2",
  region: "ap-shanghai",
  accessKey: "",
  functionName: "aiPlanner"
};
