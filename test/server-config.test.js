const test = require("node:test");
const assert = require("node:assert/strict");
const { parseServerOptions } = require("../src/server-config");

const lanInterfaces = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true }
  ],
  wlan0: [
    { address: "192.168.1.50", family: "IPv4", internal: false }
  ]
};

test("parseServerOptions defaults to localhost only", () => {
  assert.deepEqual(parseServerOptions([], {}, lanInterfaces), {
    host: "127.0.0.1",
    port: 8787,
    advertiseHost: "127.0.0.1",
    bindUrl: "http://127.0.0.1:8787",
    advertiseUrl: "http://127.0.0.1:8787"
  });
});

test("parseServerOptions advertises LAN IP when binding all interfaces", () => {
  assert.deepEqual(parseServerOptions(["--host", "0.0.0.0"], {}, lanInterfaces), {
    host: "0.0.0.0",
    port: 8787,
    advertiseHost: "192.168.1.50",
    bindUrl: "http://0.0.0.0:8787",
    advertiseUrl: "http://192.168.1.50:8787"
  });
});

test("parseServerOptions lets explicit advertised host override auto detection", () => {
  const options = parseServerOptions(
    ["--host=0.0.0.0", "--advertise-host", "10.0.0.22", "--port", "9000"],
    {},
    lanInterfaces
  );

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 9000);
  assert.equal(options.advertiseHost, "10.0.0.22");
  assert.equal(options.advertiseUrl, "http://10.0.0.22:9000");
});

test("parseServerOptions accepts environment defaults", () => {
  const options = parseServerOptions([], {
    HOST: "0.0.0.0",
    PORT: "9010",
    GIFCLIP_ADVERTISE_HOST: "gifbox.local"
  }, lanInterfaces);

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 9010);
  assert.equal(options.advertiseHost, "gifbox.local");
  assert.equal(options.advertiseUrl, "http://gifbox.local:9010");
});

test("parseServerOptions rejects invalid ports", () => {
  assert.throws(() => parseServerOptions(["--port", "nope"], {}, lanInterfaces), /Invalid port/);
  assert.throws(() => parseServerOptions(["--port", "70000"], {}, lanInterfaces), /Invalid port/);
});
