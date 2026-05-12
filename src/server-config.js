const os = require("node:os");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const ALL_IPV4_HOST = "0.0.0.0";
const ALL_IPV6_HOST = "::";

function readOption(argv, name) {
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === name) {
      return argv[index + 1];
    }
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return undefined;
}

function parsePort(value) {
  if (value == null || value === "") {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function isAllInterfaceHost(host) {
  return host === ALL_IPV4_HOST || host === ALL_IPV6_HOST;
}

function firstLanIpv4(networkInterfaces) {
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      if (entry && entry.family === "IPv4" && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
}

function hostForUrl(host) {
  if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) {
    return `[${host}]`;
  }
  return host;
}

function parseServerOptions(argv = process.argv.slice(2), env = process.env, networkInterfaces = os.networkInterfaces()) {
  const host = readOption(argv, "--host") || env.HOST || DEFAULT_HOST;
  const port = parsePort(readOption(argv, "--port") || env.PORT);
  const explicitAdvertiseHost = readOption(argv, "--advertise-host") || env.GIFCLIP_ADVERTISE_HOST;
  const advertiseHost = explicitAdvertiseHost ||
    (isAllInterfaceHost(host) ? firstLanIpv4(networkInterfaces) || DEFAULT_HOST : host);

  return {
    host,
    port,
    advertiseHost,
    bindUrl: `http://${hostForUrl(host)}:${port}`,
    advertiseUrl: `http://${hostForUrl(advertiseHost)}:${port}`
  };
}

module.exports = {
  parseServerOptions
};
