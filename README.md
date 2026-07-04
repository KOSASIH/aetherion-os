# AETHERION OS

> **The Autonomous Company Operating System**
> One Prompt = One Company. Build, manage, and monitor 7 AI Agents that run a real business on Solana.

## Architecture

```
aetherion-os/
├── database/
│   └── schema/
│       ├── Company.json        # Company entity
│       ├── Agent.json          # 7 AI agents per company
│       ├── Task.json           # Kanban tasks
│       ├── Transaction.json    # On-chain Solana transactions
│       └── Shareholder.json    # Shareholders with yield tracking
├── functions/
│   ├── forgeCompany.ts         # Create company + 7 agents + Solana wallet
│   ├── runAgent.ts             # Core GPT-4o agent execution engine
│   ├── createTreasury.ts       # Solana wallet generation per company
│   ├── getTreasuryBalance.ts   # Treasury balance via Helius RPC
│   ├── distributeYield.ts      # On-chain SOL yield distribution
│   └── executeGoal.ts          # GOD MODE - CEO goal execution trigger
└── README.md
```

## The 7 Agents

| Agent | Role  | Name   | Responsibility |
|-------|-------|--------|----------------|
| CEO   | AETHOS | Strategic decisions, breaks goals into tasks |
| CPO   | FORGE  | Product development, code generation |
| CMO   | VIRAL  | Marketing, social media, growth |
| CFO   | VAULT  | Treasury management, Solana payments |
| COO   | OPERA  | Operations, scheduling, deadlines |
| CLO   | LEX    | Legal documents, compliance |
| CTO   | NEXUS  | Technical monitoring, error logging |

## Backend Functions (All Deployed)

| Function | Endpoint | Description |
|----------|----------|-------------|
| forgeCompany | POST /functions/forgeCompany | Create company + 7 agents + Solana wallet |
| runAgent | POST /functions/runAgent | Execute any agent with GPT-4o |
| createTreasury | POST /functions/createTreasury | Generate Solana treasury wallet |
| getTreasuryBalance | POST /functions/getTreasuryBalance | Check on-chain SOL balance |
| distributeYield | POST /functions/distributeYield | Distribute SOL to shareholders on-chain |
| executeGoal | POST /functions/executeGoal | GOD MODE - CEO breaks goal into 5 tasks |

## Tech Stack

- **Framework**: Next.js 14 + TypeScript + TailwindCSS + Shadcn/ui
- **Database**: Base44 built-in (5 entities)
- **Auth**: Solana Wallet Adapter (Phantom/Solflare)
- **Blockchain**: Solana Mainnet (@solana/web3.js)
- **AI**: OpenAI GPT-4o
- **Voice**: Eleven Labs
- **Automation**: N8N webhooks

## Status

- [x] Database schema (5 entities)
- [x] forgeCompany backend function
- [x] runAgent backend function
- [x] createTreasury (Solana wallet generation)
- [x] getTreasuryBalance (Helius RPC)
- [x] distributeYield (on-chain yield distribution)
- [x] executeGoal (GOD MODE trigger)
- [x] GitHub repo initialized + all code pushed
- [ ] Dashboard UI
- [ ] Company detail page (Council, Vault, Missions, God Mode tabs)
- [ ] Wallet Connect auth (Solana Wallet Adapter)
- [ ] API keys setup (OpenAI, Helius, N8N, ElevenLabs)

## Required Environment Variables

- `OPENAI_API_KEY` - GPT-4o for agent intelligence
- `HELIUS_API_KEY` - Solana RPC provider (premium)
- `N8N_WEBHOOK_URL` - Automation webhook for CMO agent
- `ELEVENLABS_API_KEY` - Voice synthesis

---
Built on [Base44](https://base44.com) · Powered by Solana + GPT-4o
