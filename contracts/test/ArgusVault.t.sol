// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ArgusVault} from "../src/ArgusVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Minimal Universal Router stub: pulls tokenIn from its balance and
///      mints tokenOut to recipient at a fixed 1:1 ratio. Lets us exercise
///      the agent-sig + nonce + Router calldata path without forking Unichain.
contract MockUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 /*deadline*/) external payable {
        require(commands.length == 1 && commands[0] == 0x00, "cmd");
        (address recipient, uint256 amountIn, uint256 amountOutMin, bytes memory path, bool payerIsUser) =
            abi.decode(inputs[0], (address, uint256, uint256, bytes, bool));
        require(!payerIsUser, "payer");
        (address tokenIn, address tokenOut) = _decodePath(path);

        // Burn tokenIn from router (received from vault), mint tokenOut to recipient.
        MockERC20(tokenIn).transfer(address(0xdead), amountIn);
        uint256 amountOut = amountIn; // 1:1
        require(amountOut >= amountOutMin, "slippage");
        MockERC20(tokenOut).mint(recipient, amountOut);
    }

    function _decodePath(bytes memory path) internal pure returns (address tokenIn, address tokenOut) {
        require(path.length == 43, "path-len"); // 20 + 3 + 20
        assembly {
            tokenIn := shr(96, mload(add(path, 32)))
            tokenOut := shr(96, mload(add(path, 55))) // 32 + 20 + 3
        }
    }
}

contract ArgusVaultTest is Test {
    ArgusVault internal vault;
    MockUniversalRouter internal router;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;

    address internal owner = address(0xA11CE);
    uint256 internal agentPk = 0xA6E47;
    address internal agent;

    bytes32 internal constant CHAT_ID_HASH = keccak256("chat-1");
    bytes32 internal constant OUTPUT_HASH = keccak256("output-1");
    bytes32 internal constant REQUEST_ID = keccak256("req-1");
    uint24 internal constant FEE = 3000;

    function setUp() public {
        agent = vm.addr(agentPk);
        router = new MockUniversalRouter();
        tokenIn = new MockERC20();
        tokenOut = new MockERC20();
        vault = new ArgusVault(address(router), agent, owner);

        tokenIn.mint(address(this), 1_000 ether);
        tokenIn.approve(address(vault), type(uint256).max);
        vault.deposit(address(tokenIn), 100 ether);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _params(uint256 amountIn) internal view returns (ArgusVault.SwapParams memory p) {
        p = ArgusVault.SwapParams({
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            fee: FEE,
            amountIn: amountIn,
            amountOutMin: amountIn, // 1:1 mock
            deadline: block.timestamp + 5 minutes
        });
    }

    function _sign(uint256 pk, uint256 nonce, uint256 amountIn) internal view returns (bytes memory) {
        bytes32 digest = vault.hashSwapTag(
            CHAT_ID_HASH, OUTPUT_HASH, nonce, REQUEST_ID, address(tokenIn), address(tokenOut), amountIn
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // Tests
    // ---------------------------------------------------------------------

    function test_HappyPath_SwapExecutes() public {
        uint256 amountIn = 10 ether;
        bytes memory sig = _sign(agentPk, 1, amountIn);

        vm.expectEmit(true, true, false, true, address(vault));
        emit ArgusVault.RebalanceExecuted(
            1, CHAT_ID_HASH, OUTPUT_HASH, address(tokenIn), address(tokenOut), amountIn, REQUEST_ID
        );
        vm.prank(agent);
        vault.executeRebalance(_params(amountIn), CHAT_ID_HASH, OUTPUT_HASH, 1, REQUEST_ID, sig);

        assertEq(tokenIn.balanceOf(address(vault)), 90 ether, "tokenIn debited");
        assertEq(tokenOut.balanceOf(address(vault)), 10 ether, "tokenOut credited");
        assertTrue(vault.usedNonces(1));
    }

    function test_Replay_Reverts() public {
        uint256 amountIn = 5 ether;
        bytes memory sig = _sign(agentPk, 7, amountIn);

        vm.prank(agent);
        vault.executeRebalance(_params(amountIn), CHAT_ID_HASH, OUTPUT_HASH, 7, REQUEST_ID, sig);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ArgusVault.NonceAlreadyUsed.selector, 7));
        vault.executeRebalance(_params(amountIn), CHAT_ID_HASH, OUTPUT_HASH, 7, REQUEST_ID, sig);
    }

    function test_WrongSigner_Reverts() public {
        uint256 wrongPk = 0xBADBAD;
        address wrongSigner = vm.addr(wrongPk);
        uint256 amountIn = 1 ether;
        bytes memory sig = _sign(wrongPk, 2, amountIn);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ArgusVault.InvalidSigner.selector, wrongSigner));
        vault.executeRebalance(_params(amountIn), CHAT_ID_HASH, OUTPUT_HASH, 2, REQUEST_ID, sig);
    }

    function test_DeadlinePassed_Reverts() public {
        uint256 amountIn = 1 ether;
        bytes memory sig = _sign(agentPk, 3, amountIn);
        ArgusVault.SwapParams memory p = _params(amountIn);
        vm.warp(p.deadline + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ArgusVault.DeadlinePassed.selector, p.deadline));
        vault.executeRebalance(p, CHAT_ID_HASH, OUTPUT_HASH, 3, REQUEST_ID, sig);
    }

    function test_TamperedAmount_Reverts() public {
        uint256 amountIn = 4 ether;
        bytes memory sig = _sign(agentPk, 4, amountIn);
        ArgusVault.SwapParams memory p = _params(amountIn + 1); // mismatch
        vm.prank(agent);
        vm.expectRevert(); // recovered != agentEOA
        vault.executeRebalance(p, CHAT_ID_HASH, OUTPUT_HASH, 4, REQUEST_ID, sig);
    }

    function test_Withdraw_OwnerOnly() public {
        vm.prank(owner);
        vault.withdraw(address(tokenIn), owner, 50 ether);
        assertEq(tokenIn.balanceOf(owner), 50 ether);

        vm.expectRevert();
        vault.withdraw(address(tokenIn), address(this), 1 ether);
    }

    function test_NonAgentCaller_Reverts() public {
        uint256 amountIn = 1 ether;
        bytes memory sig = _sign(agentPk, 11, amountIn);
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ArgusVault.NotAgent.selector, attacker));
        vault.executeRebalance(_params(amountIn), CHAT_ID_HASH, OUTPUT_HASH, 11, REQUEST_ID, sig);
    }

    function test_RotateAgent() public {
        address newAgent = address(0xBEEF);
        vm.prank(owner);
        vault.rotateAgent(newAgent);
        assertEq(vault.agentEOA(), newAgent);

        // Old agent (now non-agent) sig: caller-gate fires before signature check.
        bytes memory sig = _sign(agentPk, 9, 1 ether);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ArgusVault.NotAgent.selector, agent));
        vault.executeRebalance(_params(1 ether), CHAT_ID_HASH, OUTPUT_HASH, 9, REQUEST_ID, sig);
    }
}
