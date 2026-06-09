export type TargetTitleGroup = {
  family: "installation-build" | "site-venue-operations" | "production-delivery";
  titles: readonly string[];
};

export const lane1TargetTitleGroups: readonly TargetTitleGroup[] = [
  {
    family: "installation-build",
    titles: [
      "Installation Manager",
      "Senior Installation Manager",
      "Event Installation Manager",
      "Exhibition Installation Manager",
      "Build Manager",
      "Event Build Manager",
      "Build and Breakdown Manager",
      "Temporary Structures Manager"
    ]
  },
  {
    family: "site-venue-operations",
    titles: [
      "Site Manager",
      "Event Site Manager",
      "Site Operations Manager",
      "Venue Operations Manager",
      "Event Operations Manager",
      "Venue Delivery Manager",
      "Event Delivery Manager",
      "Overlay Manager"
    ]
  },
  {
    family: "production-delivery",
    titles: [
      "Production Manager",
      "Event Production Manager",
      "Live Event Production Manager",
      "Exhibition Production Manager"
    ]
  }
] as const;

export const lane1ExactJobTitles = lane1TargetTitleGroups.flatMap((group) => group.titles);
