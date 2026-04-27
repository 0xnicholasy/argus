// Dry-run a Uniswap V3 quote on Unichain Sepolia via QuoterV2.quoteExactInputSingle.
// Run: tsx scripts/quote-dryrun.ts
//
// Acceptance: prints amountOut > 0 for chosen pair. Confirms route + slippage envelope
// before execution-node ships swap calls (P5 acceptance — pre-flight for P6).

import "dotenv/config";
import { Contract, JsonRpcProvider, formatUnits, parseUnits, type BaseContract } from "ethers";
import { loadEnv } from "../packages/shared/src/env.js";

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];
const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

type Quoter = BaseContract & {
  quoteExactInputSingle: {
    staticCall(p: {
      tokenIn: string;
      tokenOut: string;
      amountIn: bigint;
      fee: number;
      sqrtPriceLimitX96: bigint;
    }): Promise<[bigint, bigint, number, bigint]>;
  };
};
type Erc20 = BaseContract & { decimals(): Promise<bigint>; symbol(): Promise<string> };

const SLIPPAGE_BPS = 50n;
const BPS = 10_000n;

async function main(): Promise<void> {
  const env = loadEnv();

  const quoterAddr = process.env.UNISWAP_QUOTER_V2;
  const tokenIn = process.env.QUOTE_TOKEN_IN;
  const tokenOut = process.env.QUOTE_TOKEN_OUT;
  const amountInHuman = process.env.QUOTE_AMOUNT_IN ?? "0.001";
  const feeStr = process.env.QUOTE_FEE ?? "3000";

  const missing = [
    ["UNISWAP_QUOTER_V2", quoterAddr],
    ["QUOTE_TOKEN_IN", tokenIn],
    ["QUOTE_TOKEN_OUT", tokenOut],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`missing env: ${missing.join(", ")}`);
  }

  const provider = new JsonRpcProvider(env.UNICHAIN_SEPOLIA_RPC);
  const quoter = new Contract(quoterAddr as string, QUOTER_V2_ABI, provider) as unknown as Quoter;

  const [inDec, inSym, outDec, outSym] = await Promise.all([
    (new Contract(tokenIn as string, ERC20_ABI, provider) as unknown as Erc20).decimals(),
    (new Contract(tokenIn as string, ERC20_ABI, provider) as unknown as Erc20).symbol(),
    (new Contract(tokenOut as string, ERC20_ABI, provider) as unknown as Erc20).decimals(),
    (new Contract(tokenOut as string, ERC20_ABI, provider) as unknown as Erc20).symbol(),
  ]);

  const amountIn = parseUnits(amountInHuman, Number(inDec));
  const fee = Number.parseInt(feeStr, 10);

  const params = {
    tokenIn: tokenIn as string,
    tokenOut: tokenOut as string,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0n,
  };

  const result = await quoter.quoteExactInputSingle.staticCall(params);
  const amountOut = result[0];
  const minOut = (amountOut * (BPS - SLIPPAGE_BPS)) / BPS;

  console.log(JSON.stringify({
    pair: `${inSym}->${outSym}`,
    fee,
    amountIn: formatUnits(amountIn, Number(inDec)),
    amountOut: formatUnits(amountOut, Number(outDec)),
    amountOutMin: formatUnits(minOut, Number(outDec)),
    slippageBps: Number(SLIPPAGE_BPS),
    gasEstimate: result[3].toString(),
  }, null, 2));

  if (amountOut === 0n) {
    throw new Error("amountOut == 0 — pool not initialized or insufficient liquidity");
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`quote-dryrun failed: ${msg}`);
  process.exit(1);
});
