#!/usr/bin/env node

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [, , command, inputPathArg, outputPathArg] = process.argv;

const commands = ["encrypt", "decrypt", "encrypt-file", "decrypt-file"];
if (!command || !inputPathArg || !outputPathArg || !commands.includes(command)) {
  console.error("Usage: secure_pipeline_state.mjs encrypt|decrypt|encrypt-file|decrypt-file <input> <output>");
  process.exit(2);
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const key = readKey();

if (command === "encrypt-file") {
  await encryptPayload({ main: (await readFile(inputPath)).toString("base64") }, outputPath, "file");
  process.stdout.write(`Encrypted private file: ${outputPath}\n`);
  process.exit(0);
}

if (command === "decrypt-file") {
  const payload = await decryptPayload(inputPath, "file");
  if (typeof payload.main !== "string") {
    throw new Error(`Encrypted private file has no content: ${inputPath}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(payload.main, "base64"));
  process.stdout.write(`Decrypted private file: ${outputPath}\n`);
  process.exit(0);
}

if (command === "encrypt") {
  const payload = {};
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${inputPath}${suffix}`;
    try {
      payload[suffix || "main"] = (await readFile(path)).toString("base64");
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  if (!payload.main) {
    throw new Error(`Pipeline database not found: ${inputPath}`);
  }

  await encryptPayload(payload, outputPath, "pipeline-state");
  process.stdout.write(`Encrypted pipeline state: ${outputPath}\n`);
  process.exit(0);
}

const payload = await decryptPayload(inputPath, "pipeline-state");

if (!payload || typeof payload.main !== "string") {
  throw new Error(`Encrypted pipeline state has no database: ${inputPath}`);
}

const databaseDir = dirname(outputPath);
await mkdir(databaseDir, { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) {
  await rm(`${outputPath}${suffix}`, { force: true }).catch(() => undefined);
  const encoded = payload[suffix || "main"];
  if (typeof encoded === "string") {
    await writeFile(`${outputPath}${suffix}`, Buffer.from(encoded, "base64"));
  }
}
process.stdout.write(`Decrypted pipeline state: ${outputPath}\n`);

function readKey() {
  const encoded = process.env.PIPELINE_STATE_KEY?.trim();
  if (!encoded) {
    throw new Error("PIPELINE_STATE_KEY secret is required for pipeline state encryption.");
  }
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) {
    throw new Error("PIPELINE_STATE_KEY must be base64-encoded 32-byte key.");
  }
  return value;
}

function isMissingFile(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function encryptPayload(payload, path, kind) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const envelope = {
    version: 1,
    kind,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");
}

async function decryptPayload(path, expectedKind) {
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const kindMatches =
    envelope?.kind === expectedKind ||
    (expectedKind === "pipeline-state" && envelope?.kind === undefined);
  if (
    envelope?.version !== 1 ||
    !kindMatches ||
    envelope?.algorithm !== "aes-256-gcm" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error(`Invalid encrypted ${expectedKind}: ${path}`);
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8")
  );
}
