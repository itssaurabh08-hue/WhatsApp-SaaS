import Link from "next/link";
import { BrandMark } from "@/components/app/brand-mark";
import { brand } from "@/config/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="px-6 py-5">
        <Link href="/" aria-label={`${brand.productName} home`}>
          <BrandMark />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="text-muted-foreground px-6 py-4 text-center text-xs">
        Need help?{" "}
        <a className="underline" href={`mailto:${brand.supportEmail}`}>
          {brand.supportEmail}
        </a>
      </footer>
    </div>
  );
}
