/**
 * 把原始模组的 compendium 包（LevelDB 二进制）解包为 JSON，写回 `src/packs` 里对应的包目录。
 *
 * 原始模组目录需自行提供：
 *   npm run unpack -- "<原始模组目录>"
 *   或在 local.config.json 里配置 originModuleDir
 *
 * 目标目录按 `src/packs` 的目录结构查找（包目录由其中的 @pack.json 标识）；
 * 目录里的 @pack.json 会被保留，只刷新包内的文档。
 */
import fs from "node:fs";
import path from "node:path";
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { PACK_CONFIG_FILE, readFolderMaps, readPacksTree, requireOriginModuleDir, safeName, stagePackForReading }
  from "./common.mjs";

const moduleDir = requireOriginModuleDir("npm run unpack");

const manifestPath = path.join(moduleDir, "module.json");
if ( !fs.existsSync(manifestPath) ) {
  console.error(`原始模组目录下没有 module.json：${moduleDir}`);
  process.exit(1);
}
const originPacks = JSON.parse(fs.readFileSync(manifestPath, "utf8")).packs ?? [];
if ( !originPacks.length ) {
  console.error(`原始模组的 module.json 里没有声明任何 compendium 包：${manifestPath}`);
  process.exit(1);
}

/** 包名 → src/packs 里的对应目录 */
const { packDirs } = readPacksTree();

const summary = [];

for ( const pack of originPacks ) {
  const source = path.join(moduleDir, pack.path ?? path.join("packs", pack.name));
  const dest = packDirs.get(pack.name);

  if ( !fs.existsSync(source) ) {
    console.warn(`跳过 ${pack.name}：原始包不存在（${source}）`);
    continue;
  }
  if ( !dest ) {
    console.warn(`跳过 ${pack.name}：src/packs 里没有对应的包目录（缺少 ${PACK_CONFIG_FILE}）`);
    continue;
  }

  const staging = stagePackForReading(source);
  try {
    const { leafNames, paths } = await readFolderMaps(staging);

    // extractPack 的 clean 会清空目标目录，先把包配置备份出来
    const configPath = path.join(dest, PACK_CONFIG_FILE);
    const packConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8").trim() : null;

    let count = 0;
    await extractPack(staging, dest, {
      clean: true,
      folders: true,
      log: false,
      jsonOptions: { space: 2 },

      // 文件夹本体写成 <目录>/_Folder.json，目录名保留中文
      transformFolderName: doc => leafNames.get(doc._id) ?? safeName(doc.name, doc._id),

      // 文档文件名使用「名称_文档ID.json」，既能直读内容又保证不重名
      transformName: (doc, { documentType, folder }) => {
        if ( documentType === "Folder" ) return undefined; // 交给默认规则生成 _Folder.json
        const filename = `${safeName(doc.name, doc._id)}_${doc._id}.json`;
        return folder ? path.join(folder, filename) : filename;
      },

      transformEntry: () => {
        count++;
      }
    });

    if ( packConfig ) fs.writeFileSync(configPath, `${packConfig}\n`);

    const rel = path.relative(process.cwd(), dest).replaceAll("\\", "/");
    summary.push({ pack, dest, count });
    console.log(`${pack.name.padEnd(22)} ${String(count).padStart(5)} 个文档 / ${paths.size} 个文件夹  -> ${rel}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

console.log(`\n解包完成：${summary.length} 个包`);
