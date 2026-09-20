/**
 * 把原始模组 `packs` 目录（LevelDB 二进制包）解包为
 * `src/packs/<包名>/<文件夹路径>/<条目名>_<文档ID>.json`。
 *
 * 原始模组目录需自行提供：
 *   npm run unpack -- "<原始模组目录>"
 *   或在 local.config.json 里配置 originModuleDir
 */
import fs from "node:fs";
import path from "node:path";
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { SRC_PACKS_DIR, getPackDeclarations, readFolderMaps, requireOriginModuleDir, safeName,
  stagePackForReading } from "./common.mjs";

// 源目录就是原始模组目录下的 packs/
const sourceRoot = path.join(requireOriginModuleDir("npm run unpack"), "packs");

if ( !fs.existsSync(sourceRoot) ) {
  console.error(`原始模组目录下没有 packs 子目录：${sourceRoot}`);
  process.exit(1);
}

const summary = [];

for ( const pack of getPackDeclarations() ) {
  const source = path.join(sourceRoot, pack.name);
  const dest = path.join(SRC_PACKS_DIR, pack.name);
  if ( !fs.existsSync(source) ) {
    console.warn(`跳过 ${pack.name}：原始包不存在`);
    continue;
  }

  const staging = stagePackForReading(source);
  try {
    const { leafNames, paths } = await readFolderMaps(staging);
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
    summary.push({ pack, dest, count, folders: paths.size });
    console.log(`${pack.name.padEnd(22)} ${String(count).padStart(5)} 个文档 / ${paths.size} 个文件夹`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

console.log(`\n解包完成，共 ${summary.length} 个包，输出到 src/packs/`);
