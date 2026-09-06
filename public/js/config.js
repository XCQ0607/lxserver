// 此文件中仅版本号为静态写死值
// 其余配置由服务端在运行时动态注入 (环境变量 > config.js > defaultConfig.ts)
// 服务端拦截 /js/config.js 请求, 读取此处版本号并合并服务端配置后返回
window.CONFIG = {
    buildHash: '8574d94',
    version: 'v2.0.1',
};
