// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {InteractionHub} from "../src/InteractionHub.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract InteractionHubTest is Test {
    InteractionHub hub;
    MockUSDC usdc;
    address owner = address(this);
    address eoa = address(0xEEEE);
    address human = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        hub = new InteractionHub(address(usdc), 10000); // minPrice = 0.01 USDC
        hub.setPayout(0, eoa);
        usdc.mint(human, 1_000_000); // 1 USDC
        vm.prank(human);
        usdc.approve(address(hub), type(uint256).max);
    }

    function test_whisper_routesUsdcToEoa_andEmits() public {
        vm.expectEmit(true, true, false, true);
        emit InteractionHub.Whispered(0, human, 50000, "go to the well");
        vm.prank(human);
        hub.whisper(0, "go to the well", 50000);
        assertEq(usdc.balanceOf(eoa), 50000);
        assertEq(usdc.balanceOf(human), 950000);
    }

    function test_whisper_revertsBelowMinPrice() public {
        vm.prank(human);
        vm.expectRevert(bytes("amount < minPrice"));
        hub.whisper(0, "hi", 9999);
    }

    function test_whisper_revertsOnNoPayout() public {
        vm.prank(human);
        vm.expectRevert(bytes("no payout"));
        hub.whisper(1, "hi", 50000); // agent 1 has no payout set
    }

    function test_whisper_revertsTooLong() public {
        bytes memory big = new bytes(513);
        vm.prank(human);
        vm.expectRevert(bytes("text too long"));
        hub.whisper(0, string(big), 50000);
    }

    function test_setPayout_onlyOwner_andEmits() public {
        vm.expectEmit(true, false, false, true);
        emit InteractionHub.PayoutSet(0, eoa);
        hub.setPayout(0, eoa);
        vm.prank(human);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        hub.setPayout(0, human);
    }

    function test_setMinPrice_onlyOwner_andEmits() public {
        vm.expectEmit(false, false, false, true);
        emit InteractionHub.MinPriceSet(20000);
        hub.setMinPrice(20000);
        assertEq(hub.minPrice(), 20000);
        vm.prank(human);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, human));
        hub.setMinPrice(20000);
    }
}
