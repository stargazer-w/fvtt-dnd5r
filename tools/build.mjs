/**
 * 构建：把 `src/` 打包成 `dist/` 下一个可直接安装的完整模组。
 *
 * - `src/packs/`（JSON 源）→ `dist/packs/`（LevelDB 二进制）
 * - 其余内容（assets / fonts / lang / scripts / styles / templates / CHIGA.png / module.json）
 *   原样同步到 `dist/`，只复制有变化的文件。
 *
 * 用法：npm run build
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { CACHE_DIR, DIST_DIR, DIST_PACKS_DIR, SRC_DIR, SRC_PACKS_DIR, digestDirectory, getPackDeclarations,
  syncDirectory } from "./common.mjs";

/** 记录上次编译时 src/packs 的摘要，用来判断是否需要重新编译 */
const PACKS_STAMP = path.join(CACHE_DIR, "packs.stamp");

/**
 * 把 `src/` 构建成 `dist/`。
 * @returns {Promise<{packs: number, documents: number, recompiled: boolean, failed: string[]}>} 构建统计
 */
export async function build() {
  // 1) 同步 `packs` 之外的所有内容
  const { copied, skipped, removed, failed } = syncDirectory(SRC_DIR, DIST_DIR, rel => rel === "packs");
  console.log(`静态资源：复制 ${copied} 个 / 未变化 ${skipped} 个 / 清理 ${removed} 个`
    + (failed.length ? ` / ${failed.length} 个被占用` : ""));

  // 2) 编译 compendium；src/packs 没变就跳过，避免每次都重写 dist/packs
  //    （重写会产生新的 MANIFEST/log 文件名，进而无谓地触发下游同步）
  const packs = getPackDeclarations();
  const digest = digestDirectory(SRC_PACKS_DIR);
  const cached = fs.existsSync(PACKS_STAMP) ? fs.readFileSync(PACKS_STAMP, "utf8").trim() : "";
  const recompiled = (cached !== digest) || !fs.existsSync(DIST_PACKS_DIR);

  let entries = 0;
  if ( recompiled ) {
    fs.rmSync(DIST_PACKS_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIST_PACKS_DIR, { recursive: true });
    for ( const pack of packs ) {
      const src = path.join(SRC_PACKS_DIR, pack.name);
      const dest = path.join(DIST_PACKS_DIR, pack.name);
      if ( !fs.existsSync(src) ) {
        console.warn(`跳过 ${pack.name}：src/packs 下没有对应目录`);
        continue;
      }
      entries += countSourceFiles(src);
      await compilePack(src, dest, { recursive: true, log: false });
      console.log(`  packs/${pack.name.padEnd(22)} 已编译`);
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
 * 统计目录下的 JSON 源文件数量。
 * @param {string} dir 目录
 * @returns {number}
 */
function countSourceFiles(dir) {
  let total = 0;
  for ( const entry of fs.readdirSync(dir, { withFileTypes: true }) ) {
    if ( entry.isDirectory() ) total += countSourceFiles(path.join(dir, entry.name));
    else if ( entry.name.endsWith(".json") ) total++;
  }
  return total;
}

// 直接执行时才构建（被 dev.mjs 引入时不自动执行）
if ( process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ) await build();
