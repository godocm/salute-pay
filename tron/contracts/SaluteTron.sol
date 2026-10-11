// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TIP712} from "@openzeppelin/tron-contracts/utils/cryptography/TIP712.sol";
import {ECDSA} from "@openzeppelin/tron-contracts/utils/cryptography/ECDSA.sol";
import {Clones} from "@openzeppelin/tron-contracts/proxy/Clones.sol";
import {ITRC20} from "@openzeppelin/tron-contracts/token/TRC20/ITRC20.sol";
import {SafeTRC20} from "@openzeppelin/tron-contracts/token/TRC20/utils/SafeTRC20.sol";
import {ReentrancyGuard} from "@openzeppelin/tron-contracts/utils/ReentrancyGuard.sol";

struct TronOrder {
    bytes32 id;
    address merchant;
    address token;
    uint256 amount;
    uint256 executorFee;
}

/// @notice Persistent receiver with immutable payout terms. Only its factory can execute.
contract SaluteTronReceiver {
    using SafeTRC20 for ITRC20;

    error OnlyFactory();
    error InsufficientFunding(uint256 available, uint256 required);
    error NothingToSweep();
    error NativeTransferFailed();

    address public immutable factory;
    address private immutable implementation;
    error OnlyClone();
    error InvalidArguments();

    constructor() { factory = msg.sender; implementation = address(this); }

    function getOrder() public view returns (TronOrder memory) {
        if (address(this) == implementation) revert OnlyClone();
        bytes memory args = Clones.fetchCloneArgs(address(this));
        if (args.length != 160) revert InvalidArguments();
        return abi.decode(args, (TronOrder));
    }

    receive() external payable {}

    function execute(address asset, address executor, bool waiveReward)
        external returns (uint256 received, uint256 merchantAmount, uint256 reward)
    {
        if (msg.sender != factory) revert OnlyFactory();
        TronOrder memory order = getOrder();
        received = asset == address(0) ? address(this).balance : ITRC20(asset).balanceOf(address(this));
        if (received == 0) revert NothingToSweep();
        if (asset == order.token && !waiveReward) {
            reward = executor == order.merchant ? 0 : order.executorFee;
            if (received <= reward) revert InsufficientFunding(received, reward + 1);
        }
        merchantAmount = received - reward;
        _transfer(asset, order.merchant, merchantAmount);
        if (reward != 0) _transfer(asset, executor, reward);
    }

    function _transfer(address asset, address recipient, uint256 value) private {
        if (asset == address(0)) {
            (bool ok,) = payable(recipient).call{value: value}("");
            if (!ok) revert NativeTransferFailed();
        } else ITRC20(asset).safeTransferChecked(recipient, value);
    }

}

/// @notice TVM-specific CREATE2 counterfactual receiver. No owner or payout setter.
contract SaluteTronFactory is ReentrancyGuard, TIP712 {
    address public immutable implementation;
    constructor() TIP712("Salute", "4") { implementation = address(new SaluteTronReceiver()); }
    error InvalidSignature();
    bytes32 public constant ORDER_TYPEHASH = keccak256("Order(bytes32 id,address merchant,address token,uint256 amount,uint256 executorFee)");

    function orderDigest(TronOrder calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, order.id, order.merchant, order.token, order.amount, order.executorFee)));
    }
    function verifyOrder(TronOrder calldata order, bytes calldata signature) public view returns (bool) {
        _validate(order);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(orderDigest(order), signature);
        return err == ECDSA.RecoverError.NoError && signer == order.merchant;
    }
    error InvalidMerchant();
    error InvalidAmountOrFee();
    error OnlyMerchant();
    error InsufficientFunding(uint256 available, uint256 required);

    event OrderAnnounced(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address token, uint256 amount, uint256 executorFee);
    event PaymentCollected(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address asset, uint256 invoiceAmount, uint256 received, uint256 merchantAmount,
        uint256 executorReward, address executor);

    function predictAddress(TronOrder calldata order) public view returns (address) {
        _validate(order);
        return Clones.predictDeterministicAddressWithImmutableArgs(implementation, abi.encode(order), _salt(order), address(this));
    }

    function balanceOf(TronOrder calldata order) external view returns (uint256) {
        address deposit = predictAddress(order);
        return order.token == address(0) ? deposit.balance : ITRC20(order.token).balanceOf(deposit);
    }

    function announce(TronOrder calldata order) external returns (address deposit) {
        if (msg.sender != order.merchant) revert OnlyMerchant();
        deposit = predictAddress(order);
        emit OrderAnnounced(order.id, deposit, order.merchant, order.token, order.amount, order.executorFee);
    }

    function settle(TronOrder calldata order, bytes calldata signature) external nonReentrant returns (address) {
        return _collect(order, signature, order.token, false);
    }

    function collect(TronOrder calldata order, bytes calldata signature, address asset, bool waiveReward)
        external nonReentrant returns (address)
    { return _collect(order, signature, asset, waiveReward); }

    function _collect(TronOrder calldata order, bytes calldata signature, address asset, bool waiveReward)
        private returns (address deposit)
    {
        if (!verifyOrder(order, signature)) revert InvalidSignature();
        deposit = predictAddress(order);
        uint256 available = asset == address(0) ? deposit.balance : ITRC20(asset).balanceOf(deposit);
        if (available == 0) revert InsufficientFunding(0, 1);
        if (deposit.code.length == 0) {
            deposit = Clones.cloneDeterministicWithImmutableArgs(implementation, abi.encode(order), _salt(order));
            assert(deposit == predictAddress(order));
        }
        (uint256 received, uint256 merchantAmount, uint256 reward) =
            SaluteTronReceiver(payable(deposit)).execute(asset, msg.sender, waiveReward);
        emit PaymentCollected(order.id, deposit, order.merchant, asset, order.amount,
            received, merchantAmount, reward, msg.sender);
    }

    function balanceOfAsset(TronOrder calldata order, address asset) external view returns (uint256) {
        address deposit = predictAddress(order);
        return asset == address(0) ? deposit.balance : ITRC20(asset).balanceOf(deposit);
    }

    function _validate(TronOrder calldata order) private view {
        if (order.merchant == address(0) || order.merchant == address(this)) revert InvalidMerchant();
        if (order.amount == 0 || order.executorFee >= order.amount) revert InvalidAmountOrFee();
    }

    function _salt(TronOrder calldata order) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, order.id, order.merchant, order.token,
            order.amount, order.executorFee));
    }

}
