import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
export const catalog=JSON.parse(await readFile(new URL('../portal/lib/evm-networks.json',import.meta.url),'utf8'));
export async function loadEnvironment(){let file={};try{file=parseEnv(await readFile(new URL('../.env',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Unable to read deployment configuration.');}return {...file,...process.env};}
