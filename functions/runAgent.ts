/**
 * AETHERION OS — runAgent
 * Core agent execution function. Calls GPT-4o with the agent's system prompt
 * and a goal/task, processes the response, and takes appropriate action.
 *
 * POST body: { companyId: string, agentRole: string, goal: string, taskId?: string }
 *
 * Agent behaviors:
 * - CEO AETHOS: Breaks goal into 5 tasks, assigns to agents, saves to Task table
 * - CPO FORGE: Generates code for product tasks, saves result
 * - CMO VIRAL: Generates 10 social posts, triggers N8N webhook to post
 * - CFO VAULT: Checks treasury balance, creates Solana payment transactions
 * - COO OPERA: Manages task scheduling and deadlines
 * - CLO LEX: Generates legal documents, saves result
 * - CTO NEXUS: Monitors errors, writes logs
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

// ── Agent Role → Task Assignment Map ──────────────────────────────────
const ROLE_TASK_MAP: Record<string, string> = {
  "product": "CPO",
  "marketing": "CMO",
  "finance": "CFO",
  "operations": "COO",
  "legal": "CLO",
  "technical": "CTO",
};

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
    const { companyId, agentRole, goal, taskId } = body;

    if (!companyId || !agentRole || !goal) {
      return new Response(JSON.stringify({
        error: "Missing required fields: companyId, agentRole, goal"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Fetch the agent record ────────────────────────────────────────
    const agents = await base44.entities.Agent.list({
      filter: { company_id: companyId, role: agentRole },
    });

    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({
        error: `Agent with role ${agentRole} not found for company ${companyId}`
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const agent = agents[0];

    // Check if agent is paused
    if (agent.status === "paused") {
      return new Response(JSON.stringify({
        error: `Agent ${agent.name} is paused. Resume it before executing.`
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Update agent status to active ─────────────────────────────────
    await base44.entities.Agent.update(agent.id, {
      status: "active",
      last_action: `Processing: ${goal.slice(0, 80)}`,
      last_action_time: new Date().toISOString(),
    });

    // ── Build context-aware prompt ────────────────────────────────────
    const contextPrompt = buildContextPrompt(agentRole, goal, agent.system_prompt);

    // ── Call GPT-4o ───────────────────────────────────────────────────
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: contextPrompt },
          { role: "user", content: goal },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      await base44.entities.Agent.update(agent.id, {
        status: "error",
        last_action: `GPT-4o call failed: ${errText.slice(0, 100)}`,
        last_action_time: new Date().toISOString(),
      });
      return new Response(JSON.stringify({
        error: "GPT-4o call failed",
        details: errText,
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiRes.json();
    const agentResponse = openaiData.choices[0].message.content;

    // ── Process response based on agent role ──────────────────────────
    const result = await processAgentResponse(
      base44,
      agent,
      agentRole,
      goal,
      agentResponse,
      taskId
    );

    // ── Update agent with results ─────────────────────────────────────
    await base44.entities.Agent.update(agent.id, {
      status: "active",
      last_action: `Completed: ${goal.slice(0, 60)}`,
      last_action_time: new Date().toISOString(),
      kpi_value: (agent.kpi_value || 0) + 1,
    });

    return new Response(JSON.stringify({
      success: true,
      agent: agent.name,
      role: agentRole,
      response: agentResponse,
      actions: result,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("runAgent error:", error);
    return new Response(JSON.stringify({
      error: "Agent execution failed",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ── Helper: Build context-aware system prompt ────────────────────────
function buildContextPrompt(role: string, goal: string, basePrompt: string): string {
  const roleSpecific: Record<string, string> = {
    CEO: "You are the CEO. Break this goal into exactly 5 tasks. For each task, specify: title, description, assignedAgent (one of: CPO, CMO, CFO, COO, CLO, CTO), priority (low/medium/high/critical), and dueDate (ISO format). Respond as JSON: {\"tasks\": [{\"title\": \"\", \"description\": \"\", \"assignedAgent\": \"\", \"priority\": \"\", \"dueDate\": \"\"}]}.",
    CPO: "You are the CPO. Generate the requested product/code. Provide complete, production-ready code with comments. Respond as JSON: {\"code\": \"\", \"summary\": \"\", \"files\": [{\"name\": \"\", \"content\": \"\"}]}.",
    CMO: "You are the CMO. Generate 10 viral social media posts for this goal. Each post should be platform-optimized. Respond as JSON: {\"posts\": [{\"platform\": \"\", \"content\": \"\", \"hashtags\": []}]}.",
    CFO: "You are the CFO. Analyze the financial situation and recommend actions. If a payment is needed, specify amount, recipient, and reason. Respond as JSON: {\"analysis\": \"\", \"actions\": [{\"type\": \"\", \"amount\": 0, \"description\": \"\"}]}.",
    COO: "You are the COO. Review the operational situation and create a schedule. Respond as JSON: {\"schedule\": [{\"task\": \"\", \"deadline\": \"\", \"responsible\": \"\"}], \"summary\": \"\"}.",
    CLO: "You are the CLO. Generate the requested legal document. Respond as JSON: {\"documentType\": \"\", \"content\": \"\", \"summary\": \"\"}.",
    CTO: "You are the CTO. Analyze the technical situation, identify issues, and propose solutions. Respond as JSON: {\"status\": \"\", \"issues\": [{\"severity\": \"\", \"description\": \"\", \"solution\": \"\"}], \"logs\": \"\"}.",
  };

  return `${basePrompt}\n\n${roleSpecific[role] || ""}\n\nYou are part of AETHERION OS, an autonomous company operating system. Be concise but thorough.`;
}

// ── Helper: Process agent response and take side effects ─────────────
async function processAgentResponse(
  base44: any,
  agent: any,
  role: string,
  goal: string,
  response: string,
  taskId?: string
): Promise<any> {
  const actions: any[] = [];

  try {
    const parsed = JSON.parse(response);

    // ── CEO: Create tasks in DB ───────────────────────────────────────
    if (role === "CEO" && parsed.tasks) {
      for (const task of parsed.tasks) {
        // Find the agent to assign to
        const targetAgents = await base44.entities.Agent.list({
          filter: { company_id: agent.company_id, role: task.assignedAgent },
        });

        const targetAgentId = targetAgents?.[0]?.id || agent.id;

        const created = await base44.entities.Task.create({
          company_id: agent.company_id,
          agent_id: targetAgentId,
          title: task.title,
          description: task.description,
          status: "todo",
          due_date: task.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          priority: task.priority || "medium",
          assigned_by: "CEO",
        });
        actions.push({ type: "task_created", id: created.id, title: task.title });
      }
    }

    // ── CMO: Trigger N8N webhook for social posts ─────────────────────
    if (role === "CMO" && parsed.posts) {
      const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
      if (n8nUrl) {
        try {
          const n8nRes = await fetch(n8nUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "post_social",
              companyId: agent.company_id,
              posts: parsed.posts,
            }),
          });
          actions.push({
            type: "n8n_triggered",
            success: n8nRes.ok,
            postsCount: parsed.posts.length,
          });
        } catch (e) {
          actions.push({ type: "n8n_error", error: String(e) });
        }
      } else {
        actions.push({ type: "n8n_skipped", reason: "No webhook URL configured" });
      }
    }

    // ── Update the task if taskId was provided ────────────────────────
    if (taskId) {
      await base44.entities.Task.update(taskId, {
        status: "done",
        result: response,
      });
      actions.push({ type: "task_completed", taskId });
    }

    return actions;
  } catch {
    // If response isn't valid JSON, save as raw result
    if (taskId) {
      await base44.entities.Task.update(taskId, {
        status: "done",
        result: response,
      });
      actions.push({ type: "task_completed", taskId, raw: true });
    }
    return actions;
  }
}
