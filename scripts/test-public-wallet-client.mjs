import {build} from '../portal/node_modules/esbuild/lib/main.js';
import {spawn} from 'node:child_process';
await build({entryPoints:['portal/lib/intents.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'portal/node_modules/.cache/salute-intents.mjs'});
const script=process.argv.includes('solana')?'portal/tests/solana-public-wallet.mjs':'portal/tests/public-wallet.mjs';
const child=spawn(process.execPath,[script,...process.argv.slice(2)],{stdio:'inherit',env:process.env});child.on('exit',c=>process.exitCode=c||0);
