"use strict";

const net = require("net");

function normalizeIpAddress(value) {
  let normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/%[a-z0-9._-]+$/i, "");
}

function normalizeHostname(value) {
  const normalized = normalizeIpAddress(value).replace(/\.$/, "");
  return normalized;
}

function ipv4ToInteger(value) {
  const address = normalizeIpAddress(value);
  if (net.isIP(address) !== 4) return null;
  return address
    .split(".")
    .reduce((result, octet) => (result * 256) + Number.parseInt(octet, 10), 0);
}

function isIpv4PrivateOrReserved(value) {
  const address = ipv4ToInteger(value);
  if (address === null) return true;
  const ranges = [
    ["0.0.0.0", "0.255.255.255"],
    ["10.0.0.0", "10.255.255.255"],
    ["100.64.0.0", "100.127.255.255"],
    ["127.0.0.0", "127.255.255.255"],
    ["169.254.0.0", "169.254.255.255"],
    ["172.16.0.0", "172.31.255.255"],
    ["192.0.0.0", "192.0.0.255"],
    ["192.0.2.0", "192.0.2.255"],
    ["192.88.99.0", "192.88.99.255"],
    ["192.168.0.0", "192.168.255.255"],
    ["198.18.0.0", "198.19.255.255"],
    ["198.51.100.0", "198.51.100.255"],
    ["203.0.113.0", "203.0.113.255"],
    ["224.0.0.0", "255.255.255.255"],
  ];
  return ranges.some(([start, end]) => {
    const startAddress = ipv4ToInteger(start);
    const endAddress = ipv4ToInteger(end);
    return address >= startAddress && address <= endAddress;
  });
}

function parseIpv6Hextets(value) {
  let address = normalizeIpAddress(value);
  if (net.isIP(address) !== 6) return null;

  if (address.includes(".")) {
    const delimiter = address.lastIndexOf(":");
    const ipv4 = ipv4ToInteger(address.slice(delimiter + 1));
    if (delimiter < 0 || ipv4 === null) return null;
    address = `${address.slice(0, delimiter + 1)}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const groups = address.split("::");
  if (groups.length > 2) return null;
  const left = groups[0] ? groups[0].split(":") : [];
  const right = groups.length === 2 && groups[1] ? groups[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((groups.length === 1 && missing !== 0) || (groups.length === 2 && missing < 1)) return null;

  const parts = [...left, ...Array(Math.max(missing, 0)).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function embeddedIpv4(hextets) {
  return [
    (hextets[6] >>> 8) & 0xff,
    hextets[6] & 0xff,
    (hextets[7] >>> 8) & 0xff,
    hextets[7] & 0xff,
  ].join(".");
}

function isIpv6PrivateOrReserved(value) {
  const hextets = parseIpv6Hextets(value);
  if (!hextets) return true;
  const [first, second, third] = hextets;
  const firstSixZero = hextets.slice(0, 6).every((part) => part === 0);
  const ipv4Mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
  const nat64WellKnown = first === 0x0064 && second === 0xff9b && hextets.slice(2, 6).every((part) => part === 0);

  if (firstSixZero || ipv4Mapped || nat64WellKnown) {
    return isIpv4PrivateOrReserved(embeddedIpv4(hextets));
  }

  return (first & 0xfe00) === 0xfc00 // Unique local fc00::/7.
    || (first & 0xffc0) === 0xfe80 // Link-local fe80::/10.
    || (first & 0xffc0) === 0xfec0 // Deprecated site-local fec0::/10.
    || (first & 0xff00) === 0xff00 // Multicast ff00::/8.
    || (first === 0x2001 && second === 0x0000) // Teredo 2001::/32.
    || (first === 0x2001 && second === 0x0002 && third === 0x0000) // Benchmark 2001:2::/48.
    || (first === 0x2001 && second === 0x0db8) // Documentation 2001:db8::/32.
    || first === 0x2002 // 6to4 can encode private IPv4 destinations.
    || first === 0x3ffe; // Deprecated 6bone.
}

function isPrivateOrReservedIpAddress(value) {
  const address = normalizeIpAddress(value);
  const family = net.isIP(address);
  if (family === 4) return isIpv4PrivateOrReserved(address);
  if (family === 6) return isIpv6PrivateOrReserved(address);
  return true;
}

function isLocalHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname === "localhost"
    || hostname === "localhost.localdomain"
    || hostname === "ip6-localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local");
}

function isPrivateOrReservedHostname(value) {
  const hostname = normalizeHostname(value);
  if (!hostname || isLocalHostname(hostname)) return true;
  if (net.isIP(hostname)) return isPrivateOrReservedIpAddress(hostname);
  return false;
}

module.exports = {
  isLocalHostname,
  isPrivateOrReservedHostname,
  isPrivateOrReservedIpAddress,
  normalizeHostname,
};
