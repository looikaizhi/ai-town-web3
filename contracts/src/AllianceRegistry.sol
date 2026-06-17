// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice 居民间链上结盟状态：提案 → 接受 → 结盟；单方可解除。
contract AllianceRegistry is Ownable {
    mapping(uint256 => address) public agentEoa;

    mapping(bytes32 => bool) private _allied;
    mapping(bytes32 => bool) private _pending;

    event AllianceProposed(uint256 indexed agentA, uint256 indexed agentB, string message);
    event AllianceFormed(uint256 indexed agentA, uint256 indexed agentB);
    event AllianceDissolved(uint256 indexed agentA, uint256 indexed agentB);

    constructor() Ownable(msg.sender) {}

    function setEoa(uint256 agentId, address eoa) external onlyOwner {
        require(eoa != address(0), "zero eoa");
        agentEoa[agentId] = eoa;
    }

    function propose(uint256 agentA, uint256 agentB, string calldata message) external {
        require(msg.sender == agentEoa[agentA], "not agent eoa");
        require(agentEoa[agentA] != address(0) && agentEoa[agentB] != address(0), "unknown agent");
        require(!allied(agentA, agentB), "already allied");
        _pending[_pendingKey(agentA, agentB)] = true;
        emit AllianceProposed(agentA, agentB, message);
    }

    function accept(uint256 agentA, uint256 agentB) external {
        require(msg.sender == agentEoa[agentB], "not agent eoa");
        require(_pending[_pendingKey(agentA, agentB)], "no pending proposal");
        _pending[_pendingKey(agentA, agentB)] = false;
        _allied[_allianceKey(agentA, agentB)] = true;
        emit AllianceFormed(agentA, agentB);
    }

    function dissolve(uint256 agentA, uint256 agentB) external {
        address sender = msg.sender;
        require(sender == agentEoa[agentA] || sender == agentEoa[agentB], "not agent eoa");
        require(allied(agentA, agentB), "not allied");
        _allied[_allianceKey(agentA, agentB)] = false;
        emit AllianceDissolved(agentA, agentB);
    }

    function allied(uint256 a, uint256 b) public view returns (bool) {
        return _allied[_allianceKey(a, b)];
    }

    function hasPendingProposal(uint256 agentA, uint256 agentB) external view returns (bool) {
        return _pending[_pendingKey(agentA, agentB)];
    }

    function _allianceKey(uint256 a, uint256 b) private pure returns (bytes32) {
        (uint256 lo, uint256 hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(lo, hi));
    }

    function _pendingKey(uint256 a, uint256 b) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("pending", a, b));
    }
}
