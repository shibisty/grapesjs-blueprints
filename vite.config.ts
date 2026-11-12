import { defineConfig } from 'vite';

// `vite build` — the plugin (ES + UMD); `vite build --mode blueprint` — the standalone
// blueprint library (ES only, no GrapesJS), appended to the same dist/.
export default defineConfig(({ mode }) =>
  mode === 'blueprint'
    ? {
        build: {
          emptyOutDir: false,
          sourcemap: true,
          lib: { entry: 'src/blueprint/index.ts', formats: ['es'], fileName: () => 'blueprint.js' },
        },
      }
    : {
        build: {
          sourcemap: true,
          lib: {
            entry: 'src/index.ts',
            name: 'grapesjsScripts',
            formats: ['es', 'umd'],
            fileName: (format) => (format === 'es' ? 'grapesjs-scripts.js' : 'grapesjs-scripts.umd.cjs'),
          },
          rollupOptions: {
            external: ['grapesjs'],
            output: { exports: 'named', globals: { grapesjs: 'grapesjs' } },
          },
        },
      }
);
