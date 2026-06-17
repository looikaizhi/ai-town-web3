// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice 人类付 USDC 向某居民「耳语」一句话:USDC 进居民 EOA(续命),并 emit 事件供链下索引。
contract InteractionHub is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    uint256 public minPrice; // atomic USDC (6dec)
    uint256 public constant MAX_TEXT_BYTES = 512;
    mapping(uint256 => address) public payoutEOA; // agentId => 续命 EOA

    event Whispered(uint256 indexed agentId, address indexed sender, uint256 amount, string text);
    event PayoutSet(uint256 indexed agentId, address eoa);
    event MinPriceSet(uint256 minPrice);

    constructor(address usdc_, uint256 minPrice_) Ownable(msg.sender) {
        require(usdc_ != address(0), "zero usdc");
        usdc = IERC20(usdc_);
        minPrice = minPrice_;
    }

    function setPayout(uint256 agentId, address eoa) external onlyOwner {
        require(eoa != address(0), "zero eoa");
        payoutEOA[agentId] = eoa;
        emit PayoutSet(agentId, eoa);
    }

    function setMinPrice(uint256 minPrice_) external onlyOwner {
        minPrice = minPrice_;
        emit MinPriceSet(minPrice_);
    }

    function whisper(uint256 agentId, string calldata text, uint256 amount) external {
        require(amount >= minPrice, "amount < minPrice");
        require(bytes(text).length <= MAX_TEXT_BYTES, "text too long");
        address to = payoutEOA[agentId];
        require(to != address(0), "no payout");
        usdc.safeTransferFrom(msg.sender, to, amount);
        emit Whispered(agentId, msg.sender, amount, text);
    }
}
