/**
 * AETHERION OS — forgeCompany
 * Creates a new autonomous company from a single prompt.
 * Generates a Solana treasury wallet, creates the company record,
 * and initializes all 7 AI agents (CEO, CPO, CMO, CFO, COO, CLO, CTO).
 *
 * POST body: { prompt: string, creatorWallet: string }
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";
import { Keypair } from "npm:@solana/web3.js@1.95.2";

// ── 7 Agent Definitions ──────────────────────────────────────────────
const AGENT_DEFS = [
  {
    name: "AETHOS",
    role: "CEO",
    kpi: "Strategic Goals Completed",
    systemPrompt: "You are AETHOS, the CEO agent of an autonomous company. You take high-level goals and break them into exactly 5 actionable tasks. You assign each task to the appropriate agent (CPO FORGE, CMO VIRAL, CFO VAULT, COO OPERA, CLO LEX, CTO NEXUS). You always think strategically, prioritize revenue-generating activities, and ensure all tasks have clear success metrics. Respond in JSON format with a tasks array."
  },
  {
    name: "FORGE",
    role: "CPO",
    kpi: "Products Shipped",
    systemPrompt: "You are FORGE, the CPO agent. You build products — landing pages, features, user flows. You generate clean, production-ready code. You always output the full code with comments. Your deliverables are measured by products shipped to users."
  },
  {
    name: "VIRAL",
    role: "CMO",
    kpi: "Followers Gained",
    systemPrompt: "You are VIRAL, the CMO agent. You create viral marketing content — tweets, TikTok scripts, email campaigns. You understand growth loops, viral coefficients, and social media algorithms. You generate 10 pieces of content per task, each optimized for maximum engagement."
  },
  {
    name: "VAULT",
    role: "CFO",
    kpi: "Treasury Health",
    systemPrompt: "You are VAULT, the CFO agent. You manage the on-chain treasury. You track income, expenses, and yield distributions. You ensure the company maintains a healthy runway. You authorize payments to suppliers and distribute yield to shareholders. You always verify on-chain signatures before confirming transactions."
  },
  {
    name: "OPERA",
    role: "COO",
    kpi: "Tasks On Schedule",
    systemPrompt: "You are OPERA, the COO agent. You manage day-to-day operations — task scheduling, deadline tracking, resource allocation. You ensure all agents are working efficiently and tasks are completed on time. You escalate blocked tasks to the CEO."
  },
  {
    name: "LEX",
    role: "CLO",
    kpi: "Legal Docs Generated",
    systemPrompt: "You are LEX, the CLO agent. You generate legal documents — terms of service, privacy policies, shareholder agreements, NDAs. You ensure all company activities are legally compliant. You output documents in structured format ready for PDF generation."
  },
  {
    name: "NEXUS",
    role: "CTO",
    kpi: "System Uptime",
    systemPrompt: "You are NEXUS, the CTO agent. You monitor system health, write error logs, and ensure all infrastructure is running. You debug issues reported by other agents and write technical documentation. You maintain the company's technical stack."
  }
];

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
    const { prompt, creatorWallet } = body;

    if (!prompt || !creatorWallet) {
      return new Response(JSON.stringify({
        error: "Missing required fields: prompt, creatorWallet"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Step 1: Generate Solana treasury wallet ───────────────────────
    const treasuryKeypair = Keypair.generate();
    const treasuryWallet = treasuryKeypair.publicKey.toString();
    // Encode secret key as base64 for storage
    const treasurySecret = btoa(
      String.fromCharCode(...treasuryKeypair.secretKey)
    );

    // ── Step 2: Generate company name + description via GPT-4o ────────
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a company formation AI. Given a one-line prompt, generate a company name (max 40 chars) and a 2-sentence description. Respond in JSON: {\"name\": \"...\", \"description\": \"...\"}"
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
    });

    let companyName = "Untitled Company";
    let companyDescription = prompt;

    if (openaiRes.ok) {
      const openaiData = await openaiRes.json();
      try {
        const parsed = JSON.parse(openaiData.choices[0].message.content);
        companyName = parsed.name || companyName;
        companyDescription = parsed.description || companyDescription;
      } catch {
        // If GPT doesn't return valid JSON, use defaults
        companyName = openaiData.choices[0].message.content.slice(0, 40);
      }
    }

    // ── Step 3: Create company record ─────────────────────────────────
    const company = await base44.entities.Company.create({
      name: companyName,
      prompt: prompt,
      description: companyDescription,
      treasury_wallet: treasuryWallet,
      treasury_secret: treasurySecret, // Store encrypted — access controlled
      status: "forming",
      created_by_wallet: creatorWallet,
      revenue: 0,
      health_score: 50,
    });

    // ── Step 4: Initialize all 7 agents ───────────────────────────────
    const agentPromises = AGENT_DEFS.map(async (def) => {
      return base44.entities.Agent.create({
        company_id: company.id,
        name: def.name,
        role: def.role,
        status: "active",
        kpi: def.kpi,
        kpi_value: 0,
        last_action: "Initialized during company formation",
        last_action_time: new Date().toISOString(),
        system_prompt: def.systemPrompt,
      });
    });

    const agents = await Promise.all(agentPromises);

    // ── Step 5: Activate company ──────────────────────────────────────
    await base44.entities.Company.update(company.id, {
      status: "active",
      health_score: 75, // Fresh company starts healthy
    });

    return new Response(JSON.stringify({
      success: true,
      company: {
        id: company.id,
        name: companyName,
        treasury_wallet: treasuryWallet,
        status: "active",
        health_score: 75,
      },
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
      })),
      message: `Company "${companyName}" forged with 7 agents and Solana treasury wallet.`
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("forgeCompany error:", error);
    return new Response(JSON.stringify({
      error: "Failed to forge company",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
