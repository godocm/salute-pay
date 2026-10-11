// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Test fixture only; deliberately unrestricted mode switch.
contract Mock1271Merchant is IERC1271 {
    address public immutable signer;
    uint8 public mode;

    constructor(address signer_) { signer = signer_; }
    function setMode(uint8 mode_) external { mode = mode_; }
    receive() external payable {}

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        require(mode != 2, "Test wallet rejects validation");
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return mode == 0 && err == ECDSA.RecoverError.NoError && recovered == signer
            ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
