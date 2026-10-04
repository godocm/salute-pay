// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PaymentForwarder} from "./PaymentForwarder.sol";
import {Order} from "./PaymentTypes.sol";

/// @notice Counterfactual payment addresses with permissionless, atomic settlement.
/// @dev No owner, custody key, upgrade hook, allowlist, or fee-changing authority.
contract PaymentFactory is ReentrancyGuard {
    error InvalidMerchant();
    error InvalidAmountOrFee();
    error OnlyMerchant();
    error InsufficientFunding(uint256 available, uint256 required);

    /// @notice Optional public order availability and merchant authentication.
    /// No order storage or deposit deployment is needed; executors index logs.
    event OrderAnnounced(
        bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address token, uint256 amount, uint256 executorFee
    );

    event PaymentSettled(
        bytes32 indexed orderId,
        address indexed deposit,
        address indexed merchant,
        address token,
        uint256 requiredAmount,
        uint256 merchantAmount,
        uint256 executorFee,
        address executor
    );
    event LatePaymentSwept(
        bytes32 indexed orderId,
        address indexed deposit,
        address indexed merchant,
        address token,
        uint256 amount,
        address executor
    );

    address public immutable implementation;

    constructor() {
        implementation = address(new PaymentForwarder());
    }

    function predictAddress(Order calldata order) public view returns (address) {
        _validate(order);
        bytes memory args = _args(order);
        return Clones.predictDeterministicAddressWithImmutableArgs(
            implementation, args, _salt(args), address(this)
        );
    }

    function balanceOf(Order calldata order) external view returns (uint256) {
        return _balance(order.token, predictAddress(order));
    }

    /// @notice Publish terms before payment so independent executors can find them.
    /// @dev Duplicate announcements are harmless; indexers deduplicate by deposit.
    function announce(Order calldata order) external returns (address deposit) {
        if (msg.sender != order.merchant) revert OnlyMerchant();
        deposit = predictAddress(order);
        emit OrderAnnounced(order.id, deposit, order.merchant, order.token, order.amount, order.executorFee);
    }

    /// @notice First settlement requires `amount`, pays the fixed fee once, and
    /// sends ALL remaining funds to the merchant. Later calls forward without fees.
    /// @dev Payment and deployment share one transaction, so failures leave the
    /// original counterfactual deposit untouched and the order retryable.
    function settle(Order calldata order) external nonReentrant returns (address deposit) {
        _validate(order);
        bytes memory args = _args(order);
        bytes32 salt = _salt(args);
        deposit = Clones.predictDeterministicAddressWithImmutableArgs(
            implementation, args, salt, address(this)
        );

        bool initialPayment = deposit.code.length == 0;
        if (initialPayment) {
            uint256 available = _balance(order.token, deposit);
            if (available < order.amount) revert InsufficientFunding(available, order.amount);
            deposit = Clones.cloneDeterministicWithImmutableArgs(implementation, args, salt);
        }

        (uint256 merchantAmount, uint256 fee) =
            PaymentForwarder(payable(deposit)).execute(msg.sender, initialPayment);
        if (initialPayment) {
            emit PaymentSettled(
                order.id, deposit, order.merchant, order.token,
                order.amount, merchantAmount, fee, msg.sender
            );
        } else {
            emit LatePaymentSwept(
                order.id, deposit, order.merchant, order.token, merchantAmount, msg.sender
            );
        }
    }

    function _validate(Order calldata order) private view {
        if (order.merchant == address(0) || order.merchant == address(this)
            || order.merchant == implementation) revert InvalidMerchant();
        if (order.amount == 0 || order.executorFee >= order.amount) revert InvalidAmountOrFee();
    }

    function _args(Order calldata order) private pure returns (bytes memory) {
        return abi.encodePacked(order.id, order.merchant, order.token, order.amount, order.executorFee);
    }

    function _salt(bytes memory args) private view returns (bytes32) {
        // Every economic term AND chain identity binds the derived address.
        return keccak256(abi.encodePacked(block.chainid, args));
    }

    function _balance(address token, address deposit) private view returns (uint256) {
        return token == address(0) ? deposit.balance : IERC20(token).balanceOf(deposit);
    }
}
