export type TargetTitleGroup = {
  family:
    | "installation-build"
    | "site-venue-operations"
    | "production-delivery"
    | "operations-programme-delivery"
    | "client-service-delivery"
    | "portable-operations";
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
  },
  {
    family: "operations-programme-delivery",
    titles: [
      "Operations Manager",
      "Operations Coordinator",
      "Operations Specialist",
      "Programme Manager",
      "Program Manager",
      "Project Manager",
      "Project Coordinator",
      "Implementation Manager",
      "Implementation Specialist",
      "Service Delivery Manager",
      "Vendor Manager",
      "Supplier Manager",
      "Logistics Manager"
    ]
  },
  {
    family: "client-service-delivery",
    titles: [
      "Client Delivery Manager",
      "Client Operations Manager",
      "Account Manager",
      "Client Services Manager",
      "Client Service Manager"
    ]
  },
  {
    family: "portable-operations",
    titles: [
      "Project Operations Specialist",
      "PMO Coordinator",
      "PMO Analyst",
      "Project Support Officer",
      "Operations Reporting Coordinator",
      "Knowledge Operations Coordinator",
      "Knowledge Management Specialist",
      "Documentation Coordinator",
      "Process Documentation Specialist",
      "AI Operations Coordinator",
      "Workflow Automation Specialist",
      "Business Process Analyst",
      "Operations Enablement Specialist"
    ]
  }
] as const;

export const lane1ExactJobTitles = lane1TargetTitleGroups.flatMap((group) => group.titles);
