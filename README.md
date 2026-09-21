# D&D5.5E 合集 for Foundry Virtual Tabletop

![Supported Versions](https://img.shields.io/badge/FVTT-v13-8b0000?style=flat-square) ![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/chiga777/dnd5e_collection_2024?style=flat-square) ![GitHub all releases](https://img.shields.io/github/downloads/chiga777/dnd5e_collection_2024/total?style=flat-square) [![Bilibili](https://img.shields.io/badge/Bilibili-千菓チカ"-00A1D6?logo=Bilibili&logoColor=white&style=flat-square)](https://space.bilibili.com/37702076) [![Bilibili](https://img.shields.io/badge/支援-千菓チカ"-FF69B4?logo=Bilibili&logoColor=white&style=flat-square)](https://www.bilibili.com/opus/1004555041941487616) [![QQ 群](https://img.shields.io/badge/交流群-1076780320-4c8bf5?logo=qq&logoColor=white&style=flat-square)](https://qm.qq.com/q/W5IeWAlt0M)

本仓库是[原模组](https://github.com/chiga777/dnd5e-collection-2024)的**可构建版本**：原先存放在 `packs/` 里的 compendium 数据（LevelDB 二进制包）已解包为 `src/` 下可阅读、可 diff 的 JSON 源文件，改完之后由脚本构建出 `dist/` 下可直接安装的模组。

## 🛠 构建

模组的源文件都在 `src/`，目录结构与最终模组一致——其中 `packs/` 是可阅读、可编辑的 JSON，
其余（素材、脚本、样式、模板、`module.json`）就是原始文件本身。

`src/packs/` 的目录层级就是 Foundry 里的 compendium 分组（对应 `module.json` 的 `packFolders`）：
文件夹目录放控制文件 `@folder.json`、包目录放 `@pack.json`，目录名即分组名 / 包名；
`module.json` 里这两个字段用一句说明文字占位，构建时自动填充。详见 [tools/README.md](tools/README.md)。

```bash
npm install       # 首次使用
npm run build     # src → dist（compendium 编译为 LevelDB，其余原样同步）
npm run dev     -- "<Foundry 的 modules 目录>"  # build + 把 dist 同步进该目录（可传多个）
npm run unpack  -- "<原始模组目录>"             # 用其中的 packs/ 重新解包出 src/packs
npm run verify  -- "<原始模组目录>"             # 以原始模组为基准校验 dist（逐文件 / 逐条目）
```

构建产物在 `dist/`，把它整个放进 Foundry 的 `Data/modules/` 即可使用，等同于下方「安装模块」的下载版。
维护 compendium 数据时直接编辑 `src/packs/<包名>/` 下的 JSON，再跑一次 `npm run build` 即可。

上面这些路径参数也可以写进仓库根目录的 `local.config.json`，省得每次敲
（该文件已被 `.gitignore` 忽略，不会进版本库；相对路径按仓库根目录解析）：

```jsonc
{
  "modulesDir": "D:/path/to/foundry/Data/modules",   // npm run dev
  "originModuleDir": "D:/path/to/original-module"    // npm run unpack / verify
}
```

命名规则、已知的坑等细节见 [tools/README.md](tools/README.md)。

## 🎯 安装模块

1. 从右栏 Releases 处下载此模块
2. 解压至你的 FVTT 模块目录
3. 重新启动你的 Foundry Virtual Tabletop

## 🥤 支援

如果你喜欢这个模块并希望支持原作者的工作，请于[此处](https://www.bilibili.com/opus/1004555041941487616)！

## 🏁 里程碑

- [x] PHB 玩家手册 (2024)
- [x] DMG 城主指南 (2024)
- [ ] MM 怪物图鉴 (2025)
- [ ] And more … ?
