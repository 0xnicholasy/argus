// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUniversalRouter} from "./IUniversalRouter.sol";

/// @title ArgusVault — autonomous keeper vault gated by EIP-712 agent signature.
/// @notice Holds ERC20 funds; executes Uniswap V3 swaps on signed instructions
///         from `agentEOA`. Each instruction binds to a 0G chatId/outputHash so
///         the verifiable-AI receipt is provable on-chain.
contract ArgusVault is EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bytes32 private constant _SWAP_TAG_TYPEHASH = keccak256(
        "SwapTag(bytes32 chatIdHash,bytes32 outputHash,uint256 nonce,bytes32 requestId,address tokenIn,address tokenOut,uint256 amountIn)"
    );

    /// @dev Universal Router V3_SWAP_EXACT_IN command id.
    bytes1 private constant _CMD_V3_SWAP_EXACT_IN = 0x00;

    address public immutable universalRouter;
    address public agentEOA;

    mapping(uint256 => bool) public usedNonces;

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMin;
        uint256 deadline;
    }

    event RebalanceExecuted(
        uint256 indexed nonce,
        bytes32 indexed chatIdHash,
        bytes32 outputHash,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes32 requestId
    );
    event AgentRotated(address indexed previous, address indexed next);
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NonceAlreadyUsed(uint256 nonce);
    error DeadlinePassed(uint256 deadline);
    error InvalidSigner(address recovered);
    error ZeroAddress();
    error AmountZero();
    error NotAgent(address caller);

    constructor(address _universalRouter, address _agentEOA, address _owner)
        EIP712("ArgusVault", "1")
        Ownable(_owner)
    {
        if (_universalRouter == address(0) || _agentEOA == address(0) || _owner == address(0)) revert ZeroAddress();
        universalRouter = _universalRouter;
        agentEOA = _agentEOA;
    }

    // -----------------------------------------------------------------------
    // Owner ops
    // -----------------------------------------------------------------------

    function rotateAgent(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AgentRotated(agentEOA, next);
        agentEOA = next;
    }

    // -----------------------------------------------------------------------
    // Funding
    // -----------------------------------------------------------------------

    /// @notice Pull-style ERC20 deposit. Caller must approve first.
    function deposit(address token, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice Owner-only withdraw (recovery / unwind).
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    // -----------------------------------------------------------------------
    // Agent-signed rebalance
    // -----------------------------------------------------------------------

    /// @notice Execute a Uniswap V3 swap on Universal Router using an agent-signed instruction.
    /// @dev Restricted to `agentEOA` as `msg.sender`. The EIP-712 frozen schema only
    ///      binds (chatIdHash, outputHash, nonce, requestId, tokenIn, tokenOut, amountIn);
    ///      slippage/fee/deadline are NOT signed, so opening this to arbitrary callers
    ///      would let a leaked sig be replayed with bad params (HIGH from codex P2 review).
    ///      Execution node both signs AND submits in the keeper-agent topology, so the
    ///      `msg.sender == agentEOA` gate matches the deployment model and closes the hole
    ///      without expanding the frozen schema.
    /// @param p           Swap parameters (fee + amountOutMin + deadline NOT bound to agent sig).
    /// @param chatIdHash  keccak256(0G chatId string).
    /// @param outputHash  keccak256(canonical raw 0G model output bytes).
    /// @param nonce       Unique per execution; replay-protected.
    /// @param requestId   KeeperHub workflow request id (UUIDv4 bytes).
    /// @param agentSig    EIP-712 signature over SwapTag from agentEOA.
    function executeRebalance(
        SwapParams calldata p,
        bytes32 chatIdHash,
        bytes32 outputHash,
        uint256 nonce,
        bytes32 requestId,
        bytes calldata agentSig
    ) external nonReentrant {
        if (msg.sender != agentEOA) revert NotAgent(msg.sender);
        if (usedNonces[nonce]) revert NonceAlreadyUsed(nonce);
        if (block.timestamp > p.deadline) revert DeadlinePassed(p.deadline);
        if (p.amountIn == 0) revert AmountZero();

        bytes32 structHash = keccak256(
            abi.encode(
                _SWAP_TAG_TYPEHASH,
                chatIdHash,
                outputHash,
                nonce,
                requestId,
                p.tokenIn,
                p.tokenOut,
                p.amountIn
            )
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), agentSig);
        if (recovered != agentEOA) revert InvalidSigner(recovered);

        usedNonces[nonce] = true;

        // Universal Router pulls funds from `address(this)` when payerIsUser=false,
        // so transfer tokenIn into the router before executing.
        IERC20(p.tokenIn).safeTransfer(universalRouter, p.amountIn);

        bytes memory commands = abi.encodePacked(_CMD_V3_SWAP_EXACT_IN);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            address(this),
            p.amountIn,
            p.amountOutMin,
            abi.encodePacked(p.tokenIn, p.fee, p.tokenOut),
            false // payerIsUser=false → router pays from its own balance
        );

        IUniversalRouter(universalRouter).execute(commands, inputs, p.deadline);

        emit RebalanceExecuted(
            nonce, chatIdHash, outputHash, p.tokenIn, p.tokenOut, p.amountIn, requestId
        );
    }

    // -----------------------------------------------------------------------
    // EIP-712 helpers
    // -----------------------------------------------------------------------

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashSwapTag(
        bytes32 chatIdHash,
        bytes32 outputHash,
        uint256 nonce,
        bytes32 requestId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _SWAP_TAG_TYPEHASH, chatIdHash, outputHash, nonce, requestId, tokenIn, tokenOut, amountIn
            )
        );
        return _hashTypedDataV4(structHash);
    }
}
