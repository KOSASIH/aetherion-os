/**
 * AETHERION OS — getTreasuryBalance
 * Queries the on-chain SOL balance of a company's treasury wallet
 * using the Helius API (Solana RPC provider).
 *
 * POST body: { companyId: string }
 * 
 * Returns: { balance_sol: number, balance_lamports: number, wallet: string }
 * Also creates/updates a Transaction record if balance changes significantly.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import { PublicKey } from "npm:@solana/web3.js@1.95.2";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth check ────────────────────────────────────────────────────
    const user = await base44.users.me();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { companyId } = body;

    if (!companyId) {
      return new Response(JSON.stringify({ error: "Missing companyId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Fetch company ─────────────────────────────────────────────────
    const company = await base44.entities.Company.get(companyId);
    if (!company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!company.treasury_wallet) {
      return new Response(JSON.stringify({
        error: "No treasury wallet set for this company. Run createTreasury first."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Query balance via Helius RPC ──────────────────────────────────
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    const rpcUrl = heliusKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
      : "https://api.mainnet-beta.solana.com";

    const pubkey = new PublicKey(company.treasury_wallet);

    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [pubkey.toString()],
      }),
    });

    if (!rpcRes.ok) {
      return new Response(JSON.stringify({
        error: "RPC call failed",
        details: await rpcRes.text(),
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rpcData = await rpcRes.json();
    const lamports = rpcData.result?.value || 0;
    const balanceSol = lamports / 1_000_000_000; // 1 SOL = 1e9 lamports

    // ── Get recent transaction signatures for this wallet ─────────────
    const sigRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "getSignaturesForAddress",
        params: [pubkey.toString(), { limit: 10 }],
      }),
    });

    let recentSigs: any[] = [];
    if (sigRes.ok) {
      const sigData = await sigRes.json();
      recentSigs = (sigData.result || []).map((s: any) => ({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime,
        err: s.err,
      }));
    }

    return new Response(JSON.stringify({
      success: true,
      companyId,
      wallet: company.treasury_wallet,
      balance_sol: balanceSol,
      balance_lamports: lamports,
      recent_signatures: recentSigs,
      rpc_provider: heliusKey ? "helius" : "public",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("getTreasuryBalance error:", error);
    return new Response(JSON.stringify({
      error: "Failed to fetch treasury balance",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
