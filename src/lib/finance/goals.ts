import type { Goal, GoalEntry, ISODate, Paisa } from "./types";
import { daysBetween } from "./dates";

export interface GoalProgress {
  goal: Goal;
  saved: Paisa;
  contributed: Paisa;
  withdrawn: Paisa;
  remaining: Paisa;
  ratio: number;
  done: boolean;
  /** amount per month needed to reach target by target_date (null if no date or reached) */
  monthlyNeeded: Paisa | null;
  daysLeft: number | null;
  entries: GoalEntry[];
}

export function goalProgress(goal: Goal, entries: GoalEntry[], today: ISODate): GoalProgress {
  const own = entries.filter((e) => e.goal_id === goal.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  let contributed = 0,
    withdrawn = 0;
  for (const e of own) {
    if (e.amount > 0) contributed += e.amount;
    else withdrawn += -e.amount;
  }
  const saved = contributed - withdrawn;
  const remaining = Math.max(0, goal.target_amount - saved);
  const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) : null;
  let monthlyNeeded: Paisa | null = null;
  if (remaining > 0 && daysLeft !== null) {
    const months = Math.max(1, daysLeft / 30.4375);
    monthlyNeeded = Math.ceil(remaining / months);
  }
  return {
    goal,
    saved,
    contributed,
    withdrawn,
    remaining,
    ratio: goal.target_amount > 0 ? saved / goal.target_amount : 0,
    done: saved >= goal.target_amount,
    monthlyNeeded,
    daysLeft,
    entries: own,
  };
}

/**
 * Goals only earmark money you already hold in accounts — they are never added to assets.
 * This reports how much of your liquid money is earmarked and whether earmarks exceed it.
 */
export function allocationSummary(progress: GoalProgress[], liquidBalance: Paisa) {
  const allocated = progress.filter((p) => !p.goal.archived).reduce((a, p) => a + Math.max(0, p.saved), 0);
  return { allocated, unallocated: liquidBalance - allocated, overAllocated: allocated > liquidBalance };
}
