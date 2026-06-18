import { access } from "node:fs/promises";
import { join, extname } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { chromium, type Page } from "playwright-core";

import type { CandidateProfile } from "../shared/contracts.js";

const DEFAULT_FORM_TIMEOUT_MS = 30_000;
const GREENHOUSE_BROWSER_EXECUTABLE_PATH_ENV = "GREENHOUSE_BROWSER_EXECUTABLE_PATH";
const SUPPORTED_GREENHOUSE_RESUME_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf"
]);
const BUILT_IN_HOSTED_FIELD_IDS = new Set([
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "country",
  "phone"
]);
const TRUTHY_HOSTED_ANSWERS = new Set([
  "1",
  "accept",
  "accepted",
  "acknowledge",
  "consent",
  "ok",
  "true",
  "yes",
  "yes-i-acknowledge"
]);

type HostedGreenhouseFieldType = "text" | "textarea" | "checkbox";

type HostedGreenhouseFieldDescriptor = {
  id: string;
  label: string;
  cleanLabel: string;
  type: HostedGreenhouseFieldType;
  required: boolean;
};

export type HostedGreenhouseFieldValue = string | boolean | undefined;

export type HostedGreenhousePrefillOptions = {
  browserExecutablePath?: string;
  headless?: boolean;
  keepOpen?: boolean;
  resumePath?: string;
  timeoutMs?: number;
};

export type HostedGreenhousePrefillResult = {
  targetUrl: string;
  browserExecutablePath: string;
  resumePath?: string;
  filledFields: string[];
  missingRequiredFields: string[];
  readyForManualReview: boolean;
  keptBrowserOpen: boolean;
};

export async function prefillHostedGreenhouseApplication(
  targetUrl: string,
  profile: CandidateProfile,
  options: HostedGreenhousePrefillOptions = {}
): Promise<HostedGreenhousePrefillResult> {
  const headless = options.headless ?? false;
  const keepOpen = options.keepOpen ?? false;

  if (headless && keepOpen) {
    throw new Error("Option --keep-open requires a visible browser.");
  }

  const browserExecutablePath = await resolveHostedGreenhouseBrowserExecutablePath(
    options.browserExecutablePath
  );
  const resumePath = await resolveHostedGreenhouseResumePath(profile, options.resumePath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_FORM_TIMEOUT_MS;
  const answerMap = createHostedGreenhouseAnswerMap(profile);
  const filledFields = new Set<string>();
  const missingRequiredFields = new Set<string>();
  const browser = await chromium.launch({
    executablePath: browserExecutablePath,
    headless
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 2200
      }
    });

    await openHostedGreenhouseForm(page, targetUrl, timeoutMs);

    const descriptors = await readHostedGreenhouseFieldDescriptors(page);
    const descriptorsById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

    await fillHostedTextField(
      page,
      descriptorsById.get("first_name"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );
    await fillHostedTextField(
      page,
      descriptorsById.get("last_name"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );
    await fillHostedTextField(
      page,
      descriptorsById.get("preferred_name"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );
    await fillHostedTextField(
      page,
      descriptorsById.get("email"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );
    await fillHostedCountryField(
      page,
      descriptorsById.get("country"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );
    await fillHostedTextField(
      page,
      descriptorsById.get("phone"),
      profile,
      answerMap,
      filledFields,
      missingRequiredFields
    );

    const resumeLocator = page.locator("#resume");
    if ((await resumeLocator.count()) > 0) {
      if (resumePath) {
        await resumeLocator.setInputFiles(resumePath);
        filledFields.add("Resume/CV");
      } else {
        missingRequiredFields.add("Resume/CV");
      }
    }

    for (const descriptor of descriptors) {
      if (BUILT_IN_HOSTED_FIELD_IDS.has(descriptor.id)) {
        continue;
      }

      if (descriptor.type === "checkbox") {
        const shouldCheck = resolveHostedGreenhouseFieldValue(descriptor, profile, answerMap);

        if (shouldCheck === true) {
          await page.locator(`[id="${descriptor.id}"]`).check();
          filledFields.add(descriptor.cleanLabel);
        } else if (descriptor.required) {
          missingRequiredFields.add(descriptor.cleanLabel);
        }

        continue;
      }

      const answer = resolveHostedGreenhouseFieldValue(descriptor, profile, answerMap);

      if (typeof answer === "string" && answer.trim().length > 0) {
        await page.locator(`[id="${descriptor.id}"]`).fill(answer);
        filledFields.add(descriptor.cleanLabel);
      } else if (descriptor.required) {
        missingRequiredFields.add(descriptor.cleanLabel);
      }
    }

    if (keepOpen) {
      await waitForManualReview();
    }

    return {
      targetUrl,
      browserExecutablePath,
      ...(resumePath ? { resumePath } : {}),
      filledFields: Array.from(filledFields).sort((left, right) => left.localeCompare(right)),
      missingRequiredFields: Array.from(missingRequiredFields).sort((left, right) =>
        left.localeCompare(right)
      ),
      readyForManualReview: missingRequiredFields.size === 0,
      keptBrowserOpen: keepOpen
    };
  } finally {
    await browser.close();
  }
}

export function createHostedGreenhouseAnswerMap(profile: CandidateProfile): Map<string, string> {
  return new Map(
    profile.recurringAnswers.flatMap((answer) => [
      [normalizeAnswerKey(answer.question), answer.answer] as const,
      [normalizeAnswerKey(answer.key), answer.answer] as const
    ])
  );
}

export function resolveHostedGreenhouseFieldValue(
  descriptor: Pick<HostedGreenhouseFieldDescriptor, "id" | "label" | "type">,
  profile: CandidateProfile,
  answerMap: Map<string, string> = createHostedGreenhouseAnswerMap(profile)
): HostedGreenhouseFieldValue {
  const cleanLabel = cleanFieldLabel(descriptor.label);
  const builtInValue = resolveBuiltInHostedFieldValue(descriptor.id, cleanLabel, profile);

  if (typeof builtInValue !== "undefined") {
    return builtInValue;
  }

  if (descriptor.type === "checkbox") {
    return shouldCheckHostedGreenhouseOption(answerMap, cleanLabel);
  }

  return (
    answerMap.get(normalizeAnswerKey(cleanLabel)) ??
    answerMap.get(normalizeAnswerKey(descriptor.id))
  );
}

export function shouldCheckHostedGreenhouseOption(
  answerMap: Map<string, string>,
  optionLabel: string
): boolean {
  const normalizedOption = normalizeAnswerKey(optionLabel);

  if (normalizedOption.length === 0) {
    return false;
  }

  if (
    Array.from(answerMap.values()).some(
      (answerValue) => normalizeAnswerKey(answerValue) === normalizedOption
    )
  ) {
    return true;
  }

  const directAnswer = answerMap.get(normalizedOption);
  return directAnswer ? isTruthyHostedGreenhouseAnswer(directAnswer) : false;
}

export async function resolveHostedGreenhouseResumePath(
  profile: CandidateProfile,
  preferredPath?: string
): Promise<string | undefined> {
  const configuredPath = preferredPath?.trim();

  if (configuredPath) {
    if (!isSupportedResumeExtension(configuredPath)) {
      throw new Error(
        "Hosted Greenhouse prefill requires a resume file with PDF, DOC, DOCX, TXT, or RTF extension."
      );
    }

    await access(configuredPath);
    return configuredPath;
  }

  const candidatePaths = profile.documents
    .filter((document) => isSupportedResumeExtension(document.path))
    .sort((left, right) => rankResumeDocument(left.description) - rankResumeDocument(right.description))
    .map((document) => document.path);

  for (const path of candidatePaths) {
    try {
      await access(path);
      return path;
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function resolveHostedGreenhouseBrowserExecutablePath(
  configuredPath?: string
): Promise<string> {
  const candidates = Array.from(
    new Set(
      [
        configuredPath?.trim(),
        process.env[GREENHOUSE_BROWSER_EXECUTABLE_PATH_ENV]?.trim(),
        ...readDefaultBrowserExecutablePaths()
      ].filter(
        (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
      )
    )
  );

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `Unable to find a supported local browser. Pass --browser-executable-path or set ${GREENHOUSE_BROWSER_EXECUTABLE_PATH_ENV}.`
  );
}

async function openHostedGreenhouseForm(
  page: Page,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  await page.goto(targetUrl, {
    waitUntil: "commit",
    timeout: timeoutMs
  });
  await page.waitForLoadState("domcontentloaded", {
    timeout: timeoutMs
  }).catch(() => {});
  await page.waitForTimeout(4_000);

  const pageText = await page.locator("body").innerText();

  if (/no longer open/i.test(pageText)) {
    throw new Error("The Greenhouse hosted page says this job is no longer open.");
  }

  const firstNameField = page.locator("#first_name");

  if ((await firstNameField.count()) === 0) {
    const applyButton = page.getByRole("button", {
      name: "Apply",
      exact: true
    });

    if ((await applyButton.count()) > 0) {
      await applyButton.click();
      await page.waitForTimeout(4_000);
    }
  }

  if ((await firstNameField.count()) === 0) {
    throw new Error("The hosted Greenhouse application form did not load.");
  }
}

async function readHostedGreenhouseFieldDescriptors(
  page: Page
): Promise<HostedGreenhouseFieldDescriptor[]> {
  const descriptors = await page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const cleanLabel = (value: string): string =>
      value.replace(/\s+/g, " ").replace(/\*/g, " ").trim();

    return Array.from(document.querySelectorAll("label[for]"))
      .map((labelElement) => {
        const htmlFor = labelElement.getAttribute("for") ?? "";
        const control = document.getElementById(htmlFor);

        if (!control || !isVisible(control)) {
          return undefined;
        }

        const typeAttribute = control.getAttribute("type") ?? "";

        if (typeAttribute === "search") {
          return undefined;
        }

        const label = (labelElement.textContent ?? "").replace(/\s+/g, " ").trim();

        if (label.length === 0) {
          return undefined;
        }

        return {
          id: htmlFor,
          label,
          cleanLabel: cleanLabel(label),
          type:
            control.tagName.toLowerCase() === "textarea"
              ? "textarea"
              : typeAttribute === "checkbox"
                ? "checkbox"
                : "text",
          required: label.includes("*")
        };
      })
      .filter(
        (descriptor): descriptor is HostedGreenhouseFieldDescriptor => typeof descriptor !== "undefined"
      );
  });

  return descriptors;
}

async function fillHostedTextField(
  page: Page,
  descriptor: HostedGreenhouseFieldDescriptor | undefined,
  profile: CandidateProfile,
  answerMap: Map<string, string>,
  filledFields: Set<string>,
  missingRequiredFields: Set<string>
): Promise<void> {
  if (!descriptor) {
    return;
  }

  const answer = resolveHostedGreenhouseFieldValue(descriptor, profile, answerMap);

  if (typeof answer === "string" && answer.trim().length > 0) {
    await page.locator(`[id="${descriptor.id}"]`).fill(answer);
    filledFields.add(descriptor.cleanLabel);
    missingRequiredFields.delete(descriptor.cleanLabel);
    return;
  }

  if (descriptor.required) {
    missingRequiredFields.add(descriptor.cleanLabel);
  }
}

async function fillHostedCountryField(
  page: Page,
  descriptor: HostedGreenhouseFieldDescriptor | undefined,
  profile: CandidateProfile,
  answerMap: Map<string, string>,
  filledFields: Set<string>,
  missingRequiredFields: Set<string>
): Promise<void> {
  if (!descriptor) {
    return;
  }

  const answer = resolveHostedGreenhouseFieldValue(descriptor, profile, answerMap);

  if (typeof answer !== "string" || answer.trim().length === 0) {
    if (descriptor.required) {
      missingRequiredFields.add(descriptor.cleanLabel);
    }

    return;
  }

  const countryInput = page.locator(`#${descriptor.id}`);

  await countryInput.click();
  await countryInput.fill(answer);
  await page.waitForTimeout(800);

  const matchingOption = page.locator("[role=\"option\"]", {
    hasText: answer
  }).first();

  if ((await matchingOption.count()) === 0) {
    if (descriptor.required) {
      missingRequiredFields.add(descriptor.cleanLabel);
    }

    return;
  }

  await matchingOption.click();
  filledFields.add(descriptor.cleanLabel);
  missingRequiredFields.delete(descriptor.cleanLabel);
}

function resolveBuiltInHostedFieldValue(
  id: string,
  label: string,
  profile: CandidateProfile
): string | undefined {
  const normalizedId = normalizeAnswerKey(id);
  const normalizedLabel = normalizeAnswerKey(label);
  const { firstName, lastName } = splitCandidateName(profile);

  if (normalizedId === "first-name" || normalizedLabel === "first-name") {
    return firstName;
  }

  if (normalizedId === "last-name" || normalizedLabel === "last-name") {
    return lastName;
  }

  if (
    normalizedId === "preferred-name" ||
    normalizedLabel === "preferred-name" ||
    normalizedLabel === "preferred-first-name"
  ) {
    return profile.preferredName ?? firstName;
  }

  if (normalizedId === "email" || normalizedLabel === "email") {
    return profile.email;
  }

  if (normalizedId === "phone" || normalizedLabel === "phone") {
    return profile.phone;
  }

  if (normalizedId === "country" || normalizedLabel === "country") {
    return profile.country;
  }

  return undefined;
}

function splitCandidateName(profile: CandidateProfile): {
  firstName?: string;
  lastName?: string;
} {
  const preferredNameParts = splitNameParts(profile.preferredName);
  const fullNameParts = splitNameParts(profile.fullName);

  return {
    firstName: preferredNameParts[0] ?? fullNameParts[0],
    lastName:
      (preferredNameParts.length > 1 ? preferredNameParts.slice(1).join(" ") : undefined) ??
      (fullNameParts.length > 1 ? fullNameParts.slice(1).join(" ") : undefined)
  };
}

function splitNameParts(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function cleanFieldLabel(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\*/g, " ").trim();
}

function normalizeAnswerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isTruthyHostedGreenhouseAnswer(value: string): boolean {
  return TRUTHY_HOSTED_ANSWERS.has(normalizeAnswerKey(value));
}

function isSupportedResumeExtension(path: string): boolean {
  return SUPPORTED_GREENHOUSE_RESUME_EXTENSIONS.has(extname(path).toLowerCase());
}

function rankResumeDocument(description: string): number {
  const haystack = description.toLowerCase();
  return haystack.includes("cv") || haystack.includes("resume") ? 0 : 1;
}

function readDefaultBrowserExecutablePaths(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }

  if (process.platform === "linux") {
    return [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    ];
  }

  if (process.platform === "win32") {
    return [
      process.env.PROGRAMFILES
        ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      process.env["PROGRAMFILES(X86)"]
        ? join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
        : undefined
    ].filter((candidate): candidate is string => typeof candidate === "string");
  }

  return [];
}

async function waitForManualReview(): Promise<void> {
  const readline = createInterface({
    input,
    output
  });

  try {
    await readline.question(
      "The hosted Greenhouse form is ready for review. Submit it manually in the browser, then press Enter here to close the session. "
    );
  } finally {
    readline.close();
  }
}
