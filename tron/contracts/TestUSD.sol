// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {TRC20} from "@openzeppelin/tron-contracts/token/TRC20/TRC20.sol";
/// @notice Testnet-only, freely mintable. Never use as money.
contract TestUSD is TRC20 {
    constructor(address merchant) TRC20("Salute Test USD", "sUSD") {
        require(merchant != address(0));
        _mint(merchant, 1_000_000 * 10 ** 6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
