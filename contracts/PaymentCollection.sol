// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

struct PortableOrder {
    bytes32 id;
    address merchant;
    address token;
    uint256 amount;
    uint256 executorFee;
    uint256 originChainId;
}

struct CollectionAuthorization {
    bytes32 orderDigest;
    address asset;
    uint256 reward;
    uint256 minimumMerchantAmount;
    bytes32 nonce;
    uint256 deadline;
}

/// @notice One immutable merchant across compatible EVM networks; no admin/upgrade hooks.
contract PaymentReceiver {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address private immutable implementation;
    error OnlyFactory();
    error OnlyClone();
    error InvalidArguments();
    error NothingToCollect();
    error InsufficientMerchantReceipt();
    error NativeTransferFailed();
    error InexactTokenPayout();

    constructor() { factory = msg.sender; implementation = address(this); }
    receive() external payable {}

    function getOrder() public view returns (PortableOrder memory) {
        if (address(this) == implementation) revert OnlyClone();
        bytes memory args = Clones.fetchCloneArgs(address(this));
        if (args.length != 192) revert InvalidArguments();
        return abi.decode(args, (PortableOrder));
    }

    function execute(address asset, address executor, uint256 reward, uint256 minimumMerchantAmount)
        external returns (uint256 received, uint256 merchantAmount, uint256 paidReward)
    {
        if (msg.sender != factory) revert OnlyFactory();
        PortableOrder memory order = getOrder();
        received = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (received == 0) revert NothingToCollect();
        paidReward = executor == order.merchant ? 0 : reward;
        if (paidReward >= received) revert InsufficientMerchantReceipt();
        merchantAmount = received - paidReward;
        if (merchantAmount < minimumMerchantAmount) revert InsufficientMerchantReceipt();
        _transfer(asset, order.merchant, merchantAmount);
        // Sponsored/self collections perform only the merchant transfer.
        if (paidReward != 0) _transfer(asset, executor, paidReward);
    }

    function _transfer(address asset, address recipient, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            // Includes protection against Tempo policy redirection; unusual tokens unsupported.
            uint256 beforeBalance = IERC20(asset).balanceOf(recipient);
            IERC20(asset).safeTransfer(recipient, amount);
            uint256 afterBalance = IERC20(asset).balanceOf(recipient);
            if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert InexactTokenPayout();
        }
    }
}

/// @notice Portable order authorization; execution rewards remain actual-chain-specific.
/// @dev Deploy identical init code from the same deterministic deployer and salt on each chain.
contract PaymentFactory is ReentrancyGuard {
    address public immutable implementation;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Salute");
    bytes32 private constant VERSION_HASH = keccak256("4");
    bytes32 public constant ORDER_TYPEHASH = keccak256("PortableOrder(bytes32 id,address merchant,address token,uint256 amount,uint256 executorFee,uint256 originChainId)");
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256("CollectionAuthorization(bytes32 orderDigest,address asset,uint256 reward,uint256 minimumMerchantAmount,bytes32 nonce,uint256 deadline)");
    mapping(address merchant => mapping(bytes32 nonce => bool used)) public usedAuthorizations;
    error InvalidOrder();
    error InvalidSignature();
    error WrongOriginChain();
    error NothingToCollect();
    error InvalidAuthorization();
    error AuthorizationUsed();
    error OnlyMerchant();
    event OrderAnnounced(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address intendedAsset, uint256 invoiceAmount, uint256 executorFee, uint256 originChainId);
    event PaymentCollected(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address asset, uint256 originChainId, uint256 executionChainId, uint256 invoiceAmount,
        uint256 received, uint256 merchantAmount, uint256 executorReward, address executor);

    constructor() { implementation = address(new PaymentReceiver()); }

    /// @dev Base intent uses its committed ORIGIN chain, deliberately portable across matching factories.
    function orderDigest(PortableOrder calldata order) public view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_domain(order.originChainId), keccak256(abi.encode(
            ORDER_TYPEHASH, order.id, order.merchant, order.token, order.amount, order.executorFee, order.originChainId)));
    }

    function authorizationDigest(CollectionAuthorization calldata authorization) public view returns (bytes32) {
        // Reward authorizations cannot be replayed across actual execution chains/factories.
        return MessageHashUtils.toTypedDataHash(_domain(block.chainid), keccak256(abi.encode(
            AUTHORIZATION_TYPEHASH, authorization.orderDigest, authorization.asset, authorization.reward,
            authorization.minimumMerchantAmount, authorization.nonce, authorization.deadline)));
    }

    function verifyOrder(PortableOrder calldata order, bytes calldata signature) public view returns (bool) {
        _validate(order);
        // EOA signatures remain portable even if the address has delegated code on one chain.
        return _validSignature(order.merchant, orderDigest(order), signature, block.chainid == order.originChainId);
    }

    function predictAddress(PortableOrder calldata order) public view returns (address) {
        _validate(order);
        bytes memory args = abi.encode(order);
        return Clones.predictDeterministicAddressWithImmutableArgs(implementation, args, _salt(args), address(this));
    }

    function balanceOfAsset(PortableOrder calldata order, address asset) external view returns (uint256) {
        return _balance(asset, predictAddress(order));
    }

    function announce(PortableOrder calldata order) external returns (address deposit) {
        if (msg.sender != order.merchant) revert OnlyMerchant();
        deposit = predictAddress(order);
        emit OrderAnnounced(order.id, deposit, order.merchant, order.token, order.amount, order.executorFee, order.originChainId);
    }

    /// @notice Intended-asset collection pays the signed fixed reward PER SWEEP on the origin chain.
    function settle(PortableOrder calldata order, bytes calldata signature) external nonReentrant returns (address) {
        if (block.chainid != order.originChainId) revert WrongOriginChain();
        return _collect(order, signature, order.token, order.executorFee, 1);
    }

    /// @notice Any actual asset on any matching factory. Foreign/wrong assets default to sponsored recovery.
    function collect(PortableOrder calldata order, bytes calldata signature, address asset, bool waiveReward)
        external nonReentrant returns (address)
    {
        uint256 reward = !waiveReward && block.chainid == order.originChainId && asset == order.token
            ? order.executorFee : 0;
        return _collect(order, signature, asset, reward, 1);
    }

    /// @notice Merchant authorizes a reward in the actual asset without changing the funded address.
    function collectWithReward(PortableOrder calldata order, bytes calldata signature,
        CollectionAuthorization calldata authorization, bytes calldata rewardSignature)
        external nonReentrant returns (address)
    {
        if (authorization.orderDigest != orderDigest(order) || authorization.minimumMerchantAmount == 0
            || block.timestamp > authorization.deadline) revert InvalidAuthorization();
        if (usedAuthorizations[order.merchant][authorization.nonce]) revert AuthorizationUsed();
        if (!_validSignature(order.merchant, authorizationDigest(authorization), rewardSignature,
            block.chainid == order.originChainId)) revert InvalidSignature();
        usedAuthorizations[order.merchant][authorization.nonce] = true;
        return _collect(order, signature, authorization.asset, authorization.reward, authorization.minimumMerchantAmount);
    }

    function _collect(PortableOrder calldata order, bytes calldata signature, address asset,
        uint256 reward, uint256 minimumMerchantAmount) private returns (address deposit)
    {
        if (!verifyOrder(order, signature)) revert InvalidSignature();
        bytes memory args = abi.encode(order);
        deposit = Clones.predictDeterministicAddressWithImmutableArgs(implementation, args, _salt(args), address(this));
        if (_balance(asset, deposit) == 0) revert NothingToCollect();
        if (deposit.code.length == 0) deposit = Clones.cloneDeterministicWithImmutableArgs(implementation, args, _salt(args));
        (uint256 received, uint256 merchantAmount, uint256 paidReward) =
            PaymentReceiver(payable(deposit)).execute(asset, msg.sender, reward, minimumMerchantAmount);
        emit PaymentCollected(order.id, deposit, order.merchant, asset, order.originChainId, block.chainid,
            order.amount, received, merchantAmount, paidReward, msg.sender);
    }

    function _domain(uint256 chainId) private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, address(this)));
    }
    function _validSignature(address merchant, bytes32 digest, bytes calldata signature, bool allow1271)
        private view returns (bool)
    {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err == ECDSA.RecoverError.NoError && signer == merchant) return true;
        // A foreign chain's contract state cannot prove the origin smart wallet's authorization.
        if (!allow1271 || merchant.code.length == 0) return false;
        try IERC1271(merchant).isValidSignature(digest, signature) returns (bytes4 magic) {
            return magic == IERC1271.isValidSignature.selector;
        } catch { return false; }
    }
    function _validate(PortableOrder calldata order) private view {
        if (order.merchant == address(0) || order.merchant == address(this) || order.merchant == implementation
            || order.originChainId == 0 || order.amount == 0 || order.executorFee >= order.amount) revert InvalidOrder();
    }
    function _salt(bytes memory args) private pure returns (bytes32) {
        // Origin chain is inside fixed args. Never use the executing chain here.
        return keccak256(abi.encodePacked("SALUTE_COLLECTION_V4", args));
    }
    function _balance(address asset, address deposit) private view returns (uint256) {
        return asset == address(0) ? deposit.balance : IERC20(asset).balanceOf(deposit);
    }
}
