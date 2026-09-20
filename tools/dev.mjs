/**
 * 开发用：构建 `dist/`，并把它放进 Foundry 的 modules 目录，方便直接测试。
 *
 * 本地相关的配置（Foundry 的 modules 目录）写在仓库根目录的 `local.config.json`，
 * 该文件已被 .gitignore 忽略，不会进版本库：
 *   { "modulesDir": "D:/path/to/foundry/Data/modules" }
 *
 * 为什么默认是「复制」而不是「链接」：
 *   Docker（含 Docker Desktop）无法穿透 NTFS 的 junction / 符号链接——宿主机上看着正常，
 *   但在容器里它只是一个指向宿主机路径的断链，Foundry 因此完全读不到模组。
 *   所以默认走增量镜像同步（只复制有变化的文件）；只有 Foundry 原生跑在 Windows 上时，
 *   才用 `--link` 创建 junction。
 *
 * 用法：
 *   npm run dev                          # 构建 + 镜像同步（默认，兼容 Docker）
 *   npm run dev -- --link                # 构建 + 创建 junction（Windows 原生 FVTT）
 *   npm run dev -- "D:/other/modules"    # 临时指定 modules 目录（可多个，优先于配置文件）
 */
import fs from "node:fs";
import path from "node:path";
import { DIST_DIR, LOCAL_CONFIG_FILE, getManifest, readLocalConfig, resolveFromRoot, syncDirectory }
  from "./common.mjs";
import { build } from "./build.mjs";

// 目录名必须与模组清单的 id 一致：模组内容里写死了 modules/<id>/... 形式的资源路径
const { id: MODULE_ID, title, version } = getManifest();

// modules 目录：命令行参数优先，其次是本地配置（相对路径按仓库根目录解析）
const args = process.argv.slice(2);
const useLink = args.includes("--link");
const modulesDirs = args.filter(arg => !arg.startsWith("--")).map(resolveFromRoot);
if ( !modulesDirs.length && readLocalConfig().modulesDir ) {
  modulesDirs.push(resolveFromRoot(readLocalConfig().modulesDir));
}

if ( !modulesDirs.length ) {
  console.error(
    "没有配置 Foundry 的 modules 目录。\n\n"
    + `  方式一：在仓库根目录的 ${LOCAL_CONFIG_FILE} 里配置\n`
    + "          { \"modulesDir\": \"D:/path/to/foundry/Data/modules\" }\n"
    + "  方式二：临时指定 npm run dev -- \"<modules 目录>\"\n"
  );
  process.exit(1);
}

const { recompiled } = await build();

for ( const modulesDir of modulesDirs ) {
  const target = path.join(modulesDir, MODULE_ID);
  fs.mkdirSync(modulesDir, { recursive: true });

  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if ( existing?.isSymbolicLink() ) {
    fs.unlinkSync(target); // 清掉旧链接，避免复制时写穿到 dist 自身
  } else if ( existing && useLink ) {
    throw new Error(`目标已存在且不是链接，请先手动处理：${target}`);
  }

  if ( useLink ) {
    fs.symlinkSync(DIST_DIR, target, "junction");
    console.log(`已链接：${target}\n     ->  ${DIST_DIR}`);
  } else {
    // compendium 没重新编译时完全不动目标里的 packs：
    // Foundry 会一直持有已打开的 LevelDB，重写/删除会被系统直接拒绝
    const { copied, skipped, removed, failed } = syncDirectory(DIST_DIR, target, rel => (rel === "packs") && !recompiled);
    console.log(`已同步：${target}\n     复制 ${copied} 个 / 未变化 ${skipped} 个 / 清理 ${removed} 个`);
    if ( failed.length ) {
      console.warn(`\n⚠ ${failed.length} 个文件被占用，未能更新：`);
      for ( const name of failed.slice(0, 5) ) console.warn(`    ${name}`);
      if ( failed.length > 5 ) console.warn(`    …另有 ${failed.length - 5} 个`);
      console.warn("  通常是 Foundry 正在使用这些 compendium 包。"
        + "重启 Foundry（容器）后重跑本次命令即可完成更新。");
    }
  }
}

console.log(`\n${title} v${version} 已就绪，在 Foundry 中刷新（F5）即可加载。`);
