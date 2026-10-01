import { Badge } from "@/components/ui/badge";
import { OPT_IN_LABELS } from "@/lib/contacts/fields";

export function OptInBadge({ status }: { status: keyof typeof OPT_IN_LABELS }) {
  const variant = status === "OPTED_IN" ? "success" : status === "OPTED_OUT" ? "destructive" : "secondary";
  return <Badge variant={variant}>{OPT_IN_LABELS[status]}</Badge>;
}
