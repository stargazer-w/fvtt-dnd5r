# 数据维护工具

模组的 compendium 数据以 LevelDB 二进制包（`*.ldb`）存储，既读不了也 diff 不了。
因此仓库把**可维护的源文件**放在 `src/`，由 `npm run build` 打包成 `dist/` 下一个可直接安装的完整模组。

```
reference/origin/          ← 本机保留的原始模组快照（不进版本库；unpack / verify 的源目录可以是它）
src/                       ← 唯一数据源，目录结构与最终模组完全一致
├── assets/ fonts/ lang/ scripts/ styles/ templates/ CHIGA.png module.json
└── packs/<包名>/<文件夹>/<名称>_<文档ID>.json      ← compendium 用 JSON 维护
dist/                      ← 构建产物：完整可安装模组（不进版本库）
├── assets/ fonts/ lang/ scripts/ styles/ templates/ CHIGA.png module.json   ← 原样同步
└── packs/<包名>/                                   ← 由 JSON 编译回的 LevelDB
```

只有 `packs` 在两边类型不同（`src` 是 JSON，`dist` 是 LevelDB）；其余是文本或媒体文件，构建时原样复制。

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
| 文件夹 | 与实际文件夹同名，文件夹文档存为 `_Folder.json` | `Ｄ. 装备/武器/简易近战/_Folder.json` |

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
| `common.mjs` | 公共工具：路径常量与本地配置、读取 `module.json`、规范化 `CURRENT`、安全命名、目录同步与摘要 |
| `unpack.mjs` | 解包：原始模组的 `packs/` → `src/packs` |
| `build.mjs` | 构建：`src` → `dist` |
| `verify.mjs` | 校验：`dist` 与原始模组逐文件（SHA-256）/ 逐条目比对 |
| `dev.mjs` | 开发：构建 + 把 `dist` 同步进 `modulesDir` 指定的 modules 目录 |
| `foundryvtt-cli.d.ts` | 为无类型声明的 `@foundryvtt/foundryvtt-cli` 写的最小声明 |
