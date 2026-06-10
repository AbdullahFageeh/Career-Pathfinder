import { runCli } from "./cli/index.js";

process.exitCode = await runCli(process.argv.slice(2));
