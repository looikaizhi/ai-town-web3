// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {InteractionHub} from "../src/InteractionHub.sol";

/// @notice 部署 InteractionHub。env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, AGENT_0_EOA(可选,设 payout)。
contract DeployInteractionHub is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 minPrice = vm.envOr("WHISPER_MIN_PRICE", uint256(10000)); // 0.01 USDC
        address eoa = vm.envOr("AGENT_0_EOA", address(0));

        vm.startBroadcast(pk);
        InteractionHub hub = new InteractionHub(usdc, minPrice);
        if (eoa != address(0)) hub.setPayout(0, eoa);
        console2.log("InteractionHub:", address(hub));
        vm.stopBroadcast();
    }
}
