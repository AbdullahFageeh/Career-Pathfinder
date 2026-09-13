function writeJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

export default {
  fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/health") {
      return writeJson({
        status: "ok",
        service: "career-pathfinder",
        timestamp: new Date().toISOString()
      });
    }

    if (path === "/version") {
      return writeJson({
        name: "career-pathfinder",
        version: process.env.npm_package_version ?? "0.1.0"
      });
    }

    if (path === "/") {
      return writeJson({
        status: "ok",
        service: "career-pathfinder",
        message: "Career Pathfinder service is running.",
        emailSafety: "syntax, domain, MX, and delivery-report checks enabled"
      });
    }

    return writeJson(
      {
        status: "not_found",
        path
      },
      404
    );
  }
};
