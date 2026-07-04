/**
 * AETHERION OS — executeGoal
 * GOD MODE trigger. Takes a high-level goal (e.g. "Launch TikTok Campaign"),
 * triggers the CEO (AETHOS) agent to break it into 5 tasks, assigns them
 * to the appropriate agents, and optionally auto-executes the first task.
 *
 * POST body: {
 *   companyId: string,
 *   goal: string,
 *   autoExecute?: boolean  // If true, auto-runs the first assigned task
 * }
 *
 * Flow:
 * 1. Call runAgent with role=CEO and the goal
 * 2. CEO breaks goal into 5 tasks → saved to Task table
 * 3. If autoExecute, pick the highest priority task and run its assigned agent
 * 4. Return the created tasks + any execution results
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

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
    const { companyId, goal, autoExecute = false } = body;

    if (!companyId || !goal) {
      return new Response(JSON.stringify({
        error: "Missing required fields: companyId, goal"
      }), {
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

    if (company.status !== "active") {
      return new Response(JSON.stringify({
        error: `Company is ${company.status}. Only active companies can execute goals.`
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Step 1: Trigger CEO AETHOS to break goal into tasks ───────────
    // Call GPT-4o directly with CEO system prompt
    const ceoAgents = await base44.entities.Agent.list({
      filter: { company_id: companyId, role: "CEO" },
    });

    if (!ceoAgents || ceoAgents.length === 0) {
      return new Response(JSON.stringify({
        error: "CEO agent not found for this company"
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ceoAgent = ceoAgents[0];

    // Update CEO status
    await base44.entities.Agent.update(ceoAgent.id, {
      status: "active",
      last_action: `GOD MODE: Breaking down goal — "${goal.slice(0, 60)}"`,
      last_action_time: new Date().toISOString(),
    });

    // Call GPT-4o with CEO prompt
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
            content: ceoAgent.system_prompt + "\n\nYou are the CEO. Break this goal into exactly 5 tasks. For each task, specify: title, description, assignedAgent (one of: CPO, CMO, CFO, COO, CLO, CTO), priority (low/medium/high/critical), and dueDate (ISO format, within next 14 days). Respond as JSON: {\"tasks\": [{\"title\": \"\", \"description\": \"\", \"assignedAgent\": \"\", \"priority\": \"\", \"dueDate\": \"\"}]}."
          },
          { role: "user", content: `Company: ${company.name}\nDescription: ${company.description}\nGoal: ${goal}` },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      await base44.entities.Agent.update(ceoAgent.id, {
        status: "error",
        last_action: `GPT-4o call failed: ${errText.slice(0, 100)}`,
        last_action_time: new Date().toISOString(),
      });
      return new Response(JSON.stringify({
        error: "CEO agent failed to process goal",
        details: errText,
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiRes.json();
    const ceoResponse = openaiData.choices[0].message.content;

    // ── Step 2: Parse CEO response and create tasks ───────────────────
    let tasks: any[] = [];
    try {
      const parsed = JSON.parse(ceoResponse);
      tasks = parsed.tasks || [];
    } catch {
      // If CEO didn't return valid JSON, create a single fallback task
      tasks = [{
        title: `Execute: ${goal}`,
        description: ceoResponse,
        assignedAgent: "COO",
        priority: "high",
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }];
    }

    const createdTasks: any[] = [];
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

    for (const task of tasks) {
      // Find the target agent
      const targetAgents = await base44.entities.Agent.list({
        filter: { company_id: companyId, role: task.assignedAgent },
      });
      const targetAgentId = targetAgents?.[0]?.id || ceoAgent.id;

      const created = await base44.entities.Task.create({
        company_id: companyId,
        agent_id: targetAgentId,
        title: task.title,
        description: task.description,
        status: "todo",
        due_date: task.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        priority: task.priority || "medium",
        assigned_by: "CEO_GOD_MODE",
      });

      createdTasks.push({
        id: created.id,
        title: created.title,
        assignedAgent: task.assignedAgent,
        priority: task.priority,
        status: "todo",
      });
    }

    // Update CEO with success
    await base44.entities.Agent.update(ceoAgent.id, {
      status: "active",
      last_action: `GOD MODE: Created ${createdTasks.length} tasks for "${goal.slice(0, 40)}"`,
      last_action_time: new Date().toISOString(),
      kpi_value: (ceoAgent.kpi_value || 0) + 1,
    });

    // ── Step 3: Auto-execute highest priority task if requested ───────
    let executionResult = null;
    if (autoExecute && createdTasks.length > 0) {
      // Sort by priority and pick the first
      const sorted = [...createdTasks].sort(
        (a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)
      );
      const firstTask = sorted[0];

      // Find the agent for this task
      const targetAgents = await base44.entities.Agent.list({
        filter: { company_id: companyId, role: firstTask.assignedAgent },
      });

      if (targetAgents && targetAgents.length > 0) {
        const targetAgent = targetAgents[0];

        // Mark task as doing
        await base44.entities.Task.update(firstTask.id, {
          status: "doing",
        });

        // Call the assigned agent with GPT-4o
        const agentRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: targetAgent.system_prompt },
              { role: "user", content: `${firstTask.title}: ${firstTask.description || ""}` },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        });

        if (agentRes.ok) {
          const agentData = await agentRes.json();
          const agentResponse = agentData.choices[0].message.content;

          // Mark task as done
          await base44.entities.Task.update(firstTask.id, {
            status: "done",
            result: agentResponse,
          });

          // Update agent
          await base44.entities.Agent.update(targetAgent.id, {
            status: "active",
            last_action: `GOD MODE auto-executed: ${firstTask.title.slice(0, 60)}`,
            last_action_time: new Date().toISOString(),
            kpi_value: (targetAgent.kpi_value || 0) + 1,
          });

          executionResult = {
            taskId: firstTask.id,
            agent: firstTask.assignedAgent,
            status: "done",
            response: agentResponse,
          };
        } else {
          await base44.entities.Task.update(firstTask.id, {
            status: "todo", // Revert to todo if execution failed
          });
          executionResult = {
            taskId: firstTask.id,
            agent: firstTask.assignedAgent,
            status: "failed",
            error: "GPT-4o call failed for assigned agent",
          };
        }
      }
    }

    // ── Update company health score ───────────────────────────────────
    const healthBoost = Math.min(10, createdTasks.length * 2);
    await base44.entities.Company.update(companyId, {
      health_score: Math.min(100, (company.health_score || 50) + healthBoost),
    });

    return new Response(JSON.stringify({
      success: true,
      companyId,
      goal,
      tasks_created: createdTasks.length,
      tasks: createdTasks,
      auto_executed: executionResult,
      ceo_response: ceoResponse,
      message: `GOD MODE activated. CEO AETHOS created ${createdTasks.length} tasks${executionResult ? ` and auto-executed 1 task via ${executionResult.agent}` : ""}.`,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("executeGoal error:", error);
    return new Response(JSON.stringify({
      error: "GOD MODE execution failed",
      details: error.message || String(error),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
