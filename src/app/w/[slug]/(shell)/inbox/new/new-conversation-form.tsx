"use client";

import { useState } from "react";
import { TemplateComposer, type ComposerTemplate } from "@/components/app/template-composer";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { startConversationAction } from "../actions";

export function NewConversationForm({
  slug,
  contact,
  accounts,
  templatesByAccount,
  blockedReason,
}: {
  slug: string;
  contact: { id: string; name: string; phone: string; firstName: string | null; optedOut: boolean };
  accounts: { id: string; label: string }[];
  templatesByAccount: Record<string, ComposerTemplate[]>;
  blockedReason: string | null;
}) {
  const [accountId, setAccountId] = useState(accounts[0]!.id);
  const all = templatesByAccount[accountId] ?? [];
  // Marketing templates are never offered for contacts who opted out.
  const templates = contact.optedOut ? all.filter((t) => t.category !== "MARKETING") : all;
  const defaults: Record<string, string> = contact.firstName
    ? { "1": contact.firstName, first_name: contact.firstName, name: contact.firstName }
    : {};
  return (
    <div className="grid max-w-4xl gap-4">
      <p className="text-sm">
        To <span className="font-medium">{contact.name}</span> ({contact.phone})
        {contact.optedOut && (
          <span className="text-muted-foreground"> · opted out of marketing, so only utility templates are shown</span>
        )}
      </p>
      <TemplateComposer
        key={accountId}
        templates={templates}
        defaults={defaults}
        disabledReason={blockedReason}
        extraFields={
          accounts.length > 1 ? (
            <div className="grid gap-2">
              <Label htmlFor="from">From</Label>
              <NativeSelect id="from" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null
        }
        submit={async (fd) => {
          fd.set("contactId", contact.id);
          fd.set("whatsappAccountId", accountId);
          return startConversationAction(slug, fd);
        }}
      />
    </div>
  );
}
