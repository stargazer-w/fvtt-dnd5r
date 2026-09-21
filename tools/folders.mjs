/**
 * 清理源文件里多余的 `folder` 字段。
 *
 * `src/packs` 里不写 `folder`：分组由目录结构表达（目录里有 `_Folder.json` 才是分组，
 * 没有的目录只是磁盘上的组织，里面的文档属于最近一层祖先分组），构建时由 `build.mjs`
 * 按目录注入——**产物里的 `folder` 仍然必需**（LevelDB 没有目录概念，Foundry 靠它归组）。
 *
 * 从 Foundry 导出、或从别处拷来的 JSON 可能带着这个字段，跑一次这里清掉即可。
 * 默认只报告差异，确认后加 `--write`（或 `npm run folders:write`）才删。
 */
import fs from "node:fs";
import path from "node:path";

const PACK_ROOT = "src/packs";
const WRITE = process.argv.includes("--write");

const found = [];

/**
 * @param {string} dir 目录
 */
function walk(dir) {
  for ( const entry of fs.readdirSync(dir, { withFileTypes: true }) ) {
    const full = path.join(dir, entry.name);
    if ( entry.isDirectory() ) { walk(full); continue; }
    if ( !entry.name.endsWith(".json") || entry.name.startsWith("@") ) continue;
    const doc = JSON.parse(fs.readFileSync(full, "utf8"));
    if ( !("folder" in doc) ) continue;
    found.push({ file: full, doc, folder: doc.folder });
  }
}
walk(PACK_ROOT);

if ( !found.length ) {
  console.log("源文件里没有多余的 folder 字段。");
  process.exit(0);
}

console.log(`有 ${found.length} 个文件带着 folder 字段：`);
for ( const item of found.slice(0, 15) ) {
  console.log(`  ${path.relative(PACK_ROOT, item.file).replaceAll("\\", "/")}  (folder=${item.folder ?? "null"})`);
}
if ( found.length > 15 ) console.log(`  …… 另有 ${found.length - 15} 个`);

if ( !WRITE ) {
  console.log("\n（未删除，确认后加 --write）");
  process.exit(0);
}
for ( const item of found ) {
  delete item.doc.folder;
  fs.writeFileSync(item.file, `${JSON.stringify(item.doc, null, 2)}\n`);
}
console.log(`\n已删除 ${found.length} 处 folder 字段。`);
