import { defineConfig } from 'tsup';

// Bundle the CLI into a single self-contained ESM file: workspace packages
// (@profile-as-code/core, renderers) are inlined because they are not on npm;
// published third-party deps (yaml, zod) stay external. This is what makes
// `npm i -g @profile-as-code/cli` work standalone (release issues #42/#43).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  external: ['yaml', 'zod'],
  noExternal: [/^@profile-as-code\//],
  sourcemap: false,
  dts: false,
  clean: true,
});