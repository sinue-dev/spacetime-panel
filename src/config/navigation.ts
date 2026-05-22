import { z } from "zod";

const NavigationConfigSchema = z.object({
  patternDepth: z.coerce.number().min(0).max(5).default(1),
  minGroupSize: z.coerce.number().min(2).default(2),
  enablePatternGrouping: z.coerce.boolean().default(true),
  patternSeparator: z.string().default("_"),
  maxGroups: z.coerce.number().min(1).max(50).default(10),
  showUngroupedInBase: z.coerce.boolean().default(true),
  collapseSingleGroups: z.coerce.boolean().default(false),
  groupSortBy: z
    .enum(["alphabetical", "size", "depth"])
    .default("alphabetical"),
  showGroupCounts: z.coerce.boolean().default(true),
  usePatternIcons: z.coerce.boolean().default(true),
});

export type NavigationConfig = z.infer<typeof NavigationConfigSchema>;

export const navigationConfig = NavigationConfigSchema.parse({
  patternDepth: import.meta.env.VITE_NAV_PATTERN_DEPTH,
  minGroupSize: import.meta.env.VITE_NAV_MIN_GROUP_SIZE,
  enablePatternGrouping: import.meta.env.VITE_NAV_ENABLE_PATTERN_GROUPING,
  patternSeparator: import.meta.env.VITE_NAV_PATTERN_SEPARATOR,
  maxGroups: import.meta.env.VITE_NAV_MAX_GROUPS,
  showUngroupedInBase: import.meta.env.VITE_NAV_SHOW_UNGROUPED_IN_BASE,
  collapseSingleGroups: import.meta.env.VITE_NAV_COLLAPSE_SINGLE_GROUPS,
  groupSortBy: import.meta.env.VITE_NAV_GROUP_SORT_BY,
  showGroupCounts: import.meta.env.VITE_NAV_SHOW_GROUP_COUNTS,
  usePatternIcons: import.meta.env.VITE_NAV_USE_PATTERN_ICONS,
});
