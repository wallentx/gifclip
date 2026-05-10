const { spawn, spawnSync } = require("node:child_process");

const REQUIRED_TOOLS = ["gifsicle", "ffmpeg"];

function findTool(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function checkRequiredTools() {
  const tools = {};
  const missing = [];
  for (const name of REQUIRED_TOOLS) {
    const toolPath = findTool(name);
    if (toolPath) {
      tools[name] = toolPath;
    } else {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    const detail = missing.map((name) => `missing: ${name}`).join(", ");
    throw new Error(`Required native GIF tools are not available: ${detail}`);
  }
  return tools;
}

function runTool(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code !== 0) {
        const message = err.toString("utf8").trim() || `${command} exited with ${code}`;
        const error = new Error(message);
        error.code = code;
        error.stdout = out;
        error.stderr = err;
        reject(error);
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

module.exports = {
  REQUIRED_TOOLS,
  findTool,
  checkRequiredTools,
  runTool
};
