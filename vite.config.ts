import { defineConfig } from 'vite';

// `vite build` — ES module for bundlers: grapesjs and blueprintsjs stay external
// (blueprintsjs is a dependency, so apps share one copy with their own imports of it).
// `vite build --mode umd` — the <script> build: blueprintsjs bundled in, only grapesjs external.
const isLib = (id: string) => id === 'blueprintsjs' || id.startsWith('blueprintsjs/');

export default defineConfig(({ mode }) =>
  mode === 'umd'
    ? {
        build: {
          emptyOutDir: false,
          sourcemap: true,
          lib: { entry: 'src/index.ts', name: 'grapesjsScripts', formats: ['umd'], fileName: () => 'grapesjs-scripts.umd.cjs' },
          rollupOptions: { external: ['grapesjs'], output: { exports: 'named', globals: { grapesjs: 'grapesjs' } } },
        },
      }
    : {
        build: {
          sourcemap: true,
          lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'grapesjs-scripts.js' },
          rollupOptions: { external: (id) => id === 'grapesjs' || isLib(id), output: { exports: 'named' } },
        },
      }
);
