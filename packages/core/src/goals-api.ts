import type { Core } from "@tau/protocol";
import type { GoalService } from "./goals/goal-service";

/** `Core.goals` over the goal service, see MVP8.md section 7. */
export function createGoalsApi(service: Pick<GoalService, "set" | "get" | "clear">): Core["goals"] {
  return {
    set: (conversationId, condition) => service.set(conversationId, condition),
    get: (conversationId) => service.get(conversationId),
    clear: (conversationId) => service.clear(conversationId),
  };
}
