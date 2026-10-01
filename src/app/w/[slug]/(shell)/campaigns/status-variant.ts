export const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  SENDING: "warning",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "destructive",
};
