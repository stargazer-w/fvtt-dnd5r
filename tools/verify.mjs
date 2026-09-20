/**
 * 校验 `dist/`（由 `src/` 构建而来）与原始模组是否一致。
 *
 * - `packs/`：LevelDB 逐条目比对数据（忽略对象键顺序）
 * - 其余文件：逐文件 SHA-256 比对，确认「从 src 完整打包出整个模组」没有丢东西
 *
 * 比对基准（本机上的原始模组目录）需自行提供：
 *   npm run verify -- "<原始模组目录>"
 *   或在 local.config.json 里配置 originModuleDir
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ClassicLevel } from "classic-level";
import { DIST_DIR, DIST_PACKS_DIR, getPackDeclarations, requireOriginModuleDir, stagePackForReading }
  from "./common.mjs";

/** 不作为模组内容比对的条目（仓库自身的 README 与原始模组 README 已各自演进） */
const IGNORED_TOP_LEVEL = ["README.md"];

/** 比对基准：本机上的原始模组目录 */
const ORIGIN_DIR = requireOriginModuleDir("npm run verify");
const ORIGIN_PACKS_DIR = path.join(ORIGIN_DIR, "packs");

let failed = 0;

/* -------------------------------------------- */
/*  1. 比对 packs 之外的文件                     */
/* -------------------------------------------- */

/**
 * 递归收集目录下的文件。
 * @param {string} root                   根目录
 * @param {string[]} [excludeTop]         需要跳过的顶层条目名
 * @returns {Map<string, string>}         相对路径 -> 绝对路径
 */
function collectFiles(root, excludeTop = []) {
  const files = new Map();
  const walk = (dir, prefix) => {
    for ( const entry of fs.readdirSync(dir, { withFileTypes: true }) ) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if ( !prefix && excludeTop.includes(entry.name) ) continue;
      const full = path.join(dir, entry.name);
      if ( entry.isDirectory() ) walk(full, rel);
      else if ( entry.isFile() ) files.set(rel, full);
    }
  };
  walk(root, "");
  return files;
}

/**
 * 计算文件内容的 SHA-256。
 * @param {string} file 文件路径
 * @returns {string}
 */
function hashFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const excluded = [...IGNORED_TOP_LEVEL, "packs"];
const originFiles = collectFiles(ORIGIN_DIR, excluded);
const distFiles = collectFiles(DIST_DIR, excluded);

const missingFiles = [...originFiles.keys()].filter(rel => !distFiles.has(rel));
const extraFiles = [...distFiles.keys()].filter(rel => !originFiles.has(rel));
const changedFiles = [...originFiles.keys()]
  .filter(rel => distFiles.has(rel) && (hashFile(originFiles.get(rel)) !== hashFile(distFiles.get(rel))));

if ( missingFiles.length || extraFiles.length || changedFiles.length ) {
  failed++;
  console.log(`✗ 静态资源：原始 ${originFiles.size} 个 / 构建 ${distFiles.size} 个`);
  if ( missingFiles.length ) console.log(`    缺失 ${missingFiles.length} 个：${missingFiles.slice(0, 5).join(", ")}`);
  if ( extraFiles.length ) console.log(`    多余 ${extraFiles.length} 个：${extraFiles.slice(0, 5).join(", ")}`);
  if ( changedFiles.length ) console.log(`    内容不同 ${changedFiles.length} 个：${changedFiles.slice(0, 5).join(", ")}`);
} else {
  console.log(`✓ 静态资源（assets/fonts/lang/scripts/styles/templates/module.json 等）${originFiles.size} 个文件全部一致`);
}

/* -------------------------------------------- */
/*  2. 比对 packs                               */
/* -------------------------------------------- */

/**
 * 读取一个 LevelDB 包中的全部条目。
 * @param {string} dir LevelDB 目录
 * @returns {Promise<Map<string, object>>}
 */
async function readEntries(dir) {
  const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json", createIfMissing: false });
  const entries = new Map();
  // classic-level 的类型没有反映 valueEncoding: "json"，这里显式声明迭代出来的值类型
  for await ( const [key, value] of /** @type {AsyncIterable<[string, any]>} */ (db.iterator()) ) {
    entries.set(key, value);
  }
  await db.close();
  return entries;
}

/**
 * 深度比较两个 JSON 值，忽略对象键顺序。
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if ( a === b ) return true;
  if ( typeof a !== typeof b || a === null || b === null || typeof a !== "object" ) return false;
  if ( Array.isArray(a) || Array.isArray(b) ) {
    if ( !Array.isArray(a) || !Array.isArray(b) || a.length !== b.length ) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if ( keysA.length !== keysB.length ) return false;
  return keysA.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/**
 * 判断两个文档的差异是否只是「缺失的嵌入集合被补成空数组」。
 * foundryvtt-cli 解包时会把文档里不存在的嵌入集合（如 Scene 的 levels）写成 `[]`，
 * 这在 Foundry 中与字段不存在完全等价，因此不算实质差异。
 * @param {any} a 原始数据
 * @param {any} b 构建结果
 * @returns {boolean}
 */
function isBenignNormalization(a, b) {
  if ( typeof a !== "object" || typeof b !== "object" || a === null || b === null ) return false;
  if ( Array.isArray(a) || Array.isArray(b) ) return false;
  const extra = Object.keys(b).filter(k => !Object.hasOwn(a, k));
  if ( !extra.length ) return false;
  if ( !extra.every(k => Array.isArray(b[k]) && b[k].length === 0) ) return false;
  return Object.keys(a).every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

for ( const pack of getPackDeclarations() ) {
  const origin = path.join(ORIGIN_PACKS_DIR, pack.name);
  const rebuilt = path.join(DIST_PACKS_DIR, pack.name);
  if ( !fs.existsSync(origin) || !fs.existsSync(rebuilt) ) {
    console.warn(`✗ ${pack.name}：缺少${!fs.existsSync(origin) ? "原始包" : "构建结果"}`);
    failed++;
    continue;
  }

  const staging = stagePackForReading(origin);
  try {
    const source = await readEntries(staging);
    const target = await readEntries(rebuilt);

    const missing = [...source.keys()].filter(k => !target.has(k));
    const extra = [...target.keys()].filter(k => !source.has(k));
    const differing = [...source.keys()].filter(k => target.has(k) && !deepEqual(source.get(k), target.get(k)));
    const normalized = differing.filter(k => isBenignNormalization(source.get(k), target.get(k)));
    const changed = differing.filter(k => !normalized.includes(k));

    if ( missing.length || extra.length || changed.length ) {
      failed++;
      console.log(`✗ packs/${pack.name}  原始 ${source.size} 条 / 构建 ${target.size} 条`);
      if ( missing.length ) console.log(`    缺失 ${missing.length} 条：${missing.slice(0, 5).join(", ")}`);
      if ( extra.length ) console.log(`    多余 ${extra.length} 条：${extra.slice(0, 5).join(", ")}`);
      if ( changed.length ) console.log(`    内容不同 ${changed.length} 条：${changed.slice(0, 5).join(", ")}`);
    } else {
      const note = normalized.length ? ` （另有 ${normalized.length} 条补全了空嵌入集合，对 Foundry 无影响）` : "";
      console.log(`✓ packs/${pack.name}  ${source.size} 条一致${note}`);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

console.log(failed ? `\n有 ${failed} 处存在差异。` : "\ndist/ 与原始模组完全一致。");
process.exit(failed ? 1 : 0);
