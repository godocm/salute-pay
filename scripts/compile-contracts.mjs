import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function solidityFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? solidityFiles(full) : entry.name.endsWith('.sol') ? [full] : [];
  });
}

export function compileContracts() {
  const settings = {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'shanghai',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  };
  const sources = Object.fromEntries(solidityFiles(path.join(root, 'contracts')).map(file => [
    path.relative(root, file).split(path.sep).join('/'), { content: fs.readFileSync(file, 'utf8') },
  ]));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), {
    import(importPath) {
      const file = path.join(root, importPath.startsWith('@') ? 'node_modules' : '', importPath);
      return fs.existsSync(file) ? { contents: fs.readFileSync(file, 'utf8') } : { error: `Missing ${importPath}` };
    },
  }));
  for (const error of output.errors || []) {
    if (error.severity === 'error') throw new Error(error.formattedMessage);
    console.warn(error.formattedMessage);
  }
  const artifacts = {};
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const [sourceName, contracts] of Object.entries(output.contracts)) {
    if (!sourceName.startsWith('contracts/')) continue;
    for (const [contractName, result] of Object.entries(contracts)) {
      if (!result.evm.bytecode.object) continue;
      const artifact = {
        contractName, sourceName, compiler: solc.version(), settings,
        abi: result.abi,
        bytecode: `0x${result.evm.bytecode.object}`,
        deployedBytecode: `0x${result.evm.deployedBytecode.object}`,
      };
      artifacts[contractName] = artifact;
      fs.writeFileSync(path.join(root, 'artifacts', `${contractName}.json`), JSON.stringify(artifact, null, 2) + '\n');
    }
  }
  return artifacts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = compileContracts();
  console.log(`Compiled ${Object.keys(artifacts).length} contracts using ${solc.version()} (Shanghai, optimizer 200, via IR).`);
}
