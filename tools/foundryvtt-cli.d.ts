/**
 * `@foundryvtt/foundryvtt-cli` 未提供类型声明，且其源码里的 JSDoc 使用了 TypeScript 无法解析的
 * 多行 `@typedef {` 联合类型，一旦被解析就会报语法错误并连带影响调用方的类型推断。
 * 这里给出最小声明，只覆盖本项目用到的部分。
 */
declare module "@foundryvtt/foundryvtt-cli" {
  /** 打包选项 */
  interface PackOptions {
    /** 递归查找源文件 */
    recursive?: boolean;
    /** 是否输出进度 */
    log?: boolean;
  }

  /** 解包选项 */
  interface ExtractOptions {
    /** 解包前清空目标目录 */
    clean?: boolean;
    /** 按 compendium 文件夹结构生成目录 */
    folders?: boolean;
    /** 是否输出进度 */
    log?: boolean;
    /** 使用 YAML 而不是 JSON */
    yaml?: boolean;
    /** 传给 JSON.stringify 的选项 */
    jsonOptions?: { space?: number | string; replacer?: unknown };
    /** 处理每个条目；返回 false 表示丢弃该条目 */
    transformEntry?: (doc: any, context?: any) => unknown;
    /** 自定义条目文件名 */
    transformName?: (doc: any, context?: any) => string | undefined | Promise<string | undefined>;
    /** 自定义文件夹目录名 */
    transformFolderName?: (doc: any) => string | undefined | Promise<string | undefined>;
    /** 序列化后、写入前再做处理 */
    transformSerialized?: (content: string, context: any) => string | Promise<string>;
  }

  export function compilePack(src: string, dest: string, options?: PackOptions): Promise<void>;
  export function extractPack(src: string, dest: string, options?: ExtractOptions): Promise<void>;
}
