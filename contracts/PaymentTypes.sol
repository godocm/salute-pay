// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice `amount` includes the executor fee. `token == address(0)` means native ETH.
struct Order {
    bytes32 id;
    address merchant;
    address token;
    uint256 amount;
    uint256 executorFee;
}
