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

/** 同步失败计数（被占用的文件、写不完整的包） */
let failures = 0;

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
    // 正要动 compendium 时，先探测目标里的包是否正被 Foundry 打开：
    // LevelDB 会独占 LOCK 文件，探得占用就直接停手——在 Foundry 运行中改写包，
    // 塞进去的 .ldb 会被它的会话当成「无引用文件」回收掉，最终留下空包。
    if ( recompiled ) {
      const packsDir = path.join(target, "packs");
      const inUse = [];
      if ( fs.existsSync(packsDir) ) {
        for ( const pack of fs.readdirSync(packsDir, { withFileTypes: true }) ) {
          if ( !pack.isDirectory() ) continue;
          const lock = path.join(packsDir, pack.name, "LOCK");
          if ( !fs.existsSync(lock) ) continue;
          try {
            fs.closeSync(fs.openSync(lock, "r+"));
          } catch {
            inUse.push(pack.name);
          }
        }
      }
      if ( inUse.length ) {
        console.error(`\n✗ 有 ${inUse.length} 个 compendium 正被 Foundry 占用：${inUse.join(", ")}`);
        console.error("\n请先停掉 Foundry（关闭浏览器 / 退回设置界面都不够——服务端进程仍握着这些包）：");
        console.error("    docker stop dosi-foundry-1 demo-foundry-1");
        console.error("同步完再启动它们即可。现在没有改动目标目录，可以放心重试。");
        process.exit(1);
      }
    }

    // compendium 没重新编译时完全不动目标里的 packs：
    // Foundry 会一直持有已打开的 LevelDB，重写/删除会被系统直接拒绝
    const { copied, skipped, removed, failed } = syncDirectory(DIST_DIR, target, rel => (rel === "packs") && !recompiled);
    console.log(`已同步：${target}\n     复制 ${copied} 个 / 未变化 ${skipped} 个 / 清理 ${removed} 个`);

    // 同步后核对每个包是否还有数据：漏掉 .ldb 会让 Foundry 读到空包
    const broken = [];
    for ( const pack of fs.readdirSync(path.join(DIST_DIR, "packs"), { withFileTypes: true }) ) {
      if ( !pack.isDirectory() ) continue;
      const from = path.join(DIST_DIR, "packs", pack.name);
      const dir = path.join(target, "packs", pack.name);
      const sizeOf = where => fs.readdirSync(where)
        .filter(name => name.endsWith(".ldb") || name.endsWith(".log"))
        .reduce((sum, name) => sum + fs.statSync(path.join(where, name)).size, 0);
      if ( !sizeOf(from) ) continue; // dist 里本来就是空包，不判断
      if ( !fs.existsSync(dir) ) { broken.push(`${pack.name}（整个目录缺失）`); continue; }
      if ( !sizeOf(dir) ) broken.push(`${pack.name}（没有 .ldb，.log 也是空的）`);
    }

    if ( failed.length || broken.length ) {
      failures++;
      if ( failed.length ) {
        console.error(`\n✗ ${failed.length} 个文件未能写入（目标被占用）：`);
        for ( const name of failed.slice(0, 10) ) console.error(`    ${name}`);
        if ( failed.length > 10 ) console.error(`    …另有 ${failed.length - 10} 个`);
      }
      if ( broken.length ) {
        console.error(`\n✗ ${broken.length} 个 compendium 包在目标里没有数据：`);
        for ( const name of broken ) console.error(`    ${name}`);
      }
      console.error("\n目标里的 compendium 包处于不完整状态，Foundry 会读到空包。"
        + "\n请先关掉 Foundry（容器）——至少退回到设置界面——然后重跑本命令；"
        + "\n同步完成后重新进入世界即可。");
    }
  }
}

console.log(`\n${title} v${version} 已就绪，在 Foundry 中刷新（F5）即可加载。`);
process.exit(failures ? 1 : 0);
