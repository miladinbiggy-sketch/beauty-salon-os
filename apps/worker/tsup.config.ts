import { defineConfig } from "tsup";

// 工作区包（@salon/*）的 package 入口指向 TS 源码，生产运行时无法直接解析，
// 因此打包时内联进 dist；第三方依赖保持 external。
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: [/@salon\/.*/],
  // pg 是 CJS 且用动态 require，内联进 ESM 会炸：保持 external 由 node 原生加载
  external: ["pg"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
