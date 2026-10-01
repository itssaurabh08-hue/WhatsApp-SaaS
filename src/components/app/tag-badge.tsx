import { cn } from "@/lib/utils";

const COLOR_CLASSES: Record<string, string> = {
  gray: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  pink: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
};

export function TagBadge({
  name,
  color,
  children,
  className,
}: {
  name: string;
  color: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        COLOR_CLASSES[color] ?? COLOR_CLASSES.gray,
        className,
      )}
    >
      {name}
      {children}
    </span>
  );
}
