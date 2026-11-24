# Background Editor

VSCode 代码编辑区背景图插件：支持本地图片、在线爬取图片、透明度/模糊度调节。

## 功能

- 🌐 **在线爬取图片**：Picsum（随机稳定）、Wallhaven（关键词搜索高清壁纸）
- 📷 **本地图片**：选择本机任意图片作为代码区背景
- 🎚 **透明度调节**：0~1 连续调节，建议 0.10~0.30 保证代码可读
- 🌫 **模糊度调节**：0~30px，背景过于清晰时可适度模糊
- 🖥 **填充方式**：cover / contain / 拉伸
- 🌑 **暗色遮罩**：叠加半透明黑色层提升对比度
- ⚡ **一键开关 / 清除恢复**

## 使用

1. `Ctrl+Shift+P` → `Background Editor: 打开配置面板`
2. 选来源、调透明度，点「🌐 在线爬取并应用」
3. `Ctrl+Shift+P` → `Reload Window` 查看效果

> VSCode 原生不支持代码区背景图，本插件通过注入 `workbench.desktop.main.css` 实现。
> 首次应用会提示"安装损坏"，点忽略即可（仅修改了 CSS）。
> VSCode 升级后需重新应用（原文件被覆盖）。

## 命令

| 命令 | 说明 |
|------|------|
| `Background Editor: 打开配置面板` | 可视化配置 |
| `Background Editor: 换一张图（在线爬取）` | 快捷换图 |
| `Background Editor: 开关背景` | 开/关 |
| `Background Editor: 清除背景并恢复` | 移除注入并恢复原 CSS |
| `Background Editor: 选择本地图片` | 选本机图片 |

## 配置项（settings.json）

| 项 | 默认 | 说明 |
|----|------|------|
| `bgEditor.enabled` | `false` | 是否启用 |
| `bgEditor.opacity` | `0.15` | 不透明度 0~1 |
| `bgEditor.blur` | `0` | 模糊 px |
| `bgEditor.size` | `"cover"` | 填充方式 |
| `bgEditor.source` | `"picsum"` | 爬取来源 |
| `bgEditor.keyword` | `""` | Wallhaven 关键词 |
| `bgEditor.localImage` | `""` | 本地图片路径 |
| `bgEditor.dimOverlay` | `true` | 暗色遮罩 |

## 实现原理

- 定位 `vscode.env.appRoot/out/vs/workbench/workbench.desktop.main.css`
- 首次修改自动备份为 `.bak`
- 注入带 `/* >>> BG-EDITOR START <<< */` 标记的 CSS 块
- 用 `.monaco-editor::before` 伪元素做背景层，编辑器背景透明，内容层 `z-index:1` 上浮
- 清除时从 `.bak` 恢复或移除标记块

## License

MIT
