// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ArgusVault} from "../src/ArgusVault.sol";

/// @notice Deploys ArgusVault to Unichain Sepolia (chain id 1301).
/// Required env:
///   PRIVATE_KEY            — deployer + initial owner
///   UNIVERSAL_ROUTER       — 0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d
///   AGENT_EOA              — execution-node signer (defaults to deployer if unset)
contract DeployArgusVault is Script {
    function run() external returns (ArgusVault vault) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address router = vm.envAddress("UNIVERSAL_ROUTER");
        address deployer = vm.addr(pk);
        address agent = vm.envOr("AGENT_EOA", deployer);

        require(block.chainid == 1301, "wrong-chain: expected Unichain Sepolia (1301)");
        require(router == 0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D, "wrong-router");

        vm.startBroadcast(pk);
        vault = new ArgusVault(router, agent, deployer);
        vm.stopBroadcast();

        console2.log("ArgusVault:", address(vault));
        console2.log("Owner:", deployer);
        console2.log("Agent:", agent);
        console2.log("Router:", router);
    }
}
