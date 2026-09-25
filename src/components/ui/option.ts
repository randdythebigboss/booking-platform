/** One choice, shared by every control that offers a list of them. */
export interface SelectOption<T extends string> {
  value: T;
  label: string;
}
