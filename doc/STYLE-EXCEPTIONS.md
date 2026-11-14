# 第三方 DOM 与样式例外

- `@xterm/xterm`：终端 surface 包装层内的终端、textarea、canvas、无障碍树与滚动 DOM 由 xterm 创建，不修改内部类名。必要覆盖集中在 `src/renderer/src/styles/_third-party-adapters.scss`。
- `lucide-vue-next`：图标组件生成的 SVG 与内部图形保留库命名；自有按钮、图标包装层仍使用五段语义 class。
- `index.html` 的 head、meta、title、script 为文档元数据，不作为业务 DOM；html、body 与挂载节点仍提供语义 class。

自有重复组件使用窗口与稳定内部 UUID 组成实例 token。模板静态检查生成 `artifacts/semantic-classes.json`；桌面测试另检查实际 DOM 覆盖、重复实例唯一性和跨页面命名。
