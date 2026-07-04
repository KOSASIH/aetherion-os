/**
 * AETHERION OS — distributeYield
 * Reads the shareholders table for a company, calculates each shareholder's
 * yield (based on their shares_percentage of total revenue), and sends
 * SOL from the treasury wallet to each shareholder wallet via Solana transfer.
 *
 * POST body: { companyId: string, percentage?: number }
 *   - percentage: What % of treasury to distribute (default: 20)
 *
 * Flow:
 * 1. Fetch company + treasury wallet (decrypt secret key)
 * 2. Fetch all shareholders for the company
 * 3. Check treasury balance via Helius RPC
 * 4. Calculate yield per shareholder (proportional to shares_percentage)
 * 5. Build + sign Solana transfer transactions
 * 6. Submit to Solana mainnet
 * 7. Verify each signature on-chain
 * 8. Update shareholder.claimed_yield + create Transaction records
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "npm:@solana/web3.js@1.95.2";

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
    const { companyId, percentage = 20 } = body;

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

    if (!company.treasury_wallet || !company.treasury_secret) {
      return new Response(JSON.stringify({
        error: "No treasury wallet configured. Run createTreasury first."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Reconstruct treasury keypair from stored secret ───────────────
    const secretBytes = Uint8Array.from(atob(company.treasury_secret), c => c.charCodeAt(0));
    const treasuryKeypair = Keypair.fromSecretKey(secretBytes);

    // Verify the keypair matches the stored public key
    if (treasuryKeypair.publicKey.toString() !== company.treasury_wallet) {
      return new Response(JSON.stringify({
        error: "Treasury key mismatch — stored secret does not match public key"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Fetch shareholders ────────────────────────────────────────────
    const shareholders = await base44.entities.Shareholder.list({
      filter: { company_id: companyId },
    });

    if (!shareholders || shareholders.length === 0) {
      return new Response(JSON.stringify({
        error: "No shareholders found for this company"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Connect to Solana ─────────────────────────────────────────────
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    const rpcUrl = heliusKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
      : "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // ── Check treasury balance ────────────────────────────────────────
    const treasuryBalance = await connection.getBalance(treasuryKeypair.publicKey);
    const treasurySol = treasuryBalance / LAMPORTS_PER_SOL;

    if (treasurySol < 0.001) {
      return new Response(JSON.stringify({
        error: "Insufficient treasury balance",
        balance_sol: treasurySol,
        message: "Treasury wallet needs to be funded before distributing yield."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Calculate distribution ────────────────────────────────────────
    // Distribute `percentage`% of treasury balance, proportional to each
    // shareholder's shares_percentage
    const distributionPool = Math.floor(treasuryBalance * (percentage / 100));
    const totalSharesPct = shareholders.reduce(
      (sum: number, s: any) => sum + (s.shares_percentage || 0), 0
    );

    if (totalSharesPct === 0) {
      return new Response(JSON.stringify({
        error: "Total shares percentage is 0 — cannot calculate distribution"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Execute transfers ─────────────────────────────────────────────
    const results: any[] = [];
    let totalDistributed = 0;

    for (const shareholder of shareholders) {
      // Proportional allocation
      const shareholderPct = (shareholder.shares_percentage || 0) / totalSharesPct;
      const amountLamports = Math.floor(distributionPool * shareholderPct);

      // Skip dust amounts (< 0.0001 SOL)
      if (amountLamports < 100_000) {
        results.push({
          shareholder_id: shareholder.id,
          wallet: shareholder.wallet,
          status: "skipped",
          reason: "Amount below dust threshold",
          amount_lamports: amountLamports,
        });
        continue;
      }

      try {
        // ── Build Solana transfer ──────────────────────────────────────
        const recipientPubkey = new PublicKey(shareholder.wallet);
        const transferIx = SystemProgram.transfer({
          fromPubkey: treasuryKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports: amountLamports,
        });

        const tx = new Transaction().add(transferIx);

        // ── Sign + submit ──────────────────────────────────────────────
        const signature = await sendAndConfirmTransaction(
          connection,
          tx,
          [treasuryKeypair]
        );

        // ── Verify on-chain ────────────────────────────────────────────
        const confirmation = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        const verified = confirmation && !confirmation.meta?.err;

        if (!verified) {
          results.push({
            shareholder_id: shareholder.id,
            wallet: shareholder.wallet,
            status: "failed_verification",
            signature,
            amount_lamports: amountLamports,
          });
          continue;
        }

        const amountSol = amountLamports / LAMPORTS_PER_SOL;
        totalDistributed += amountLamports;

        // ── Update shareholder record ──────────────────────────────────
        await base44.entities.Shareholder.update(shareholder.id, {
          claimed_yield: (shareholder.claimed_yield || 0) + amountSol,
          last_yield_date: new Date().toISOString(),
        });

        // ── Create transaction record ──────────────────────────────────
        await base44.entities.Transaction.create({
          company_id: companyId,
          type: "yield_distribution",
          amount_sol: amountSol,
          signature: signature,
          timestamp: new Date().toISOString(),
          from_wallet: company.treasury_wallet,
          to_wallet: shareholder.wallet,
          description: `Yield distribution to shareholder (${shareholder.shares_percentage}%)`,
          verified: true,
        });

        results.push({
          shareholder_id: shareholder.id,
          wallet: shareholder.wallet,
          status: "success",
          signature,
          amount_sol: amountSol,
          amount_lamports: amountLamports,
          verified: true,
        });

      } catch (txError) {
        console.error(`Transfer failed for shareholder ${shareholder.id}:`, txError);
        results.push({
          shareholder_id: shareholder.id,
          wallet: shareholder.wallet,
          status: "error",
          error: txError.message || String(txError),
        });
      }
    }

    // ── Update company revenue ────────────────────────────────────────
    const totalDistributedSol = totalDistributed / LAMPORTS_PER_SOL;
    const newRevenue = (company.revenue || 0) + totalDistributedSol;
    await base44.entities.Company.update(companyId, {
      revenue: newRevenue,
    });

    return new Response(JSON.stringify({
      success: true,
      companyId,
      treasury_balance_sol: treasurySol,
      distribution_percentage: percentage,
      total_distributed_sol: totalDistributedSol,
      shareholders_processed: results.length,
      results,
      message: `Distributed ${totalDistributedSol} SOL to ${results.filter(r => r.status === "success").length} shareholders.`,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("distributeYield error:", error);
    return new Response(JSON.stringify({
      error: "Yield distribution failed",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});