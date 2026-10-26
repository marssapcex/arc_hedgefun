const fs = require('fs');
const path = require('path');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

async function main() {
  const filename = 'IndexNearEqualWeightExploit.t.sol';
  const source = fs.readFileSync(path.join(__dirname, 'test', filename), 'utf8');
  const input = { language: 'Solidity', sources: { [filename]: { content: source } }, settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }};
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  const artifact = output.contracts[filename].IndexNearEqualWeightExploitTest;
  const gp = ganache.provider({ logging: { quiet: true }, chain: { allowUnlimitedContractSize: true }, miner: { blockGasLimit: 100000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const signer = await provider.getSigner();
  const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, signer);
  const test = await factory.deploy({ gasLimit: 80000000 });
  await test.waitForDeployment();
  await (await test.testConcreteExploit({ gasLimit: 80000000 })).wait();
  await (await test.testConcreteProtocolInputExploit({ gasLimit: 80000000 })).wait();
  await (await test.testZeroFeeFlashloanAttackRepaysAtomically({ gasLimit: 80000000 })).wait();
  let seed = 1;
  for (let i = 0; i < 300; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    await (await test.testFuzz_ProfitableAcceptedRebalance(seed, { gasLimit: 80000000 })).wait();
    seed = (seed * 1664525 + 1013904223) >>> 0;
    await (await test.testFuzz_ProfitableProtocolInputRebalance(seed, { gasLimit: 80000000 })).wait();
  }
  for (let i = 0; i < 500; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    await (await test.testFuzz_HundredsOfWeightBalanceFeeConfigs(seed, { gasLimit: 80000000 })).wait();
  }
  console.log('EVM PoC PASS: 2 direct regressions, 1 atomic zero-fee flashloan regression, and 1,100 seeded fuzz executions');
  console.log('The 500-config EVM sweep varies valid weights, the <0.01 weight gap, both reserves, fee rates 10..20000, and trade sizes; no separate fee-token transfer is made on the protocol-input route.');
  await gp.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
