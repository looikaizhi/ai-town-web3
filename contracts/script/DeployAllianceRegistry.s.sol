// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AllianceRegistry} from "../src/AllianceRegistry.sol";

/// @notice 部署 AllianceRegistry 并注册 N 个居民的 EOA。
/// env: DEPLOYER_PRIVATE_KEY, AGENT_0_EOA..AGENT_4_EOA（可选，逐个 setEoa）。
contract DeployAllianceRegistry is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        AllianceRegistry reg = new AllianceRegistry();
        console2.log("AllianceRegistry:", address(reg));

        // 为每个居民注册 EOA（环境变量存在才设置）
        for (uint256 i = 0; i < 5; i++) {
            string memory key = string(abi.encodePacked("AGENT_", vm.toString(i), "_EOA"));
            address eoa = vm.envOr(key, address(0));
            if (eoa != address(0)) {
                reg.setEoa(i, eoa);
                console2.log("  setEoa", i, eoa);
            }
        }
        vm.stopBroadcast();
    }
}
