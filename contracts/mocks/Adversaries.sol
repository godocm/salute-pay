// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockERC20} from "./MockERC20.sol";

/// @dev Security-test fixtures, never used in the application deployment.
contract AdversarialRecipient {
    address public target;
    bytes public payload;
    bool public reject;
    bool public attempted;
    bool public reentrySucceeded;

    function configure(address target_, bytes calldata payload_, bool reject_) external {
        target = target_;
        payload = payload_;
        reject = reject_;
    }

    function run(address target_, bytes calldata payload_) external {
        (bool ok, bytes memory reason) = target_.call(payload_);
        if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
    }

    receive() external payable {
        require(!reject, "Recipient rejects ETH");
        if (target != address(0)) {
            attempted = true;
            (reentrySucceeded,) = target.call(payload);
        }
    }
}

contract AdversarialToken is MockERC20 {
    address public target;
    bytes public payload;
    bool public reject;
    bool public attempted;
    bool public reentrySucceeded;

    constructor() MockERC20("Adversarial Token", "BAD", 18) {}

    function configure(address target_, bytes calldata payload_, bool reject_) external {
        target = target_;
        payload = payload_;
        reject = reject_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        require(!reject, "Token rejects transfer");
        if (target != address(0)) {
            attempted = true;
            (reentrySucceeded,) = target.call(payload);
        }
        return super.transfer(to, value);
    }
}

contract FalseReturnToken is MockERC20 {
    constructor() MockERC20("False Return Token", "FALSE", 18) {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}
