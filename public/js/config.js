// 版本号与构建指纹由 scripts/update-build-hash.js 从 package.json 和源码生成
// 其余配置由服务端在运行时动态注入 (环境变量 > config.js > defaultConfig.ts)
// 服务端拦截 /js/config.js 请求, 使用 package.json 版本号并合并服务端配置后返回
window.CONFIG = {
    buildHash: '93ae45e',
    version: 'v2.1.4.2',
};
