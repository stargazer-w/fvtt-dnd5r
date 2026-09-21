# 数据维护工具

模组的 compendium 数据以 LevelDB 二进制包（`*.ldb`）存储，既读不了也 diff 不了。
因此仓库把**可维护的源文件**放在 `src/`，由 `npm run build` 打包成 `dist/` 下一个可直接安装的完整模组。

```
reference/origin/          ← 本机保留的原始模组快照（不进版本库；unpack / verify 的源目录可以是它）
src/                       ← 唯一数据源，目录结构与最终模组完全一致
├── assets/ fonts/ lang/ scripts/ styles/ templates/ CHIGA.png
├── module.json            ← packs / packFolders 的占位值写成说明文字，构建时由目录结构填充
└── packs/                 ← 目录结构对应 module.json 的 packFolders
    └── <分组>/             ← 目录名前缀「序号. 」表示它在同级里的位置；含 @folder.json
        ├── @folder.json   ← 控制文件：标识这是文件夹，存放它的非结构字段
        └── <包 label>/     ← 同样带序号前缀；含 @pack.json
            ├── @pack.json ← 控制文件：标识这是包，存放 module.json 里对应的 pack 配置
            └── <文档>.json ← compendium 数据（<名称>_<文档ID>.json）
dist/                      ← 构建产物：完整可安装模组（不进版本库）
├── assets/ fonts/ lang/ scripts/ styles/ templates/ CHIGA.png   ← 原样同步
├── module.json            ← 由 src/module.json + 目录结构生成
└── packs/<包 name>/       ← 由 JSON 编译回的 LevelDB（目录名取自 @pack.json 的 name）
```

只有 `packs` 在两边类型不同（`src` 是 JSON，`dist` 是 LevelDB）；其余是文本或媒体文件，构建时原样复制。

## packs 目录结构

`src/packs/` 的目录层级就是 Foundry 里的 compendium 分组：

- **文件夹**：目录里有 `@folder.json`，**目录名（去掉序号）即分组名**，子目录是它的子文件夹或包
- **包**：目录里有 `@pack.json`，**目录名（去掉序号）即它的 label**（模块里显示的名字），
  目录里其余 JSON 是该包的文档
  （有 `@pack.json` 的目录不再向下解析结构，所以包内的 compendium 子文件夹不会与分组混淆）

`@folder.json` 与 `@pack.json` 是专用的**控制文件**（`@` 前缀标识“这是给打包工具读的，不是数据”），
里面只放非结构字段——分组名、包的 label、顺序都由目录名表达，`packs` / `folders` 由子目录表达：

```jsonc
// src/packs/千菓的 D&D5.5E 合集/2. 核心规则/@folder.json
{ "sorting": "m", "color": "#5d0814" }

// src/packs/千菓的 D&D5.5E 合集/2. 核心规则/1. 玩家手册 Player's Handbook/2. PHB 2024 资源/@pack.json
{ "name": "phb-content", "path": "packs/phb-content", "type": "Item", … }
```

### 顺序写在目录名里

目录名的前缀 `序号. ` 就是这个目录在同级里的位置（小的在前），构建时会被剥掉：

```
src/packs/千菓的 D&D5.5E 合集/
├── 1. 門戶/                          ← label「門戶」
├── 2. 核心规则/                       ← 分组名「核心规则」，子目录的序号从 1 重新数
│   └── 1. 玩家手册 Player's Handbook/
│       ├── 1. 玩家手册 (2024)/        ← @pack.json 的 name 是 players-handbook
│       └── 2. PHB 2024 资源/         ← label「PHB 2024 资源」
└── 3. 派生内容/
    └── 1. Dc⁷ 随机表/ 2. Dc⁷ 派生物品/ 3. Dc⁷ 派生造物/ 4. Dc⁷ 宏/
```

序号不能省：这些分组的 `sorting` 都是 `"m"`（手动排序），Foundry 按数组顺序显示，
而文件系统只能按名称返回条目——纯按名排序会得到「城主指南 / 怪物图鉴 / 玩家手册」，与原顺序不符。
之所以写进名字里而不是单独一个字段，是为了让资源管理器也照这个顺序显示（VS Code 只提供
名称 / 类型 / 修改时间三种排序，没有自定义排序的入口）。

- 序号按数字比较，两位数不用补零；不写序号的目录排在最后、按名称
- `src/packs` 下只有一个分组目录，它不需要序号（同级没有比较对象）
- 想调整位置就改序号，不必回头改父级的任何东西；序号只用于排序，不会出现在产物里

`@pack.json` 里是 `module.json` 中对应的那条 pack 配置（`name` / `path` / `type` / `banner` …）。
`label` 不出现在文件里——**它由目录名（去掉序号）表达**；文件夹的 `name` 同理，两者都以目录名为准。
生成 `module.json` 时，`label` 会按目录名补回 `name` 之后。

> **别把两种文件名搞混**：`_Folder.json`（下划线 + 大写 F）是 Foundry 的 compendium 文件夹文档，
> 属于**数据**，由 `unpack` 生成、位于包目录内部；`@folder.json` 是打包工具的**控制文件**，
> 位于结构目录里。两者不会出现在同一个目录。

`src/module.json` 里的 `packs` / `packFolders` 直接写成一句说明文字作为**占位值**，
构建时会被目录结构生成的内容覆盖（键的位置保持不变）：

```jsonc
"packs": "占位：由 src/packs 的目录结构生成，构建时覆盖。增删资源包请改目录结构（@pack.json 标识该目录为一个资源包并定义其属性；目录名去掉「序号. 」前缀即它的 label）。",
"packFolders": "占位：由 src/packs 的目录结构生成，构建时覆盖。调整分组与顺序请改目录结构（@folder.json 标识该目录为一个资源目录并定义其属性；目录名前缀「序号. 」控制它所在的顺序，仅对父目录 sorting 为 m 时生效）。"
```

要新增一个包，就在合适的位置建目录（**目录名去掉序号前缀就是它在模块里显示的名字**，序号决定位置）、
放 `@pack.json`、把文档放进去；把包换到别的分组，直接移动目录（顺带改序号）即可。

## 命令

```bash
npm install       # 首次使用，安装 @foundryvtt/foundryvtt-cli / classic-level

npm run build     # src → dist
npm run dev     -- "<Foundry 的 modules 目录>"  # 各模组文件夹所在的那一层；build + 把 dist 同步进去（可传多个）
npm run unpack  -- "<原始模组目录>"             # 解包其中的 packs/ 到 src/packs（会先清空 src/packs）
npm run verify  -- "<原始模组目录>"             # 用它的 packs/ 与其余文件作比对基准，校验 dist
```

`build` 只复制大小或修改时间有变化的素材，且只有 `src/packs` 发生变化时才会重新编译 compendium；
同时会删除 `dist` 中多余的条目。

上面这些路径参数也可以写进仓库根目录的 `local.config.json`，省得每次敲
（该文件已被 `.gitignore` 忽略；相对路径按仓库根目录解析）：

```jsonc
{
  "modulesDir": "D:/path/to/foundry/Data/modules",   // npm run dev
  "originModuleDir": "D:/path/to/original-module"    // npm run unpack / verify
}
```

### 部署到 Foundry（npm run dev）

`dev` = `build` + 把 `dist/` 放进 `modulesDir` 指定的 modules 目录，最终路径形如：

```
<modules 目录>/dnd5e-collection-2024/
```

默认采用**增量镜像同步**（只复制有变化的文件），原因是：

> ⚠️ **Docker 无法穿透 NTFS 的 junction / 符号链接。**
> 宿主机上链接看着完全正常，但在容器里它只是一个指向宿主机路径的断链，
> Foundry 会抱怨 `module.json: No such file or directory`，模组列表里根本看不到。
> 所以只要 Foundry 跑在 Docker 里，就不要用链接。

- 目录名取自 `src/module.json` 的 `id`，**必须与 id 一致**——
  模组数据里写死了 `modules/dnd5e-collection-2024/...` 形式的资源路径，改名会让素材 404。
- 可重复执行；若发现旧链接会先移除（避免复制时写穿到 `dist` 自身）。
- `npm run dev -- --link` 会改用 junction，仅适用于 Foundry 原生跑在 Windows 上的情况。
- 更干净的替代方案：给容器加一条绑定挂载（Docker 支持嵌套挂载），之后只需 `npm run build`，连复制都省了：

  ```yaml
  volumes:
    - <宿主机 modules 目录>:/data/Data/modules
    - '<宿主机 dist 目录>:/data/Data/modules/dnd5e-collection-2024'
  ```

## 命名规则

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 文档 | `<名称>_<文档ID>.json` | `长剑_xQ3EhFvRURUZzGnv.json` |
| compendium 文件夹（包内的分类） | 与文件夹同名，每个文件夹另存一个 `_Folder.json` | `Ｄ. 装备/武器/简易近战/_Folder.json` |

- 名称保留中文，仅替换 Windows 非法字符（`\ / : * ? " < > |`）并截断到 80 字符。
- 追加文档 ID 后缀是为了保证同级重名文档（例如大量同名物品）不会互相覆盖。
- 目录层级与 Foundry 中的 compendium 文件夹结构一一对应。

> 编译时是**递归**读取 `src/packs/<包名>/` 下所有 `.json`，
> 因此文件名与目录名可以自由调整——真正决定条目身份的是文件内部的 `_key` 字段。

## 已知坑

1. **Windows 换行符会破坏 LevelDB**
   `CURRENT` 只有一行：`MANIFEST-000002` 加一个 LF，共 16 字节。
   它太像文本文件了，Windows 上 `core.autocrlf=true` 检出时会连行尾一起转成 CRLF（17 字节）；
   LevelDB 要求结尾是 `\n`，切掉后得到带 `\r` 的非法文件名 `MANIFEST-000002\r`，从而报
   `LEVEL_IO_ERROR: 文件名、目录名或卷标语法不正确`。
   `*.ldb` / `MANIFEST` 因为是二进制不会被动，偏偏只有这个 16 字节的小文件被改坏。
   - 已在 `.gitattributes` 中把 LevelDB 包目录标记为 `binary`，避免再次发生；
   - `tools/common.mjs` 的 `stagePackForReading()` 会在读取前把包复制到临时目录，
     并把 `CURRENT` 规范成「文件名 + LF」。

2. **空嵌入集合会被补全**
   `foundryvtt-cli` 解包时，会把文档中不存在的嵌入集合写成空数组（例如 Scene 的 `levels: []`）。
   这在 Foundry 中与字段缺失完全等价，`verify` 会把它识别为可忽略的归一化差异。

3. **`_key` 字段**
   解包出的 JSON 里带有 `_key`（如 `!items!xQ3EhFvRURUZzGnv`），它是编译时定位条目的依据，
   请勿删除或修改；如需新增文档，务必保证 `_id` 与 `_key` 一致且全局唯一。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `common.mjs` | 公共工具：路径常量与本地配置、读取 `module.json` 与 `src/packs` 目录树、规范化 `CURRENT`、目录同步与摘要 |
| `unpack.mjs` | 解包：原始模组的包 → `src/packs` 里对应的包目录 |
| `build.mjs` | 构建：`src` → `dist`（并生成 `dist/module.json`） |
| `verify.mjs` | 校验：`dist` 与原始模组逐文件 / 逐条目比对（JSON 按内容比较） |
| `dev.mjs` | 开发：构建 + 把 `dist` 同步进 `modulesDir` 指定的 modules 目录 |
| `foundryvtt-cli.d.ts` | 为无类型声明的 `@foundryvtt/foundryvtt-cli` 写的最小声明 |
