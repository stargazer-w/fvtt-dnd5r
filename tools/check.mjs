/**
 * 校验 `src/packs` 自身是否自洽——也就是「目录结构 + 文档的 folder 字段」能不能被正确打包。
 *
 * 包内的目录就是 Foundry 的 compendium 分组：目录里有 `_Folder.json` 才是真实分组，
 * 没有它就只是磁盘上的组织（`npm run unpack` 会按文档的 `folder` 字段把它打平）。
 *
 * 检查项：
 * - 分组：`_Folder.json` 的 `_id` / `_key` / `folder`（父分组）与所在目录、父目录一致
 * - 文档：必须有 `_key`（没有会被 compilePack 静默跳过）、`_key` 在本包内唯一且与包类型匹配
 * - 提示：源文件里不应该出现顶层 `folder` 字段（构建时按目录注入，见 tools/folders.mjs）、
 *   空分组、非 JSON 文件、分组名与目录名不一致
 */
import fs from "node:fs";
import path from "node:path";
import { PACK_CONFIG_FILE, readPacksTree } from "./common.mjs";

/** 分组控制文件 */
const FOLDER_FILE = "_Folder.json";

/** 文档类型 → LevelDB 里的集合名（`_key` 形如 `!items!<id>`） */
const COLLECTION_BY_TYPE = {
  Actor: "actors",
  Adventure: "adventures",
  Cards: "cards",
  Item: "items",
  JournalEntry: "journal",
  Macro: "macros",
  Playlist: "playlists",
  RollTable: "tables",
  Scene: "scenes"
};

/** 每条提示最多打印多少行 */
const MAX_LINES = 20;

const errors = [];
const warnings = [];
let folderTotal = 0;
let documentTotal = 0;

/**
 * 读取 JSON 文件。
 * @param {string} file 路径
 * @returns {any}
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const { packs, packDirs } = readPacksTree();

for ( const pack of packs ) {
  const packDir = packDirs.get(pack.name);
  /** 输出里的位置前缀 */
  const at = rel => `packs/${pack.name}/${rel}`;
  const collection = COLLECTION_BY_TYPE[pack.type];
  const keys = new Set();
  const folderIds = new Set();
  const groups = [];    // { rel, dir }

  /**
   * 递归校验一个目录。
   * @param {string} dir            目录
   * @param {string|null} parentId  最近一层祖先分组的 id
   * @param {string} rel            相对包目录的路径
   */
  const walk = (dir, parentId, rel) => {
    let groupId = parentId;
    if ( fs.existsSync(path.join(dir, FOLDER_FILE)) ) {
      const doc = readJson(path.join(dir, FOLDER_FILE));
      groupId = doc._id;
      folderTotal++;
      groups.push({ rel, dir });
      if ( !/^[A-Za-z0-9]{16}$/.test(doc._id ?? "") ) errors.push(`${at(rel)}：分组 _id 不是 16 位字符（${doc._id}）`);
      if ( folderIds.has(doc._id) ) errors.push(`${at(rel)}：分组 _id 重复（${doc._id}）`);
      folderIds.add(doc._id);
      if ( doc._key !== `!folders!${doc._id}` ) errors.push(`${at(rel)}：_key 应为 !folders!${doc._id}，实际 ${doc._key}`);
      if ( keys.has(doc._key) ) errors.push(`${at(rel)}：_key 在本包内重复（${doc._key}）`);
      keys.add(doc._key);
      if ( "folder" in doc ) warnings.push(`${at(rel)}：不该出现顶层 folder 字段（构建时按目录注入），跑 npm run folders:write 清掉`);
      if ( doc.name !== path.basename(dir) ) {
        warnings.push(`${at(rel)}：分组名「${doc.name}」与目录名「${path.basename(dir)}」不一致`);
      }
      if ( doc.type !== pack.type ) warnings.push(`${at(rel)}：分组 type=${doc.type}，与包类型 ${pack.type} 不一致`);
    }

    for ( const entry of fs.readdirSync(dir, { withFileTypes: true }) ) {
      const full = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if ( entry.isDirectory() ) { walk(full, groupId, childRel); continue; }
      if ( entry.name === FOLDER_FILE || entry.name === PACK_CONFIG_FILE ) continue;
      if ( !entry.name.endsWith(".json") ) {
        warnings.push(`${at(childRel)}：不是 JSON 文件，打包时会忽略`);
        continue;
      }

      const doc = readJson(full);
      documentTotal++;
      if ( "folder" in doc ) warnings.push(`${at(childRel)}：不该出现顶层 folder 字段（构建时按目录注入），跑 npm run folders:write 清掉`);
      if ( !doc._key ) {
        errors.push(`${at(childRel)}：缺少 _key，compilePack 会静默跳过这篇`);
        continue;
      }
      if ( keys.has(doc._key) ) errors.push(`${at(childRel)}：_key 在本包内重复（${doc._key}），打包会中断`);
      keys.add(doc._key);
      if ( collection && doc._key !== `!${collection}!${doc._id}` ) {
        errors.push(`${at(childRel)}：_key 应为 !${collection}!${doc._id}，实际 ${doc._key}`);
      }
    }
  };
  walk(packDir, null, "");

  // 空分组：目录里只有分组文档
  for ( const { rel, dir } of groups ) {
    const content = fs.readdirSync(dir).filter(name => name !== FOLDER_FILE && name !== PACK_CONFIG_FILE);
    if ( !content.length ) warnings.push(`${at(rel)}：空分组（只有分组文档）`);
  }
}

/**
 * 打印一组问题。
 * @param {string} label 标签
 * @param {string} mark  行首符号
 * @param {string[]} lines 内容
 */
function print(label, mark, lines) {
  if ( !lines.length ) return;
  console.log(`\n${label} ${lines.length} 处：`);
  for ( const line of lines.slice(0, MAX_LINES) ) console.log(`  ${mark} ${line}`);
  if ( lines.length > MAX_LINES ) console.log(`  …… 另有 ${lines.length - MAX_LINES} 处`);
}

console.log(`结构：${packs.length} 个包 / ${folderTotal} 个分组 / ${documentTotal} 篇文档`);
print("提示", "⚠", warnings);
print("错误", "✗", errors);
console.log(errors.length ? "\n✗ src/packs 存在问题。" : "\n✓ src/packs 自洽。");
process.exit(errors.length ? 1 : 0);
