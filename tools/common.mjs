/**
 * 打包 / 解包相关的公共工具。
 *
 * 说明：本模组的 compendium 数据以 LevelDB（*.ldb）形式存放在 `packs/` 下，
 * 二进制内容无法直接阅读与维护，因此统一解包为 `src/` 下的 JSON 源文件，
 * 需要发布时再由 `npm run pack` 重新编译回 LevelDB。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ClassicLevel } from "classic-level";

/** 仓库根目录 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 原始模组快照目录（只读参考，见 reference/README.md） */
export const ORIGIN_DIR = path.join(ROOT, "reference", "origin");

/** 原始 LevelDB compendium 包目录 */
export const ORIGIN_PACKS_DIR = path.join(ORIGIN_DIR, "packs");

/** 源目录：结构与最终模组一致，是唯一数据源 */
export const SRC_DIR = path.join(ROOT, "src");

/** compendium 数据源目录（JSON） */
export const SRC_PACKS_DIR = path.join(SRC_DIR, "packs");

/** 模组清单文件 */
export const MANIFEST_PATH = path.join(SRC_DIR, "module.json");

/** 构建输出目录：一个可直接安装的完整模组 */
export const DIST_DIR = path.join(ROOT, "dist");

/** 构建输出中的 compendium 包目录（LevelDB） */
export const DIST_PACKS_DIR = path.join(DIST_DIR, "packs");

/** 构建缓存目录（放在 node_modules 内，不进版本库） */
export const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "dnd5e-collection-2024");

/**
 * 读取模组清单 `src/module.json`。
 * 注意：其中的 `packs` 与 `packFolders` 由 `src/packs` 的目录结构生成，不写在清单里。
 * @returns {Record<string, any>}
 */
export function getManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

/** 包控制文件：标识一个目录是 compendium 包，内容为 module.json 里对应的 pack 配置 */
export const PACK_CONFIG_FILE = "@pack.json";

/** 文件夹控制文件：标识一个目录是 compendium 文件夹，内容为它的非结构字段 */
export const FOLDER_CONFIG_FILE = "@folder.json";

/**
 * 结构目录名的序号前缀：`1. 門戶` → 序号 1、名字「門戶」。
 * 顺序写进名字里，资源管理器也会照这个顺序显示；构建时前缀被剥掉。
 */
const ORDER_PREFIX = /^(\d+)\.\s*(.+)$/;

/**
 * 拆开目录名的序号前缀。
 * @param {string} name 目录名
 * @returns {{order: number, name: string}} 没有序号时 order 为最大值，即排到最后
 */
function splitDirName(name) {
  const matched = ORDER_PREFIX.exec(name);
  if ( !matched ) return { order: Number.MAX_SAFE_INTEGER, name };
  return { order: Number(matched[1]), name: matched[2] };
}

/**
 * 读取 `src/packs` 的目录树。
 *
 * 目录结构对应 module.json 的 `packFolders`：
 * - 含 `@pack.json` 的目录是一个包，其子目录不再参与结构（里面是解包出的文档）
 * - 含 `@folder.json` 的目录是一个文件夹，子目录是它的 packs / folders
 * - 目录名的前缀 `序号. ` 决定它在同级里的位置（小的在前；不写序号的排到最后、按名称）
 *   Foundry 的 `sorting: "m"` 靠数组顺序排序，而文件系统只能按名称返回条目，因此顺序写在名字里
 * - 目录名去掉序号即文件夹名 / 包的 label，所以导出的名字都不含序号
 *
 * @returns {{packFolders: object[], packs: object[], packDirs: Map<string, string>}}
 *   `packFolders` 可直接写进 module.json；`packs` 为各包配置；`packDirs` 为「包名 → 目录」。
 */
export function readPacksTree() {
  const packs = [];
  const packDirs = new Map();

  /**
   * 读取存在的 JSON 文件。
   * @param {string} file 文件路径
   * @returns {any|null}  文件不存在时为 null
   */
  const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

  /**
   * 列出目录里的子目录，按目录名的序号前缀排序。
   * @param {string} dir 父目录
   * @returns {{path: string, order: number, name: string}[]} 已排好序的子目录
   */
  const listDirs = dir => fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ path: path.join(dir, entry.name), ...splitDirName(entry.name) }))
    .sort((a, b) => {
      if ( a.order !== b.order ) return a.order - b.order;
      return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0);
    });

  /**
   * 递归读取一个目录。
   * @param {string} dir 目录
   * @returns {{type: "pack", name: string}|{type: "folder", folder: object}}
   */
  const walk = dir => {
    const dirName = splitDirName(path.basename(dir)).name;

    const packConfig = readJson(path.join(dir, PACK_CONFIG_FILE));
    if ( packConfig ) {
      // label 由目录名（去掉序号）表达，与文件夹的 name 同理；
      // 插回 name 之后，让产物里的字段顺序与原文件一致
      const { name, ...rest } = packConfig;
      if ( !name ) throw new Error(`@pack.json 缺少 name：${dir}`);
      const entry = { name, label: dirName, ...rest };
      packs.push(entry);
      packDirs.set(name, dir);
      return { type: "pack", name };
    }

    const raw = readJson(path.join(dir, FOLDER_CONFIG_FILE));
    if ( !raw ) {
      throw new Error(`目录既不是包也不是文件夹，缺少 ${PACK_CONFIG_FILE} / ${FOLDER_CONFIG_FILE}：${dir}`);
    }
    // name 由目录名决定，不写进 module.json
    const { name: _name, ...rest } = raw;
    const folder = { name: dirName, ...rest };

    const packNames = [];
    const folders = [];
    for ( const child of listDirs(dir) ) {
      const node = walk(child.path);
      if ( node.type === "pack" ) packNames.push(node.name);
      else folders.push(node.folder);
    }
    if ( packNames.length ) folder.packs = packNames;
    if ( folders.length ) folder.folders = folders;
    return { type: "folder", folder };
  };

  const packFolders = listDirs(SRC_PACKS_DIR).map(entry => {
    const node = walk(entry.path);
    if ( node.type !== "folder" ) throw new Error(`src/packs 的顶层只能是文件夹目录：${entry.path}`);
    return node.folder;
  });

  return { packFolders, packs, packDirs };
}

/** 本地配置文件（放在仓库根目录，不进版本库） */
export const LOCAL_CONFIG_FILE = "local.config.json";

/**
 * 读取本地配置。
 * @returns {Record<string, any>} 配置内容，文件不存在时返回空对象
 */
export function readLocalConfig() {
  const configPath = path.join(ROOT, LOCAL_CONFIG_FILE);
  if ( !fs.existsSync(configPath) ) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch ( err ) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${LOCAL_CONFIG_FILE} 解析失败：${message}`);
  }
}

/**
 * 解析本机路径：绝对路径原样返回，相对路径按仓库根目录解析。
 * @param {string} value 路径
 * @returns {string}     绝对路径
 */
export function resolveFromRoot(value) {
  return path.resolve(ROOT, value);
}

/**
 * 取得本机路径：命令行位置参数优先，其次是本地配置里的指定键。
 * @param {string} configKey 本地配置里的键名
 * @returns {string|undefined} 绝对路径，两者都没给出时返回 undefined
 */
export function resolveInputPath(configKey) {
  const arg = process.argv.slice(2).find(value => !value.startsWith("--"));
  const value = arg ?? readLocalConfig()[configKey];
  return value ? resolveFromRoot(value) : undefined;
}

/**
 * 取得并校验原始模组目录（命令行参数优先，其次 local.config.json 的 originModuleDir）。
 * @param {string} usage 提示信息中显示的命令，例如 `npm run unpack`
 * @returns {string}     绝对路径
 */
export function requireOriginModuleDir(usage) {
  const dir = resolveInputPath("originModuleDir");
  if ( !dir ) {
    console.error(
      "没有指定原始模组目录。\n\n"
      + `  方式一：${usage} -- "<原始模组目录>"\n`
      + `  方式二：在仓库根目录的 ${LOCAL_CONFIG_FILE} 里配置\n`
      + "          { \"originModuleDir\": \"<原始模组目录>\" }\n"
    );
    process.exit(1);
  }
  if ( !fs.existsSync(dir) ) {
    console.error(`原始模组目录不存在：${dir}`);
    process.exit(1);
  }
  return dir;
}

/**
 * 把字符串转换为安全的文件名 / 目录名，保留中文等非 ASCII 字符。
 * @param {string} name              原始名称
 * @param {string} [fallback]        名称为空时使用的后备值
 * @returns {string}
 */
export function safeName(name, fallback = "unnamed") {
  let out = String(name ?? "")
    .replace(/[\\/:*?"<>|]/g, "_") // Windows 不允许的字符
    .replace(/[\u0000-\u001f\u007f]/g, "_") // 控制字符
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, ""); // Windows 不允许以点或空格结尾
  if ( !out ) out = String(fallback);
  if ( out.length > 80 ) out = out.slice(0, 80).trim();
  return out;
}

/**
 * 把只读的原始 LevelDB 包复制到临时目录，并规范化 `CURRENT` 文件。
 *
 * `CURRENT` 只有一行「`MANIFEST-000002` + LF」。它太像文本文件，上游仓库在 Windows 上
 * 检出时 `core.autocrlf` 会把它转成 CRLF，LevelDB 切掉 `\n` 后得到带 `\r` 的非法文件名，
 * 报 `LEVEL_IO_ERROR` / `LEVEL_DATABASE_NOT_OPEN`，因此读取前必须先规范化。
 * @param {string} sourceDir 原始包目录
 * @returns {string}         临时目录路径（需由调用方负责清理）
 */
export function stagePackForReading(sourceDir) {
  const currentPath = path.join(sourceDir, "CURRENT");
  if ( !fs.existsSync(currentPath) ) throw new Error(`不是有效的 LevelDB 包目录：${sourceDir}`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "fvtt-pack-"));
  fs.cpSync(sourceDir, staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "CURRENT"), `${fs.readFileSync(currentPath, "utf8").trim()}\n`);
  return staging;
}

/**
 * 读取包内的 Folder 文档，并计算每个文件夹的目录名与完整相对路径。
 *
 * - `leafNames` 为同级不重名的文件夹名，可直接交给 foundryvtt-cli 的
 *   `transformFolderName`（该回调要求返回“单层目录名”而非完整路径）。
 * - `paths` 为形如 `武器/近战武器` 的完整相对路径。
 * @param {string} packDir 已修复过的包目录
 * @returns {Promise<{leafNames: Map<string, string>, paths: Map<string, string>}>}
 */
export async function readFolderMaps(packDir) {
  const db = new ClassicLevel(packDir, { keyEncoding: "utf8", valueEncoding: "json", createIfMissing: false });
  /** @type {Array<{_id: string, name: string, folder?: string|null}>} */
  const folders = [];
  // classic-level 的类型没有反映 valueEncoding: "json"，这里显式声明迭代出来的值类型
  for await ( const [key, doc] of /** @type {AsyncIterable<[string, any]>} */ (db.iterator()) ) {
    if ( key.startsWith("!folders!") ) folders.push(doc);
  }
  await db.close();

  const byId = new Map(folders.map(f => [f._id, f]));
  const children = new Map();
  for ( const folder of folders ) {
    const parentId = folder.folder ?? "";
    if ( !children.has(parentId) ) children.set(parentId, []);
    children.get(parentId).push(folder);
  }

  // 同级文件夹重名时追加序号，避免互相覆盖
  const leafNames = new Map();
  for ( const siblings of children.values() ) {
    const used = new Set();
    for ( const folder of siblings ) {
      const base = safeName(folder.name, folder._id);
      let name = base;
      for ( let i = 2; used.has(name); i++ ) name = `${base}_${i}`;
      used.add(name);
      leafNames.set(folder._id, name);
    }
  }

  const paths = new Map();
  /**
   * 递归拼出文件夹的完整相对路径。
   * @param {{_id: string, name: string, folder?: string|null}} folder 文件夹文档
   * @returns {string} 形如 `武器/近战武器` 的相对路径
   */
  const resolvePath = folder => {
    if ( paths.has(folder._id) ) return paths.get(folder._id);
    const parent = byId.get(folder.folder);
    const own = leafNames.get(folder._id) ?? safeName(folder.name, folder._id);
    const full = parent ? path.join(resolvePath(parent), own) : own;
    paths.set(folder._id, full);
    return full;
  };
  for ( const folder of folders ) resolvePath(folder);

  return { leafNames, paths };
}

/**
 * 把 `source` 目录同步到 `dest`：只复制新增或有变化的文件（比较大小与修改时间），
 * 并删除 `dest` 中多余的条目，使两者结构保持一致。
 *
 * 单个文件/目录被其它进程占用时（Windows 上很常见，例如 Docker 里的 Foundry 正握着
 * 已打开的 LevelDB）不会中断，而是记入 `failed` 由调用方提示。
 * @param {string} source                    源目录
 * @param {string} dest                      目标目录
 * @param {(rel: string) => boolean} [skip]  返回 true 的条目会被跳过（不复制也不删除），rel 相对 source
 * @param {string} [prefix]                  出错信息中显示的相对路径前缀
 * @returns {{copied: number, skipped: number, removed: number, failed: string[]}}
 */
export function syncDirectory(source, dest, skip = () => false, prefix = "") {
  /** @type {{copied: number, skipped: number, removed: number, failed: string[]}} */
  const result = { copied: 0, skipped: 0, removed: 0, failed: [] };
  /**
   * @param {string} name 条目名
   * @returns {string}    用于提示的相对路径
   */
  const display = name => (prefix ? `${prefix}/${name}` : name);

  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch ( err ) {
    result.failed.push(`${prefix || dest}（${errorCode(err)}）`);
    return result;
  }

  const sourceNames = new Set();
  for ( const entry of fs.readdirSync(source, { withFileTypes: true }) ) {
    if ( skip(entry.name) ) continue;
    sourceNames.add(entry.name);
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);

    if ( entry.isDirectory() ) {
      const sub = syncDirectory(from, to, rel => skip(path.join(entry.name, rel)), display(entry.name));
      result.copied += sub.copied;
      result.skipped += sub.skipped;
      result.removed += sub.removed;
      result.failed.push(...sub.failed);
    } else if ( entry.isFile() ) {
      try {
        const stats = fs.statSync(from);
        const existing = fs.existsSync(to) ? fs.statSync(to) : null;
        // 文件系统时间精度不足 1ms，比较时留一点余量
        const unchanged = existing?.isFile() && (existing.size === stats.size)
          && (Math.abs(existing.mtimeMs - stats.mtimeMs) < 1);
        if ( unchanged ) {
          result.skipped++;
          continue;
        }
        fs.copyFileSync(from, to);
        fs.utimesSync(to, stats.atimeMs / 1000, stats.mtimeMs / 1000); // 保留亚毫秒精度，便于下次跳过
        result.copied++;
      } catch ( err ) {
        result.failed.push(`${display(entry.name)}（${errorCode(err)}）`);
      }
    }
  }

  // 删除目标中已不存在的条目
  for ( const entry of fs.readdirSync(dest, { withFileTypes: true }) ) {
    if ( sourceNames.has(entry.name) || skip(entry.name) ) continue;
    try {
      fs.rmSync(path.join(dest, entry.name), { recursive: true, force: true });
      result.removed++;
    } catch ( err ) {
      result.failed.push(`${display(entry.name)}（${errorCode(err)}）`);
    }
  }

  return result;
}

/**
 * 取错误的错误码，用于提示失败原因（EPERM / EBUSY 等）。
 * @param {unknown} err 捕获到的错误
 * @returns {string}
 */
function errorCode(err) {
  return (err && typeof err === "object" && "code" in err) ? String(err.code) : String(err);
}

/**
 * 计算目录内容摘要（逐文件内容哈希），用来判断源文件是否发生变化。
 * 只比较内容，不理会修改时间，因此重新解包得到相同内容时不会触发无谓的重新编译。
 * @param {string} dir 目录
 * @returns {string}   摘要（sha256）
 */
export function digestDirectory(dir) {
  const hash = createHash("sha256");
  /**
   * @param {string} current 当前目录
   * @param {string} prefix  相对路径前缀
   */
  const walk = (current, prefix) => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => ((a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0)));
    for ( const entry of entries ) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if ( entry.isDirectory() ) walk(full, rel);
      else if ( entry.isFile() ) hash.update(rel).update("\0").update(fs.readFileSync(full)).update("\0");
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}
