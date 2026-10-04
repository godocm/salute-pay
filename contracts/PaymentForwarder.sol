// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Order} from "./PaymentTypes.sol";

/// @notice An immutable-argument minimal proxy pays an order exactly once.
/// @dev The factory is the only caller and guards reentrancy across every order.
contract PaymentForwarder {
    using SafeERC20 for IERC20;

    error OnlyFactory();
    error OnlyClone();
    error InvalidCloneArguments();
    error InsufficientFunding(uint256 available, uint256 required);
    error NativeTransferFailed(address recipient);
    error NothingToSweep();

    address public immutable factory;
    address private immutable _implementation;

    constructor() {
        factory = msg.sender;
        _implementation = address(this);
    }

    modifier onlyClone() {
        if (address(this) == _implementation) revert OnlyClone();
        _;
    }

    receive() external payable onlyClone {}

    /// @notice Every canonical clone visible after a transaction is settled.
    /// @dev Deployment and first payout are atomic. Reverts remove the clone, so
    /// its existence replaces an otherwise redundant 20,000-gas storage write.
    function settled() external view onlyClone returns (bool) {
        return true;
    }

    /// @notice Terms are stored in the clone's immutable runtime-code suffix.
    function getOrder() public view onlyClone returns (Order memory order) {
        bytes memory args = Clones.fetchCloneArgs(address(this));
        if (args.length != 136) revert InvalidCloneArguments();
        // Packed layout: id[32], merchant[20], token[20], amount[32], fee[32].
        assembly ("memory-safe") {
            mstore(order, mload(add(args, 32)))
            mstore(add(order, 32), shr(96, mload(add(args, 64))))
            mstore(add(order, 64), shr(96, mload(add(args, 84))))
            mstore(add(order, 96), mload(add(args, 104)))
            mstore(add(order, 128), mload(add(args, 136)))
        }
    }

    /// @dev Caller identity cannot select a different merchant or change the fee.
    function execute(address executor, bool initialPayment)
        external
        onlyClone
        returns (uint256 merchantAmount, uint256 fee)
    {
        if (msg.sender != factory) revert OnlyFactory();
        Order memory order = getOrder();
        uint256 balance = order.token == address(0)
            ? address(this).balance
            : IERC20(order.token).balanceOf(address(this));

        if (initialPayment) {
            if (balance < order.amount) revert InsufficientFunding(balance, order.amount);
            // Only the guarded factory can select this path, and only immediately
            // after CREATE2. Every subsequent call necessarily sees deployed code.
            fee = order.executorFee;
        } else if (balance == 0) {
            revert NothingToSweep();
        }

        merchantAmount = balance - fee;
        if (executor == order.merchant) {
            _transfer(order.token, order.merchant, balance);
        } else {
            _transfer(order.token, order.merchant, merchantAmount);
            if (fee != 0) _transfer(order.token, executor, fee);
        }
    }

    function _transfer(address token, address recipient, uint256 amount) private {
        if (token == address(0)) {
            (bool success,) = recipient.call{value: amount}("");
            if (!success) revert NativeTransferFailed(recipient);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }
}
