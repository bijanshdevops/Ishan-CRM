import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: false, include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'] },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
