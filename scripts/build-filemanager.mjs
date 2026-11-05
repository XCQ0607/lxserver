import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('public/filemanager', { recursive: true });
await build({
  entryPoints: ['scripts/filemanager/main.js'], bundle: true, minify: true,
  format: 'esm', target: ['es2022'], outfile: 'public/filemanager/app.js',
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  legalComments: 'linked', logLevel: 'info',
});
await copyFile('node_modules/vuefinder/LICENSE', 'public/filemanager/VueFinder-LICENSE.txt');
