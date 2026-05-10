const fs = require("node:fs");
const path = require("node:path");
const { publicDir, exportsDir } = require("./paths");

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length
  });
  res.end(body);
}

function sendError(res, statusCode, error) {
  sendJson(res, statusCode, { error: error.message || String(error) });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error("Invalid JSON request body"));
      }
    });
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function trySendFile(res, baseDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const relative = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const filePath = path.resolve(baseDir, relative);
  const rel = path.relative(baseDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  res.writeHead(200, { "content-type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function sendStatic(req, res) {
  if (req.url.startsWith("/exports/")) {
    return trySendFile(res, exportsDir, req.url.replace(/^\/exports\//, "/"));
  }
  return trySendFile(res, publicDir, req.url);
}

module.exports = {
  sendJson,
  sendError,
  readJson,
  sendStatic
};
