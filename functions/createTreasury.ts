/**
 * AETHERION OS — createTreasury
 * Generates a new Solana wallet for a company's treasury.
 * Returns the public key (stored in Company.treasury_wallet) and
 * base64-encoded secret key (stored in Company.treasury_secret).
 *
 * POST body: { companyId: string }
 * 
 * If company already has a treasury_wallet, this will generate a NEW one
 * (useful for rotation). Old wallet keys are NOT recovered.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import { Keypair } from "npm:@solana/web3.js@1.95.2";

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

    // ── Generate new Solana keypair ───────────────────────────────────
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    const secretKeyBase64 = btoa(String.fromCharCode(...keypair.secretKey));

    // ── Update company with new treasury wallet ───────────────────────
    await base44.entities.Company.update(companyId, {
      treasury_wallet: publicKey,
      treasury_secret: secretKeyBase64,
    });

    // ── Log the treasury creation as a transaction record ─────────────
    await base44.entities.Transaction.create({
      company_id: companyId,
      type: "investment",
      amount_sol: 0,
      signature: "treasury_created",
      timestamp: new Date().toISOString(),
      from_wallet: "system",
      to_wallet: publicKey,
      description: `Treasury wallet created for ${company.name}`,
      verified: true,
    });

    return new Response(JSON.stringify({
      success: true,
      companyId,
      treasuryWallet: publicKey,
      message: `New Solana treasury wallet generated for ${company.name}. Fund this wallet to activate treasury operations.`,
      // WARNING: secretKey is stored in DB only — never returned to client
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("createTreasury error:", error);
    return new Response(JSON.stringify({
      error: "Failed to create treasury wallet",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
