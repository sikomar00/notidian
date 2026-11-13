import { defineConfig } from 'vite';

// 서비스 워커·설정 화면·그래프 화면을 한 번에 묶는다. 콘텐츠 스크립트는 import를 못 써서 vite.content.config.ts에서 따로 묶는다
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        background: 'src/extension/background/index.ts',
        options: 'options.html',
        spike: 'spike.html',
        graph: 'graph.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
