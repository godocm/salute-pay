// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Create2} from "@openzeppelin/tron-contracts/utils/Create2.sol";
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
    error AlreadySettled();
    error InsufficientFunding(uint256 available, uint256 required);
    error NothingToSweep();
    error NativeTransferFailed();

    bytes32 public immutable orderId;
    address public immutable merchant;
    address public immutable token;
    uint256 public immutable amount;
    uint256 public immutable executorFee;
    address public immutable factory;
    bool public settled;

    constructor(bytes32 id_, address merchant_, address token_, uint256 amount_, uint256 executorFee_) {
        orderId = id_;
        merchant = merchant_;
        token = token_;
        amount = amount_;
        executorFee = executorFee_;
        factory = msg.sender;
    }

    receive() external payable {}

    function execute(address executor) external returns (uint256 merchantAmount, uint256 reward, bool initial) {
        if (msg.sender != factory) revert OnlyFactory();
        uint256 balance = token == address(0) ? address(this).balance : ITRC20(token).balanceOf(address(this));
        initial = !settled;
        if (initial) {
            if (balance < amount) revert InsufficientFunding(balance, amount);
            settled = true;
            reward = executorFee;
        } else if (balance == 0) {
            revert NothingToSweep();
        }
        merchantAmount = balance - reward;
        if (executor == merchant) {
            _transfer(merchant, balance);
        } else {
            _transfer(merchant, merchantAmount);
            if (reward != 0) _transfer(executor, reward);
        }
    }

    function _transfer(address recipient, uint256 value) private {
        if (token == address(0)) {
            (bool ok,) = payable(recipient).call{value: value}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            ITRC20(token).safeTransferChecked(recipient, value);
        }
    }
}

/// @notice TVM-specific CREATE2 counterfactual receiver. No owner or payout setter.
contract SaluteTronFactory is ReentrancyGuard {
    error InvalidMerchant();
    error InvalidAmountOrFee();
    error OnlyMerchant();
    error InsufficientFunding(uint256 available, uint256 required);

    event OrderAnnounced(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address token, uint256 amount, uint256 executorFee);
    event PaymentSettled(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address token, uint256 requiredAmount, uint256 merchantAmount, uint256 executorFee, address executor);
    event LatePaymentSwept(bytes32 indexed orderId, address indexed deposit, address indexed merchant,
        address token, uint256 amount, address executor);

    function predictAddress(TronOrder calldata order) public view returns (address) {
        _validate(order);
        return Create2.computeAddress(_salt(order), keccak256(_initCode(order)), address(this));
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

    function settle(TronOrder calldata order) external nonReentrant returns (address deposit) {
        deposit = predictAddress(order);
        if (deposit.code.length == 0) {
            uint256 available = order.token == address(0) ? deposit.balance : ITRC20(order.token).balanceOf(deposit);
            if (available < order.amount) revert InsufficientFunding(available, order.amount);
            SaluteTronReceiver receiver = new SaluteTronReceiver{salt: _salt(order)}(
                order.id, order.merchant, order.token, order.amount, order.executorFee
            );
            deposit = address(receiver);
            assert(deposit == predictAddress(order));
        }
        (uint256 merchantAmount, uint256 reward, bool initial) = SaluteTronReceiver(payable(deposit)).execute(msg.sender);
        if (initial) {
            emit PaymentSettled(order.id, deposit, order.merchant, order.token, order.amount,
                merchantAmount, reward, msg.sender);
        } else {
            emit LatePaymentSwept(order.id, deposit, order.merchant, order.token, merchantAmount, msg.sender);
        }
    }

    function _validate(TronOrder calldata order) private view {
        if (order.merchant == address(0) || order.merchant == address(this)) revert InvalidMerchant();
        if (order.amount == 0 || order.executorFee >= order.amount) revert InvalidAmountOrFee();
    }

    function _salt(TronOrder calldata order) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, order.id, order.merchant, order.token,
            order.amount, order.executorFee));
    }

    function _initCode(TronOrder calldata order) private pure returns (bytes memory) {
        return abi.encodePacked(type(SaluteTronReceiver).creationCode,
            abi.encode(order.id, order.merchant, order.token, order.amount, order.executorFee));
    }
}
