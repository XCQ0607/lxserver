import { defineConfig } from 'vitepress'

export default defineConfig({
  base: "/lxserver/",
  head: [
    ['link', { rel: 'icon', href: '/lxserver/icon.svg' }]
  ],
  themeConfig: {
    logo: '/icon.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/XCQ0607/lxserver' }
    ],
    search: {
      provider: 'local'
    }
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: "LX Sync Server",
      description: "一个增强版的 LX Music 数据同步服务端与 Web 播放器",
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '用户指南', link: '/guide/getting-started' },
          { text: '配置指南', link: '/guide/configuration' },
          { text: 'API 文档', link: '/api/reference' },
          { text: '关于', link: '/about' }
        ],
        sidebar: [
          {
            text: '用户指南',
            items: [
              { text: '快速开始', link: '/guide/getting-started' },
              { text: 'V1 与 V2 版本选择', link: '/guide/version-selection' }
            ]
          },
          {
            text: '核心功能',
            items: [
              { text: '同步服务器设置', link: '/guide/sync-server' },
              { text: 'Web 播放器指南', link: '/guide/web-player' }
            ]
          },
          {
            text: '配置指南',
            items: [
              { text: '配置文件及环境变量', link: '/guide/configuration' }
            ]
          },
          {
            text: 'API 文档',
            items: [
              { text: '服务端 API 参考', link: '/api/reference' }
            ]
          }
        ],
        footer: {
          message: 'Released under the Apache-2.0 License.',
          copyright: 'Copyright © 2026 xcq0607 & Contributors'
        }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: "LX Sync Server",
      description: "An enhanced data synchronization server and Web player for LX Music",
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Usage Guide', link: '/en/guide/getting-started' },
          { text: 'Config Guide', link: '/en/guide/configuration' },
          { text: 'API Docs', link: '/en/api/reference' },
          { text: 'About', link: '/en/about' }
        ],
        sidebar: [
          {
            text: 'Usage Guide',
            items: [
              { text: 'Getting Started', link: '/en/guide/getting-started' },
              { text: 'Choosing V1 or V2', link: '/en/guide/version-selection' }
            ]
          },
          {
            text: 'Core Features',
            items: [
              { text: 'Sync Server Settings', link: '/en/guide/sync-server' },
              { text: 'Web Player Guide', link: '/en/guide/web-player' }
            ]
          },
          {
            text: 'Config Guide',
            items: [
              { text: 'Config & Env Vars', link: '/en/guide/configuration' }
            ]
          },
          {
            text: 'API Docs',
            items: [
              { text: 'Server API Ref', link: '/en/api/reference' }
            ]
          }
        ],
        footer: {
          message: 'Released under the Apache-2.0 License.',
          copyright: 'Copyright © 2026 xcq0607 & Contributors'
        }
      }
    }
  }
})
