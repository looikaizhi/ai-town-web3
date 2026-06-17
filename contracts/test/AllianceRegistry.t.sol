// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AllianceRegistry} from "../src/AllianceRegistry.sol";

contract AllianceRegistryTest is Test {
    AllianceRegistry reg;
    address eoa0 = address(0xA0);
    address eoa1 = address(0xA1);
    address eoa2 = address(0xA2);
    address owner = address(this);

    function setUp() public {
        reg = new AllianceRegistry();
        reg.setEoa(0, eoa0);
        reg.setEoa(1, eoa1);
        reg.setEoa(2, eoa2);
    }

    function test_propose_andEmits() public {
        vm.expectEmit(true, true, false, true);
        emit AllianceRegistry.AllianceProposed(0, 1, "lets team up");
        vm.prank(eoa0);
        reg.propose(0, 1, "lets team up");
        assertFalse(reg.allied(0, 1));
    }

    function test_accept_formsAlliance() public {
        vm.prank(eoa0);
        reg.propose(0, 1, "lets team up");
        vm.expectEmit(true, true, false, false);
        emit AllianceRegistry.AllianceFormed(0, 1);
        vm.prank(eoa1);
        reg.accept(0, 1);
        assertTrue(reg.allied(0, 1));
        assertTrue(reg.allied(1, 0));
    }

    function test_dissolve_byAgentA() public {
        vm.prank(eoa0);
        reg.propose(0, 1, "x");
        vm.prank(eoa1);
        reg.accept(0, 1);
        vm.expectEmit(true, true, false, false);
        emit AllianceRegistry.AllianceDissolved(0, 1);
        vm.prank(eoa0);
        reg.dissolve(0, 1);
        assertFalse(reg.allied(0, 1));
    }

    function test_dissolve_byAgentB() public {
        vm.prank(eoa0);
        reg.propose(0, 1, "x");
        vm.prank(eoa1);
        reg.accept(0, 1);
        vm.expectEmit(true, true, false, false);
        emit AllianceRegistry.AllianceDissolved(0, 1);
        vm.prank(eoa1);
        reg.dissolve(0, 1);
        assertFalse(reg.allied(0, 1));
    }

    function test_propose_revertsIfNotEoa() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(bytes("not agent eoa"));
        reg.propose(0, 1, "x");
    }

    function test_accept_revertsIfNoPending() public {
        vm.prank(eoa1);
        vm.expectRevert(bytes("no pending proposal"));
        reg.accept(0, 1);
    }

    function test_setEoa_onlyOwner() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        reg.setEoa(0, address(0xDEAD));
    }

    function test_dissolve_revertsIfNotAllied() public {
        vm.prank(eoa0);
        vm.expectRevert(bytes("not allied"));
        reg.dissolve(0, 1);
    }
}
