/**
 * 构建：把 `src/` 打包成 `dist/` 下一个可直接安装的完整模组。
 *
 * - `src/packs/` 的目录结构 → `dist/module.json` 里的 `packs` 与 `packFolders`
 * - 各包目录里的 JSON → `dist/packs/<包名>/`（LevelDB 二进制）
 * - 其余内容（assets / fonts / lang / scripts / styles / templates / CHIGA.png）
 *   原样同步到 `dist/`，只复制有变化的文件
 *
 * 用法：npm run build
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { CACHE_DIR, DIST_DIR, DIST_PACKS_DIR, PACK_CONFIG_FILE, SRC_DIR, SRC_PACKS_DIR, digestDirectory,
  getManifest, readPacksTree, stagePackForCompiling, syncDirectory } from "./common.mjs";

/** 记录上次编译时 src/packs 的摘要，用来判断是否需要重新编译 */
const PACKS_STAMP = path.join(CACHE_DIR, "packs.stamp");

/**
 * 把 `src/` 构建成 `dist/`。
 * @returns {Promise<{packs: number, documents: number, recompiled: boolean, failed: string[]}>} 构建统计
 */
export async function build() {
  const { packFolders, packs, packDirs } = readPacksTree();

  // 1) 同步 `packs` 与 `module.json` 之外的内容（module.json 由下面生成）
  const { copied, skipped, removed, failed } = syncDirectory(SRC_DIR, DIST_DIR,
    rel => (rel === "packs") || (rel === "module.json"));
  console.log(`静态资源：复制 ${copied} 个 / 未变化 ${skipped} 个 / 清理 ${removed} 个`
    + (failed.length ? ` / ${failed.length} 个被占用` : ""));

  // 2) 生成 module.json：packs 与 packFolders 来自 src/packs 的目录结构，
  //    覆盖 src/module.json 里对应的占位说明（键的位置保持不变）
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const manifest = { ...getManifest(), packs, packFolders };
  fs.writeFileSync(path.join(DIST_DIR, "module.json"), `${JSON.stringify(manifest, null, 4)}\n`);
  console.log(`module.json：已生成（${packs.length} 个包 / ${packFolders.length} 个顶层文件夹）`);

  // 3) 编译 compendium；src/packs 没变就跳过，避免每次重写 dist/packs
  //    （重写会产生新的 MANIFEST/log 文件名，进而无谓地触发下游同步）
  const digest = digestDirectory(SRC_PACKS_DIR);
  const cached = fs.existsSync(PACKS_STAMP) ? fs.readFileSync(PACKS_STAMP, "utf8").trim() : "";
  const recompiled = (cached !== digest) || !fs.existsSync(DIST_PACKS_DIR);

  let entries = 0;
  if ( recompiled ) {
    fs.rmSync(DIST_PACKS_DIR, { recursive: true, force: true });
    for ( const pack of packs ) {
      const src = packDirs.get(pack.name);
      const dest = path.join(DIST_DIR, pack.path ?? path.join("packs", pack.name));
      if ( !src || !fs.existsSync(src) ) {
        console.warn(`跳过 ${pack.name}：找不到源目录`);
        continue;
      }
      // src 里不写 folder（分组由目录结构表达），编译前先物化一份带 folder 的副本
      const staging = fs.mkdtempSync(path.join(os.tmpdir(), "fvtt-stage-"));
      try {
        stagePackForCompiling(src, staging);
        entries += countDocuments(src);
        await compilePack(staging, dest, { recursive: true, log: false });
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
      console.log(`  ${pack.path.padEnd(26)} 已编译`);
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(PACKS_STAMP, digest);
    console.log(`\n构建完成：${packs.length} 个包 / ${entries} 个文档 -> dist/`);
  } else {
    console.log(`\n构建完成：compendium 源未变化，跳过编译（${packs.length} 个包）-> dist/`);
  }

  return { packs: packs.length, documents: entries, recompiled, failed };
}

/**
 * 统计包目录下的文档数量（不含 @pack.json）。
 * @param {string} dir 包目录
 * @returns {number}
 */
function countDocuments(dir) {
  let total = 0;
  for ( const entry of fs.readdirSync(dir, { withFileTypes: true }) ) {
    if ( entry.isDirectory() ) total += countDocuments(path.join(dir, entry.name));
    else if ( entry.name.endsWith(".json") && (entry.name !== PACK_CONFIG_FILE) ) total++;
  }
  return total;
}

// 直接执行时才构建（被 dev.mjs 引入时不自动执行）
if ( process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ) await build();
