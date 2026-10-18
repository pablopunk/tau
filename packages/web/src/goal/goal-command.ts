import type { QueryClient } from "@tanstack/react-query";
import { GOAL_CONDITION_MAX_LENGTH } from "@tau/protocol";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { conditionTooLong, goalStatusText, parseGoalArgs } from "./goal-status";

const refreshGoal = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: ["goal"] });

async function showStatus(conversationId: string) {
  const goal = await api.goals.get(conversationId);
  if (!goal) return void toast.info("No goal set. Use /goal followed by a condition.");
  toast.info("Goal", { description: goalStatusText(goal, Date.now()) });
}

/** The `/goal` slash command. No model reads it: it calls the goal routes. */
export async function runGoalCommand(conversationId: string, args: string, queryClient: QueryClient) {
  const parsed = parseGoalArgs(args);
  try {
    if (parsed.kind === "status") return await showStatus(conversationId);
    if (parsed.kind === "clear") await api.goals.clear(conversationId);
    else if (conditionTooLong(parsed.condition)) {
      return void toast.error(
        `A goal condition has at most ${GOAL_CONDITION_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      );
    } else await api.goals.set(conversationId, parsed.condition);
    await refreshGoal(queryClient);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
