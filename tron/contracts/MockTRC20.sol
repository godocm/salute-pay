// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TRC20} from "@openzeppelin/tron-contracts/token/TRC20/TRC20.sol";

contract MockTRC20 is TRC20 {
    constructor() TRC20("Local Test USD", "TUSD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
