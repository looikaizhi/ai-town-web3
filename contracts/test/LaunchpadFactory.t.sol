// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {AgentToken} from "../src/AgentToken.sol";

contract LaunchpadFactoryTest is Test {
    MockUSDC usdc;
    AgentRegistry reg;
    LaunchpadFactory factory;
    address keeper = address(0x4EE);
    address wallet = address(0x5A11E7);

    function setUp() public {
        usdc = new MockUSDC();
        // registry.factory 必须是「即将部署的 factory」地址：用 CREATE 地址预测
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reg = new AgentRegistry(predicted, keeper);
        factory = new LaunchpadFactory(address(usdc), address(reg));
        assertEq(address(factory), predicted, "factory address prediction");
    }

    function test_spawn_deploys_token_and_registers() public {
        (uint256 id, address token) = factory.spawnAgent("Alice Coin", "ALICE", wallet, 10_000, 5_000_000, 10);
        assertEq(id, 0);
        assertTrue(token != address(0));
        assertEq(address(AgentToken(token).usdc()), address(usdc));
        (address t, address w, uint256 cost,,, bool alive) = reg.agents(id);
        assertEq(t, token);
        assertEq(w, wallet);
        assertEq(cost, 10_000);
        assertTrue(alive);
    }

    function test_spawn_emits_event() public {
        vm.expectEmit(false, false, false, false);
        emit LaunchpadFactory.AgentSpawned(0, address(0), wallet);
        factory.spawnAgent("Bob Coin", "BOB", wallet, 10_000, 5_000_000, 10);
    }
}
