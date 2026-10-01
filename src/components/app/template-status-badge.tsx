import { Badge } from "@/components/ui/badge";
import { TEMPLATE_STATUS_LABELS } from "@/lib/templates";

const VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  APPROVED: "success",
  PENDING: "warning",
  IN_APPEAL: "warning",
  DRAFT: "outline",
  REJECTED: "destructive",
  DISABLED: "destructive",
  PAUSED: "warning",
  FLAGGED: "warning",
};

export function TemplateStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status] ?? "secondary"}>{TEMPLATE_STATUS_LABELS[status] ?? status}</Badge>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  AUTHENTICATION: "Authentication",
};
