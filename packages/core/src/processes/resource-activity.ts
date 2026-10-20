import type { ResourceActivity } from "@tau/protocol";
import type { ProcessService } from "./process-service";

interface TitleLookup {
  find(id: string): Promise<{ title: string } | undefined>;
}

/** No queue: the activity list stays empty. Kept so the API shape stays stable. */
export async function resourceActivityOf(
  _processes: Pick<ProcessService, "resourceActivity">,
  _conversations: TitleLookup,
): Promise<ResourceActivity> {
  return { holders: [], waiting: [] };
}
