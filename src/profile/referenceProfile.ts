import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  CandidateProfile,
  DocumentReference,
  RecurringAnswer,
  SourceReference
} from "../shared/contracts.js";

const DEFAULT_REFERENCE_PROFILE_PATH = resolve(process.cwd(), "APPLICATION_REFERENCE.md");

type ParsedBulletSection = {
  simpleItems: string[];
  keyValues: Map<string, string>;
  keyedLists: Map<string, string[]>;
};

export type CandidateProfileLoadOptions = {
  referencePath?: string;
  profileId?: string;
};

type CandidateProfileParseOptions = {
  referencePath: string;
  profileId?: string;
};

export function resolveDefaultCandidateProfilePath(referencePath?: string): string {
  return referencePath ? resolve(referencePath) : DEFAULT_REFERENCE_PROFILE_PATH;
}

export async function loadCandidateProfile(
  options: CandidateProfileLoadOptions = {}
): Promise<CandidateProfile> {
  const referencePath = resolveDefaultCandidateProfilePath(options.referencePath);
  const markdown = await readFile(referencePath, "utf8");

  return parseCandidateProfileReference(markdown, {
    referencePath,
    profileId: options.profileId
  });
}

export function parseCandidateProfileReference(
  markdown: string,
  options: CandidateProfileParseOptions
): CandidateProfile {
  const sections = splitSections(markdown);
  const identitySection = parseBulletSection(sections.get("Identity and contact") ?? []);
  const headlineSection = parseBulletSection(sections.get("Professional headline") ?? []);
  const screeningSection = parseBulletSection(sections.get("Common screening answers") ?? []);
  const documentsSection = parseBulletSection(sections.get("Documents and file references") ?? []);
  const certificationsSection = parseBulletSection(sections.get("Certifications") ?? []);
  const proofPointsSection = parseBulletSection(sections.get("Core proof points") ?? []);

  const fullName = firstPresent(
    identitySection.keyValues.get("Full legal name"),
    identitySection.keyValues.get("Preferred display name")
  );
  const headline = firstPresent(headlineSection.keyValues.get("Default headline"));
  const targetRoleFamilies = filterKnownValues(
    headlineSection.keyedLists.get("Target role families") ?? []
  );
  const certifications = filterKnownValues(certificationsSection.simpleItems);
  const coreProofPoints = filterKnownValues(proofPointsSection.simpleItems);

  if (!fullName) {
    throw new Error("Candidate profile reference is missing a full legal name or preferred display name.");
  }

  if (!headline) {
    throw new Error("Candidate profile reference is missing a default headline.");
  }

  if (targetRoleFamilies.length === 0) {
    throw new Error("Candidate profile reference is missing target role families.");
  }

  return {
    id: options.profileId ?? createProfileId(fullName),
    fullName,
    headline,
    targetRoleFamilies,
    certifications,
    coreProofPoints,
    documents: createDocumentReferences(documentsSection.keyValues, options.referencePath),
    recurringAnswers: createRecurringAnswers(screeningSection.keyValues, options.referencePath)
  };
}

function splitSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection: string | undefined;

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      sections.set(currentSection, []);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sections.get(currentSection)?.push(line);
  }

  return sections;
}

function parseBulletSection(lines: readonly string[]): ParsedBulletSection {
  const simpleItems: string[] = [];
  const keyValues = new Map<string, string>();
  const keyedLists = new Map<string, string[]>();
  let currentListKey: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("- ")) {
      if (trimmed.length > 0 && !trimmed.startsWith("### ")) {
        currentListKey = undefined;
      }
      continue;
    }

    const indent = line.search(/\S|$/);
    const content = trimmed.slice(2).trim();

    if (indent > 0 && currentListKey) {
      keyedLists.get(currentListKey)?.push(content);
      continue;
    }

    currentListKey = undefined;
    const keyValueMatch = content.match(/^([^:]+):\s*(.*)$/);

    if (!keyValueMatch) {
      simpleItems.push(content);
      continue;
    }

    const [, key, value] = keyValueMatch;

    if (value.length === 0) {
      currentListKey = key.trim();
      keyedLists.set(currentListKey, []);
      continue;
    }

    keyValues.set(key.trim(), value.trim());
  }

  return {
    simpleItems: filterKnownValues(simpleItems),
    keyValues: filterKnownKeyValues(keyValues),
    keyedLists: filterKnownKeyedLists(keyedLists)
  };
}

function filterKnownValues(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !isTodoValue(value));
}

function filterKnownKeyValues(values: Map<string, string>): Map<string, string> {
  return new Map(
    Array.from(values.entries())
      .filter(([, value]) => !isTodoValue(value))
      .map(([key, value]) => [key, value.trim()])
  );
}

function filterKnownKeyedLists(values: Map<string, string[]>): Map<string, string[]> {
  return new Map(
    Array.from(values.entries())
      .map(([key, list]) => [key, filterKnownValues(list)] as const)
      .filter(([, list]) => list.length > 0)
  );
}

function createDocumentReferences(
  entries: Map<string, string>,
  referencePath: string
): DocumentReference[] {
  return Array.from(entries.entries()).map(([description, path]) => ({
    key: toKey(description),
    path,
    description,
    source: createSourceReference(referencePath, "Documents and file references")
  }));
}

function createRecurringAnswers(
  entries: Map<string, string>,
  referencePath: string
): RecurringAnswer[] {
  return Array.from(entries.entries()).map(([question, answer]) => ({
    key: toKey(question),
    question,
    answer,
    source: createSourceReference(referencePath, "Common screening answers")
  }));
}

function createSourceReference(referencePath: string, sectionTitle: string): SourceReference {
  return {
    kind: "manual",
    reference: `${referencePath}#${toAnchor(sectionTitle)}`
  };
}

function createProfileId(fullName: string): string {
  return toKey(fullName) || "candidate-profile";
}

function firstPresent(...values: Array<string | undefined>): string | undefined {
  return values
    .map((value) => value?.trim())
    .find((value): value is string => typeof value === "string" && value.length > 0 && !isTodoValue(value));
}

function toKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAnchor(value: string): string {
  return toKey(value);
}

function isTodoValue(value: string): boolean {
  return value.trim().toUpperCase() === "TODO";
}
