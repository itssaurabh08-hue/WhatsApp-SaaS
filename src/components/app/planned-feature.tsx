import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

/**
 * Placeholder for a section whose feature is scheduled for a later phase.
 * Shows the real empty-state copy and says plainly that it is not built yet,
 * rather than rendering fake data.
 */
export function PlannedFeature({
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title={emptyTitle}
        description={
          <>
            {emptyDescription}
            <span className="mt-2 block text-xs">This section is not available in this build yet.</span>
          </>
        }
      />
    </>
  );
}
