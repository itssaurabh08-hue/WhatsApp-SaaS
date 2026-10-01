"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { syncTemplatesAction } from "./actions";

export function SyncTemplatesButton({ slug, accounts }: { slug: string; accounts: { id: string; label: string }[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [pending, start] = useTransition();
  if (accounts.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {accounts.length > 1 && (
        <NativeSelect
          aria-label="WhatsApp number"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-48"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </NativeSelect>
      )}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("whatsappAccountId", accountId);
            const r = await syncTemplatesAction(slug, fd);
            if (r.ok) toast.success(r.message);
            else toast.error(r.message ?? "Sync failed.");
          })
        }
      >
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
        Sync from WhatsApp
      </Button>
    </div>
  );
}
