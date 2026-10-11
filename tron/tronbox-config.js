module.exports = {
  networks: {
    development: {
      privateKey: process.env.PRIVATE_KEY_DEV,
      userFeePercentage: 0,
      feeLimit: 1000 * 1e6,
      fullHost: process.env.TRON_FULL_NODE_URL || 'http://127.0.0.1:9090',
      network_id: '*',
    },
  },
  contracts_directory: './contracts',
  contracts_build_directory: './build/contracts',
  compilers: {
    solc: {
      version: '0.8.30',
      settings: { optimizer: { enabled: true, runs: 200 } },
    },
  },
};
