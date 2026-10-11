// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Testnet-only token. Freely mintable, valueless.
contract TestUSD is ERC20 {
    constructor(address merchant) ERC20("Salute Test USD", "sUSD") {
        require(merchant != address(0));
        _mint(merchant, 1_000_000 * 10 ** 6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
