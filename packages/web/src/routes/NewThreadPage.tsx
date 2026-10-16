import { useNavigate, useSearchParams } from "react-router";
import { Composer } from "@/conversation";
import { api } from "@/lib/api";
import { conversationPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";

const HOME_PROJECT_ID = "home";

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Placeholder: owner C replaces it with the full page (project, model and thinking pickers). */
export function NewThreadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project") ?? preferences.getLastProjectId() ?? HOME_PROJECT_ID;

  const start = async ({ text, images }: { text: string; images: { mimeType: string; data: string }[] }) => {
    const created = await api.conversations.start({
      projectId,
      text,
      requestId: newRequestId(),
      ...(images.length > 0 && { images: images as never }),
    });
    preferences.setLastProjectId(created.projectId);
    navigate(conversationPath(created.projectId, created.id));
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-lg font-semibold">New thread</h2>
      <div className="w-full max-w-2xl">
        <Composer target="new" imagesAllowed busy={false} onSend={start} />
      </div>
    </div>
  );
}
