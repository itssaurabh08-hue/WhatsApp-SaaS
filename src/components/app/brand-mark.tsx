import Image from "next/image";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <Image src={brand.logoPath} alt="" width={24} height={24} priority />
      {showName && <span>{brand.productName}</span>}
    </span>
  );
}
