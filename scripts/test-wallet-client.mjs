import { build } from '../portal/node_modules/esbuild/lib/main.js';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
await build({entryPoints:['portal/lib/intents.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'portal/node_modules/.cache/salute-intents.mjs'});
await build({entryPoints:['portal/lib/platform.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'portal/node_modules/.cache/salute-platform.mjs'});
const chain=process.argv[2]||'ethereum';
const script=chain==='ethereum'?'portal/tests/evm-wallet.mjs':chain==='tempo'?'portal/tests/tempo-wallet.mjs':chain==='solana'?'portal/tests/solana-wallet.mjs':undefined;
if(!script)throw Error('Choose ethereum, tempo or solana. TRON uses the dedicated runtime test.');
const child=spawn(process.execPath,[resolve(script)],{stdio:'inherit',env:process.env});child.on('exit',code=>process.exitCode=code??1);
