import { createServer, type ServerResponse } from "node:http";

const DEFAULT_PORT = 10_000;
const host = process.env.HOST ?? "0.0.0.0";
const port = parsePort(process.env.PORT);

const server = createServer((request, response) => {
  const path = readPathname(request.url, request.headers.host);

  if (path === "/health") {
    writeJson(response, 200, {
      status: "ok",
      service: "career-pathfinder",
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (path === "/version") {
    writeJson(response, 200, {
      name: "career-pathfinder",
      version: process.env.npm_package_version ?? "unknown"
    });
    return;
  }

  if (path === "/") {
    writeJson(response, 200, {
      status: "ok",
      service: "career-pathfinder",
      message: "Career Pathfinder service is running.",
      cliHelp: "Run `npm run start:cli -- --help` for CLI commands."
    });
    return;
  }

  writeJson(response, 404, {
    status: "not_found",
    path
  });
});

server.listen(port, host, () => {
  console.log(`Career Pathfinder server listening on http://${host}:${port}`);
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function parsePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const parsedPort = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65_535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}

function readPathname(rawUrl: string | undefined, hostHeader: string | undefined): string {
  try {
    const baseUrl = `http://${hostHeader ?? "localhost"}`;
    return new URL(rawUrl ?? "/", baseUrl).pathname;
  } catch {
    return "/";
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString()
  });
  response.end(body);
}
