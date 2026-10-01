/** Shape returned by form server actions consumed via useActionState. */
export interface ActionState<TFields extends string = string> {
  ok?: boolean;
  message?: string;
  fieldErrors?: Partial<Record<TFields, string>>;
  /** Echo of submitted (non-secret) values so forms keep input after an error. */
  values?: Partial<Record<TFields, string>>;
}

export const initialActionState: ActionState = {};
