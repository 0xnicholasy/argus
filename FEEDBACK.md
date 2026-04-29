# Uniswap Builder Feedback — Argus (ETHGlobal Open Agents 2026)

Project: Argus, an autonomous AI keeper that signs EIP-712 swap intents and routes them through the Uniswap Universal Router on Unichain Sepolia. Below is the friction we hit while integrating, in priority order.

## 1. Universal Router `execute()` command encoding is underdocumented

The single biggest time sink. The router's public surface is `execute(bytes commands, bytes[] inputs, uint256 deadline)`, but nowhere in the official Uniswap docs is the mapping from command id to expected ABI-encoded input layout consolidated. We had to read `Commands.sol` and `Dispatcher.sol` source to learn that `V3_SWAP_EXACT_IN = 0x00` expects `(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)`. A canonical reference page mapping every command id to its `abi.decode` shape (with a worked V3 and V4 example) would save every integrator hours.

## 2. V3 path encoding gotcha

`abi.encodePacked(tokenIn, uint24 fee, tokenOut)` is documented in the v3 SDK but not on the Universal Router page. Because `commands` is a packed byte string and `inputs[i]` is standard ABI-encoded, it is easy to confuse the two and silently produce a path the router rejects with no useful revert reason. A "common mistakes" callout would help.

## 3. No typed TypeScript SDK for Universal Router

`@uniswap/universal-router-sdk` exists but is geared toward the wallet-style flow (NFT + swap composition) and does not expose a clean, viem-native helper for "encode one V3 swap with `payerIsUser=false`" — which is what every contract-vault integration actually needs. We ended up hand-rolling `abi.encodePacked` in Solidity and a parallel `encodePacked` builder in TypeScript for tests. A minimal `encodeV3ExactIn({ recipient, path, amountIn, amountOutMin, payerIsUser })` helper exported from the SDK would close this gap.

## 4. QuoterV2 not linked from Universal Router docs

`QuoterV2.quoteExactInputSingle` was easy to use once located, but the Universal Router page never mentions it. Integrators land on the router page, see no quote primitive, and hunt around. A "Pre-flight: get a quote" link block would help.

## 5. Unichain Sepolia faucet reliability

Faucet cooldown is 12 hours and fails opaquely when over quota. We had to fall back to bridging from Sepolia mid-build. Documenting two or three known-good faucets and the cooldown explicitly on the Unichain docs landing would prevent lost time.

## 6. Address book pain

The Universal Router address `0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d` on Unichain Sepolia is correct but is not surfaced on a single canonical "deployments" page indexed by network. We had to confirm it from the v4-template repo. A machine-readable JSON of router/quoter/permit2/poolmanager addresses per testnet would be a clear win.

## What worked well

- `forge test` against a forked Unichain Sepolia was painless once the router address was known.
- `Permit2` + Universal Router separation kept our vault code clean — only one `approve` to Permit2 needed.
- Event semantics on the router's underlying pool calls let us tag `RebalanceExecuted` with `chatIdHash` and `outputHash` cleanly.

Overall, the Universal Router is the right primitive for an agent-driven vault; the gaps above are documentation and SDK ergonomics, not protocol design. We would integrate again.

---

Submission receipt: this feedback will also be submitted via the official Uniswap form prior to hackathon close (May 6). Receipt artifact will be placed at `docs/uniswap-feedback-receipt.png` once submitted.

