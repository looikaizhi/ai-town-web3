// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry reg;
    address factory = address(0xFAC);
    address keeper = address(0x4EE);
    address token = address(0x7011);
    address wallet = address(0x5A11E7); // CDP 钱包占位

    function setUp() public {
        reg = new AgentRegistry(factory, keeper);
    }

    function test_only_factory_can_register() public {
        vm.expectRevert(bytes("not factory"));
        reg.register(token, wallet, 10_000, 5_000_000, 10);
    }

    function test_register_stores_agent_and_increments_id() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        assertEq(id, 0);
        (address t, address w, uint256 cost, uint256 floor_, uint256 win, bool alive) = reg.agents(id);
        assertEq(t, token);
        assertEq(w, wallet);
        assertEq(cost, 10_000);
        assertEq(floor_, 5_000_000);
        assertEq(win, 10);
        assertTrue(alive);
        assertEq(reg.nextAgentId(), 1);
    }

    function test_only_keeper_can_mark_dead() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        vm.expectRevert(bytes("not keeper"));
        reg.markDead(id);
        vm.prank(keeper);
        reg.markDead(id);
        (,,,,, bool alive) = reg.agents(id);
        assertFalse(alive);
    }

    function test_marking_dead_twice_reverts() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        vm.startPrank(keeper);
        reg.markDead(id);
        vm.expectRevert(bytes("already dead"));
        reg.markDead(id);
        vm.stopPrank();
    }
}
