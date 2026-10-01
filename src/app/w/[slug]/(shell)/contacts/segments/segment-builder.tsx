"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { FormField } from "@/components/app/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONDITION_FIELD_LABELS,
  DATE_OPS,
  OP_LABELS,
  TEXT_OPS,
  type SegmentCondition,
  type SegmentDefinition,
} from "@/lib/segments";
import { previewSegmentAction, saveSegmentAction } from "../actions";

interface Option {
  id: string;
  name: string;
}

type Field = SegmentCondition["field"];
type Draft = { field: Field; op: string; value: string; key?: string };

const OPS: Record<Field, readonly string[]> = {
  tag: ["has", "not_has"],
  list: ["in", "not_in"],
  optInStatus: ["is", "is_not"],
  firstName: TEXT_OPS,
  lastName: TEXT_OPS,
  email: TEXT_OPS,
  company: TEXT_OPS,
  country: TEXT_OPS,
  phoneNumber: ["equals", "contains"],
  custom: TEXT_OPS,
  createdAt: DATE_OPS,
  lastMessageAt: [...DATE_OPS, "never"],
};

function defaultDraft(field: Field, tags: Option[], lists: Option[], customKeys: string[]): Draft {
  const op = OPS[field][0]!;
  if (field === "tag") return { field, op, value: tags[0]?.id ?? "" };
  if (field === "list") return { field, op, value: lists[0]?.id ?? "" };
  if (field === "optInStatus") return { field, op, value: "OPTED_IN" };
  if (field === "custom") return { field, op, value: "", key: customKeys[0] ?? "" };
  if (field === "createdAt" || field === "lastMessageAt") return { field, op: "in_last_days", value: "30" };
  return { field, op, value: "" };
}

export function SegmentBuilder({
  slug,
  segmentId,
  initial,
  tags,
  lists,
  customFields,
}: {
  slug: string;
  segmentId: string | null;
  initial?: { name: string; description: string | null; definition: SegmentDefinition };
  tags: Option[];
  lists: Option[];
  customFields: { key: string; label: string }[];
}) {
  const customKeys = customFields.map((f) => f.key);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [match, setMatch] = useState<"all" | "any">(initial?.definition.match ?? "all");
  const [conditions, setConditions] = useState<Draft[]>(
    initial?.definition.conditions.map((c) => ({ ...c, value: "value" in c ? (c.value ?? "") : "" }) as Draft) ?? [
      defaultDraft(tags.length > 0 ? "tag" : "optInStatus", tags, lists, customKeys),
    ],
  );
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const definition = () => ({ version: 1, match, conditions });
  const update = (i: number, patch: Partial<Draft>) => {
    setCount(null);
    setConditions((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const availableFields = (Object.keys(CONDITION_FIELD_LABELS) as Field[]).filter(
    (f) =>
      (f !== "tag" || tags.length > 0) &&
      (f !== "list" || lists.length > 0) &&
      (f !== "custom" || customKeys.length > 0),
  );

  return (
    <div className="grid gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="segment-name" label="Name">
          <Input
            id="segment-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customers in Delhi"
          />
        </FormField>
        <FormField id="segment-description" label="Description (optional)">
          <Textarea
            id="segment-description"
            className="min-h-9"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          Contacts that match
          <NativeSelect
            aria-label="Match"
            className="h-8 w-auto"
            value={match}
            onChange={(e) => (setCount(null), setMatch(e.target.value as "all" | "any"))}
          >
            <option value="all">all of these conditions (AND)</option>
            <option value="any">any of these conditions (OR)</option>
          </NativeSelect>
        </legend>
        {conditions.map((c, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-center"
            data-testid="segment-condition"
          >
            <NativeSelect
              aria-label={`Condition ${i + 1} field`}
              value={c.field}
              onChange={(e) => {
                setCount(null);
                setConditions((prev) =>
                  prev.map((d, j) => (j === i ? defaultDraft(e.target.value as Field, tags, lists, customKeys) : d)),
                );
              }}
            >
              {availableFields.map((f) => (
                <option key={f} value={f}>
                  {CONDITION_FIELD_LABELS[f]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={`Condition ${i + 1} operator`}
              value={c.op}
              onChange={(e) => update(i, { op: e.target.value })}
            >
              {OPS[c.field].map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </NativeSelect>
            <ConditionValue
              draft={c}
              index={i}
              tags={tags}
              lists={lists}
              customFields={customFields}
              onChange={(patch) => update(i, patch)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove condition ${i + 1}`}
              disabled={conditions.length === 1}
              onClick={() => (setCount(null), setConditions((prev) => prev.filter((_, j) => j !== i)))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={conditions.length >= 20}
            onClick={() => setConditions((prev) => [...prev, defaultDraft("optInStatus", tags, lists, customKeys)])}
          >
            <PlusIcon />
            Add condition
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await previewSegmentAction(slug, definition());
              if (res.ok) setCount(res.count);
              else setError(res.message);
            })
          }
        >
          Count matching contacts
        </Button>
        {count !== null && (
          <span className="text-sm" role="status">
            <span className="font-medium tabular-nums">{count.toLocaleString("en-US")}</span> contact
            {count === 1 ? "" : "s"} match right now.
          </span>
        )}
        <Button
          className="ml-auto"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await saveSegmentAction(slug, segmentId, { name, description, definition: definition() });
              if (res && !res.ok) setError(res.message);
            })
          }
        >
          {segmentId ? "Save segment" : "Create segment"}
        </Button>
      </div>
    </div>
  );
}

function ConditionValue({
  draft,
  index,
  tags,
  lists,
  customFields,
  onChange,
}: {
  draft: Draft;
  index: number;
  tags: Option[];
  lists: Option[];
  customFields: { key: string; label: string }[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const label = `Condition ${index + 1} value`;
  if (draft.op === "is_empty" || draft.op === "is_not_empty" || draft.op === "never") return <span />;
  switch (draft.field) {
    case "tag":
    case "list": {
      const options = draft.field === "tag" ? tags : lists;
      return (
        <NativeSelect aria-label={label} value={draft.value} onChange={(e) => onChange({ value: e.target.value })}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      );
    }
    case "optInStatus":
      return (
        <NativeSelect aria-label={label} value={draft.value} onChange={(e) => onChange({ value: e.target.value })}>
          <option value="OPTED_IN">Opted in</option>
          <option value="OPTED_OUT">Opted out</option>
          <option value="UNKNOWN">Unknown</option>
        </NativeSelect>
      );
    case "custom":
      return (
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect
            aria-label={`Condition ${index + 1} custom field`}
            value={draft.key}
            onChange={(e) => onChange({ key: e.target.value })}
          >
            {customFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label={label} value={draft.value} onChange={(e) => onChange({ value: e.target.value })} />
        </div>
      );
    case "createdAt":
    case "lastMessageAt":
      return draft.op === "in_last_days" ? (
        <Input
          aria-label={label}
          type="number"
          min={1}
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      ) : (
        <Input
          aria-label={label}
          type="date"
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
    default:
      return <Input aria-label={label} value={draft.value} onChange={(e) => onChange({ value: e.target.value })} />;
  }
}
