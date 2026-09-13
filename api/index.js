function writeJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function readPathname(request) {
  try {
    return new URL(
      request.url ?? "/",
      `https://${request.headers.host ?? "localhost"}`
    ).pathname;
  } catch {
    return "/";
  }
}

export default function handler(request, response) {
  const path = readPathname(request);

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
      version: process.env.npm_package_version ?? "0.1.0"
    });
    return;
  }

  if (path === "/") {
    writeJson(response, 200, {
      status: "ok",
      service: "career-pathfinder",
      message: "Career Pathfinder service is running.",
      emailSafety: "syntax, domain, MX, and delivery-report checks enabled"
    });
    return;
  }

  writeJson(response, 404, {
    status: "not_found",
    path
  });
}
