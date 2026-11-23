import { LiquidAdder } from '../../../components/ui/LiquidAdder.tsx';

type GoalAdderProps = {
  /** Saves the goal; true when it saved, so the bar can close. */
  onAdd: (title: string) => Promise<boolean>;
  busy: boolean;
};

/** Goals' "+" in the panel's corner, pouring out a bar to type the goal into. */
export function GoalAdder({ onAdd, busy }: GoalAdderProps) {
  return (
    <LiquidAdder
      onAdd={onAdd}
      busy={busy}
      addLabel="Add a goal"
      closeLabel="Close the new goal"
      fieldLabel="New goal"
      placeholder="Type a goal, press Enter"
    />
  );
}
