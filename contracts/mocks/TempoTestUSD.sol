// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ITIP20Factory {
    function createToken(string calldata,string calldata,string calldata,address,address,bytes32) external returns(address);
}
interface ITIP20Mint {
    function grantRole(bytes32,address) external;
    function renounceRole(bytes32) external;
    function mint(address,uint256) external;
}

/// @notice Test-only TIP-20 issuance, with initial supply atomically minted.
/// @dev The merchant receives token admin/issuer roles. Settlement has no admin.
contract TempoTestUSD {
    address public immutable token;
    constructor(address merchant, address quoteToken, bytes32 salt) {
        require(merchant != address(0), "merchant required");
        token = ITIP20Factory(0x20Fc000000000000000000000000000000000000)
            .createToken("Salute Test USD", "sUSD", "USD", quoteToken, address(this), salt);
        ITIP20Mint t = ITIP20Mint(token);
        bytes32 issuer = keccak256("ISSUER_ROLE");
        t.grantRole(issuer, address(this));
        t.mint(merchant, 1_000_000 * 1e6);
        t.grantRole(issuer, merchant);
        // Test-token faucet authority only; this key cannot authorize payments.
        t.grantRole(issuer, msg.sender);
        t.grantRole(bytes32(0), merchant);
        t.renounceRole(bytes32(0));
    }

    /// @notice Permissionless faucet for valueless testnet payment tokens only.
    function mint(address to, uint256 amount) external {
        require(to != address(0) && amount > 0 && amount <= 1_000_000 * 1e6, "invalid faucet request");
        ITIP20Mint(token).mint(to, amount);
    }
}
