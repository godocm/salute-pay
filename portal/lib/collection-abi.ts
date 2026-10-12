// Canonical portable collection ABI.
const order =
  "(bytes32 id,address merchant,address token,uint256 amount,uint256 executorFee,uint256 originChainId)";
const authorization =
  "(bytes32 orderDigest,address asset,uint256 reward,uint256 minimumMerchantAmount,bytes32 nonce,uint256 deadline)";
export const PORTABLE_COLLECTION_FACTORY_ABI = [
  `function predictAddress(${order}) view returns(address)`,
  `function orderDigest(${order}) view returns(bytes32)`,
  `function verifyOrder(${order},bytes) view returns(bool)`,
  `function balanceOfAsset(${order},address) view returns(uint256)`,
  `function settle(${order},bytes) returns(address)`,
  `function collect(${order},bytes,address,bool) returns(address)`,
  `function collectWithReward(${order},bytes,${authorization},bytes) returns(address)`,
  "function usedAuthorizations(address,bytes32) view returns(bool)",
  "function implementation() view returns(address)",
  "event PaymentCollected(bytes32 indexed orderId,address indexed deposit,address indexed merchant,address asset,uint256 originChainId,uint256 executionChainId,uint256 invoiceAmount,uint256 received,uint256 merchantAmount,uint256 executorReward,address executor)",
];
