import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";

export function NoAccess() {
  return (
    <EmptyState
      icon={LockIcon}
      title="You don't have access to this page"
      description="Ask a workspace owner or admin if you need access."
    />
  );
}
