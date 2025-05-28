import path from 'node:path';

import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { LoggerStream, logger } from './logger';

dotenv.config();

class NetworkManager {
  private _isNormalInteger(str: string | number): boolean {
    const strValue = typeof str === 'number' ? str.toString() : str;
    const n = Math.floor(Number(strValue));
    return n !== Number.POSITIVE_INFINITY && String(n) === strValue && n >= 0;
  }

  private _validateNumberInput(
    value: unknown,
    min?: number,
    max?: number,
  ): number | null {
    if (!value) return null;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (!this._isNormalInteger(value)) return null;

    const parsedValue = Number.parseInt(value.toString());
    if (Number.isNaN(parsedValue)) return null;

    if (min !== undefined && parsedValue < min) return null;
    if (max !== undefined && parsedValue > max) return null;

    return parsedValue;
  }

  // Helper to convert IP string to a 32-bit integer
  private ipToLong(ip: string): number {
    return (
      ip
        .split('.')
        .reduce((int, oct) => (int << 8) + Number.parseInt(oct, 10), 0) >>> 0
    );
  }

  // Helper to convert a 32-bit integer to an IP string
  private longToIp(long: number): string {
    return `${long >>> 24}.${(long >> 16) & 255}.${(long >> 8) & 255}.${long & 255}`;
  }

  isValidIp(ip: unknown): boolean {
    if (!ip || typeof ip !== 'string') return false;
    const dividedIp = ip.split('.');
    if (dividedIp.length !== 4) return false;

    return dividedIp.every((part) => {
      const num = this._validateNumberInput(part, 0, 255);
      return num !== null;
    });
  }

  isValidHostsNum(hosts: unknown): boolean {
    // Max hosts for /1 is 2^31 - 2 = 2,147,483,646
    return this._validateNumberInput(hosts, 1, 2147483646) !== null;
  }

  isValidMask(mask: unknown): boolean {
    if (typeof mask !== 'string' || !this.isValidIp(mask)) return false; // Must be a valid IP format
    const maskLong = this.ipToLong(mask);
    // Check if the binary representation is valid (all ones followed by all zeros)
    // A valid mask in 32-bit representation will have its inverse (bitwise NOT)
    // as a number that is (2^k - 1) for some k. Adding 1 to this makes it a power of 2.
    const invertedMask = ~maskLong & 0xffffffff;
    return invertedMask === 0 || ((invertedMask + 1) & invertedMask) === 0;
  }

  isValidSlash(slash: unknown): boolean {
    // Allow /1 to /30 for IPv4
    return this._validateNumberInput(slash, 1, 30) !== null;
  }

  // Calculates the maximum number of hosts for a given number of requested hosts
  // by finding the smallest subnet that can accommodate them.
  // e.g. if 30 hosts requested, needs a /26 (62 hosts).
  // if 200 hosts requested, needs a /24 (254 hosts).
  // if 1 host requested, needs a /30 (2 hosts).
  // Number of hosts available in a subnet is 2^(32-slash) - 2
  // So, requestedHosts <= 2^(32-slash) - 2
  // requestedHosts + 2 <= 2^(32-slash)
  // log2(requestedHosts + 2) <= 32 - slash
  // slash <= 32 - log2(requestedHosts + 2)
  // To find the smallest subnet, we need the smallest slash that satisfies this.
  // The number of host bits needed is ceil(log2(requestedHosts + 2)).
  // Slash = 32 - hostBits
  getMaxHosts(requestedHosts: number): number {
    if (requestedHosts <= 0) return 0;
    const hostBits = Math.ceil(Math.log2(requestedHosts + 2));
    if (hostBits > 31) return 2 ** 31 - 2; // Max for /1 (31 host bits)
    if (hostBits < 2) return 2; // Min for /30
    return 2 ** hostBits - 2;
  }

  getMaskFromSlash(slash: number): string {
    if (slash < 8 || slash > 30) throw new Error('Invalid slash value');
    const maskLong = (0xffffffff << (32 - slash)) >>> 0;
    return this.longToIp(maskLong);
  }

  getMaskFromHosts(requestedHosts: number): string {
    const maxHosts = this.getMaxHosts(requestedHosts);
    if (maxHosts === 0 && requestedHosts > 0)
      throw new Error(
        'Cannot determine mask for 0 or negative hosts if requested > 0',
      );
    if (maxHosts === 0 && requestedHosts <= 0) return this.getMaskFromSlash(30); // Default to /30 if 0 or less requested

    const hostBits = Math.log2(maxHosts + 2);
    const slash = 32 - hostBits;
    return this.getMaskFromSlash(slash);
  }

  getHostsFromMask(mask: string): number {
    if (!this.isValidMask(mask))
      throw new Error('Invalid mask string for getHostsFromMask');
    const maskLong = this.ipToLong(mask);
    // Count trailing zeros for host bits
    let hostBits = 0;
    if (maskLong === 0xffffffff) {
      // /32 case, technically no hosts
      hostBits = 0;
    } else {
      let temp = ~maskLong & 0xffffffff;
      while ((temp & 1) === 1) {
        hostBits++;
        temp >>= 1;
      }
    }
    if (hostBits < 2) return 0; // Cannot have less than 2 host bits for usable hosts
    return 2 ** hostBits - 2;
  }

  getSlashFromMask(mask: string): number {
    if (!this.isValidMask(mask))
      throw new Error('Invalid mask string for getSlashFromMask');
    const maskLong = this.ipToLong(mask);
    let slash = 0;
    let temp = maskLong;
    while (temp & 0x80000000) {
      slash++;
      temp <<= 1;
    }
    return slash;
  }

  getNetworkAddress(ip: string, mask: string): string {
    if (!this.isValidIp(ip) || !this.isValidMask(mask))
      throw new Error('Invalid IP or Mask for network address calculation');
    const ipLong = this.ipToLong(ip);
    const maskLong = this.ipToLong(mask);
    const networkAddressLong = (ipLong & maskLong) >>> 0;
    return this.longToIp(networkAddressLong);
  }

  getBroadcastAddress(networkAddress: string, mask: string): string {
    if (!this.isValidIp(networkAddress) || !this.isValidMask(mask))
      throw new Error(
        'Invalid Network Address or Mask for broadcast calculation',
      );
    const networkAddressLong = this.ipToLong(networkAddress);
    const maskLong = this.ipToLong(mask);
    const broadcastAddressLong =
      (networkAddressLong | (~maskLong & 0xffffffff)) >>> 0;
    return this.longToIp(broadcastAddressLong);
  }

  // First usable is Network Address + 1
  getFirstUsableHostAddress(networkAddress: string, slash: number): string {
    if (!this.isValidIp(networkAddress))
      throw new Error(
        'Invalid Network Address for first usable host calculation',
      );
    if (slash >= 31) return networkAddress; // For /31 and /32, concept of "usable" changes or doesn't exist traditionally.
    const networkAddressLong = this.ipToLong(networkAddress);
    return this.longToIp(networkAddressLong + 1);
  }

  // Last usable is Broadcast Address - 1
  getLastUsableHostAddress(broadcastAddress: string, slash: number): string {
    if (!this.isValidIp(broadcastAddress))
      throw new Error(
        'Invalid Broadcast Address for last usable host calculation',
      );
    if (slash >= 31) return broadcastAddress; // For /31 and /32.
    const broadcastAddressLong = this.ipToLong(broadcastAddress);
    return this.longToIp(broadcastAddressLong - 1);
  }

  // Determines if the user-requested number of hosts can fit within the network defined by maxHosts.
  // This is more about validation than calculation.
  isHostRequestValidForSubnet(
    userRequestedHosts: number,
    subnetMaxHosts: number,
  ): boolean {
    return userRequestedHosts > 0 && userRequestedHosts <= subnetMaxHosts;
  }
}
const networkManager = new NetworkManager();

const app = express();
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev', { stream: new LoggerStream() }));
}

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(express.static('public'));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/valid-ip', (req, res) => {
  if (networkManager.isValidIp(req.query.ip)) res.sendStatus(200);
  else res.status(400).send('Invalid IP address');
});

app.get('/valid-mask', (req, res) => {
  const { mask, hosts } = req.query;
  if (networkManager.isValidMask(mask as string)) {
    const newHosts = networkManager.getHostsFromMask(mask as string);
    const slash = networkManager.getSlashFromMask(mask as string);

    const actualHosts =
      networkManager.isValidHostsNum(hosts as string) &&
      networkManager.isHostRequestValidForSubnet(
        Number.parseInt(hosts as string),
        newHosts,
      )
        ? hosts
        : newHosts;

    res.json({ hosts: actualHosts, slash });
  } else res.status(400).send('Invalid subnet mask');
});

app.post('/', (req, res) => {
  const { ip, host } = req.body;
  const hostsNum = Number.parseInt(host as string);
  if (!networkManager.isValidIp(ip as string))
    return res.status(400).send('Invalid IP address');
  if (!networkManager.isValidHostsNum(host as string))
    return res.status(400).send('Invalid host number');

  logger.debug(`IP: ${ip}`);

  const maxHosts = networkManager.getMaxHosts(hostsNum);
  logger.debug(`Richiesti: ${maxHosts}`);

  const mask = networkManager.getMaskFromHosts(hostsNum);
  const slash = networkManager.getSlashFromMask(mask);
  logger.debug(`Subnet: ${mask} /${slash}`);

  const networkAddress = networkManager.getNetworkAddress(ip as string, mask);
  const broadcastAddress = networkManager.getBroadcastAddress(
    networkAddress,
    mask,
  );
  const firstUsableHostAddress = networkManager.getFirstUsableHostAddress(
    networkAddress,
    slash,
  );
  const lastUsableHostAddress = networkManager.getLastUsableHostAddress(
    broadcastAddress,
    slash,
  );
  logger.debug(`IP range: ${networkAddress} - ${broadcastAddress}`);

  res.json({
    networkAddress,
    broadcastAddress,
    firstUsableHostAddress,
    lastUsableHostAddress,
    mask,
    slash,
    maxHosts,
  });
});

app.get('/from-hosts', (req, res) => {
  const { hosts } = req.query;
  if (!networkManager.isValidHostsNum(hosts as string)) {
    return res.status(400).send('Invalid host number');
  }
  const parsedHosts = Number.parseInt(hosts as string);

  const mask = networkManager.getMaskFromHosts(parsedHosts);
  const slash = networkManager.getSlashFromMask(mask);

  res.json({ mask, slash });
});

app.get('/from-mask', (req, res) => {
  const { mask /*, hosts */ } = req.query; // We no longer use the incoming 'hosts' query param to determine the returned 'hosts'
  if (!networkManager.isValidMask(mask as string)) {
    return res.status(400).send('Invalid subnet mask');
  }
  const parsedMask = mask as string;

  const calculatedHosts = networkManager.getHostsFromMask(parsedMask); // Calculate hosts based on the input mask only
  const slash = networkManager.getSlashFromMask(parsedMask);

  res.json({ slash, hosts: calculatedHosts }); // Always return the max hosts for the given mask
});

app.get('/from-slash', (req, res) => {
  const { slash /*, hosts */ } = req.query; // We no longer use the incoming 'hosts' query param to determine the returned 'hosts'
  if (!networkManager.isValidSlash(slash as string)) {
    return res.status(400).send('Invalid slash notation');
  }
  const parsedSlash = Number.parseInt(slash as string);

  const calculatedMask = networkManager.getMaskFromSlash(parsedSlash);
  const calculatedHosts = networkManager.getHostsFromMask(calculatedMask); // Calculate hosts based on the input slash only

  res.json({ mask: calculatedMask, hosts: calculatedHosts }); // Always return the max hosts for the given slash
});

const PORT = Number(process.env.PORT) || 3000;
const IP = process.env.IP || '127.0.0.1';
app.listen(PORT, IP, () => {
  logger.info(`Subnet calculator server started on http://${IP}:${PORT}`);
});
