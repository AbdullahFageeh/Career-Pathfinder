#!/usr/bin/env node

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [, , command, inputPathArg, outputPathArg] = process.argv;

if (!command || !inputPathArg || !outputPathArg || !["encrypt", "decrypt"].includes(command)) {
  console.error("Usage: secure_pipeline_state.mjs encrypt|decrypt <input> <output>");
  process.exit(2);
}

const inputPath = resolve(inputPathArg);
const outputPath = resolve(outputPathArg);
const key = readKey();

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

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const envelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(envelope)}\n`, "utf8");
  process.stdout.write(`Encrypted pipeline state: ${outputPath}\n`);
  process.exit(0);
}

const envelope = JSON.parse(await readFile(inputPath, "utf8"));
if (
  envelope?.version !== 1 ||
  envelope?.algorithm !== "aes-256-gcm" ||
  typeof envelope.iv !== "string" ||
  typeof envelope.tag !== "string" ||
  typeof envelope.ciphertext !== "string"
) {
  throw new Error(`Invalid encrypted pipeline state: ${inputPath}`);
}

const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const payload = JSON.parse(
  Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8")
);

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
