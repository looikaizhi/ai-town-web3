// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice 登记 居民 ↔ 代币 ↔ CDP 钱包 ↔ 生命参数；记录生死。
contract AgentRegistry {
    struct Agent {
        address token; // AgentToken 地址
        address wallet; // CDP 智能钱包地址
        uint256 costPerThink; // 单次思考算力费（USDC 6dec）
        uint256 floor; // 死亡地板（市值，USDC 6dec）
        uint256 recoveryWindow; // 抢救窗口 T（tick 数）
        bool alive;
    }

    address public immutable factory; // 仅 factory 可登记
    address public immutable keeper; // 仅 keeper 可判死（链下守护进程）
    uint256 public nextAgentId;
    mapping(uint256 => Agent) public agents;

    event AgentRegistered(uint256 indexed agentId, address token, address wallet);
    event AgentDied(uint256 indexed agentId);

    constructor(address factory_, address keeper_) {
        factory = factory_;
        keeper = keeper_;
    }

    function register(address token, address wallet, uint256 costPerThink, uint256 floor, uint256 recoveryWindow)
        external
        returns (uint256 agentId)
    {
        require(msg.sender == factory, "not factory");
        agentId = nextAgentId++;
        agents[agentId] = Agent(token, wallet, costPerThink, floor, recoveryWindow, true);
        emit AgentRegistered(agentId, token, wallet);
    }

    function markDead(uint256 agentId) external {
        require(msg.sender == keeper, "not keeper");
        require(agents[agentId].alive, "already dead");
        agents[agentId].alive = false;
        emit AgentDied(agentId);
    }
}
