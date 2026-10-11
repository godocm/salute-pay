import { build } from '../portal/node_modules/esbuild/lib/main.js';
import { spawn } from 'node:child_process';
await build({entryPoints:['portal/server/test-entry.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'portal/node_modules/.cache/salute-server.mjs'});
const child=spawn(process.execPath,['portal/tests/platform.mjs'],{stdio:'inherit',env:process.env});child.on('exit',code=>process.exitCode=code??1);
