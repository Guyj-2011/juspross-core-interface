import { Plus } from "lucide-react";
import { useJuspross } from "@/lib/juspross/store";
import { cn } from "@/lib/utils";

export function HistoryPanel() {
  const conversations = useJuspross((s) => s.conversations);
  const active = useJuspross((s) => s.activeConversationId);
  const select = useJuspross((s) => s.selectConversation);
  const create = useJuspross((s) => s.newConversation);

  return (
    <div className="space-y-2">
      <button
        onClick={create}
        className="flex w-full items-center gap-2 rounded-sm border border-cyan/35 px-2 py-1.5 font-mono text-[10px] tracking-[0.22em] text-cyan transition-colors hover:bg-cyan/10"
      >
        <Plus className="size-3" /> NUEVA SESIÓN
      </button>
      <ul className="space-y-1">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => select(c.id)}
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-left transition-colors",
                c.id === active ? "bg-primary/12 text-cyan" : "text-foreground/80 hover:bg-primary/8",
              )}
            >
              <p className="truncate text-[12px]">{c.title}</p>
              <p className="label-xs">
                {new Date(c.updatedAt).toLocaleString("es-MX", { hour12: false })} ·{" "}
                {c.messages.length} MSG
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}