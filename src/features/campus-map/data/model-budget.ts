export type RenderProfile = "conservative" | "standard";

// API eligibility is determined by a draw test. These are resource budgets only.
export function modelBudget(profile: RenderProfile) {
  return profile === "conservative"
    ? { concurrentLoads: 2, pixelRatio: 1.5 }
    : { concurrentLoads: 3, pixelRatio: 2 };
}
