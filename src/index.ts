import dotenv from "dotenv";

dotenv.config();

import bodyParser from "body-parser";
import express from "express";
import path from "path";
import { LoggerStream, logger } from "./logger";

class Network {
    // 192.168.0
    baseIp: string;

    // 0
    startIp: number;

    // 254
    mask: number;

    constructor(baseIp: string, startIp: number, mask: number) {
        this.baseIp = baseIp;
        this.startIp = startIp;
        this.mask = mask;
    }
}

class NetworkManager {
    private _isNormalInteger(str: string): boolean {
        if (typeof str === "number") str = (str as number).toString();
        var n = Math.floor(Number(str));
        return n !== Infinity && String(n) === str && n >= 0;
    }

    isValidIp(ip: any): boolean {
        if (!ip || typeof ip !== "string") return false;
        const dividedIp = ip.split(".");
        if (dividedIp.length !== 4) return false;
        for (const ipPart of dividedIp) {
            if (!this._isNormalInteger(ipPart)) return false;
            const ipPartNum = parseInt(ipPart);
            if (typeof ipPartNum !== "number") return false;
            if (ipPartNum < 0 || ipPartNum > 255) return false;
        }
        return true;
    }

    isValidHostsNum(hosts: any): boolean {
        if (!hosts) return false;
        if (!this._isNormalInteger(hosts)) return false;
        const parsedHosts = parseInt(hosts);
        if (typeof parsedHosts !== "number") return false;
        if (parsedHosts < 0 || parsedHosts > 254) return false;
        return true;
    }

    isValidMask(mask: any): boolean {
        if (!mask) return false;
        if (!this._isNormalInteger(mask)) return false;
        const parsedMask = parseInt(mask);
        if (Number.isNaN(parsedMask)) return false;
        return (
            parsedMask === 252 ||
            parsedMask === 248 ||
            parsedMask === 240 ||
            parsedMask === 224 ||
            parsedMask === 192 ||
            parsedMask === 128 ||
            parsedMask === 0
        );
    }

    isValidSlash(slash: any): boolean {
        if (!slash) return false;
        if (!this._isNormalInteger(slash)) return false;
        const parsedSlash = parseInt(slash);
        return parsedSlash >= 24 && parsedSlash <= 30;
    }

    private _floorPowerOf2(n: number): number {
        // if ((Math.log(n) / Math.log(2)) % 1 === 0) return n;
        return 2 << (31 - Math.clz32(n));
    }

    getHostNumber(hosts: number): number {
        return this._floorPowerOf2(hosts + 1) - 2;
    }

    getMaskFromSlash(slash: number): number {
        const index = 32 - slash;
        return this._getMaskFromIndex(index);
    }

    getMaskFromHosts(hosts: number): number {
        const index = Math.log2(this.getHostNumber(hosts) + 2);
        return this._getMaskFromIndex(index);
    }

    private _getMaskFromIndex(index: number): number {
        let str = "11111111";
        for (let i = 0; i < index; i++) {
            str = NetworkManager._replaceAt(str, i, "0");
        }
        const reversed = NetworkManager._reverseStr(str);
        const subnet = parseInt(reversed, 2);
        return subnet;
    }

    getHostsFromMask(mask: number): number {
        const binary = mask.toString(2).padStart(8, "0");
        const index = binary.split("0").length - 1;
        return Math.pow(2, index) - 2;
    }

    static _reverseStr(str: string): string {
        return str.split("").reverse().join("");
    }

    static _replaceAt(str: string, i: number, str2: string): string {
        return str.substr(0, i) + str2 + str.substr(i + str2.length);
    }

    getFirstIp(ip: string, hosts: number): number {
        // 64
        const netLength = hosts + 2;
        // logger.debug(`netLength = ${netLength}`);

        // 192.168.0.*100*
        const hostIp = this.getHostIp(ip);
        // logger.debug(`hostIp = ${hostIp}`);

        let currentIp = 0;
        while (
            currentIp < 256 &&
            !(currentIp <= hostIp && hostIp <= currentIp + netLength - 1)
        ) {
            currentIp += netLength;
        }
        return currentIp;
    }

    getLastIp(ip: string, hosts: number): number {
        // hosts + 1 == netLength - 1
        return this.getFirstIp(ip, hosts) + hosts + 1;
    }

    getSlash(hosts: number): number {
        return 32 - Math.log2(this.getHostNumber(hosts) + 2);
    }

    getBaseIp(ip: string): string {
        const split = ip.split(".");
        return `${split[0]}.${split[1]}.${split[2]}`;
    }

    getHostIp(ip: string): number {
        return parseInt(ip.split(".")[3]);
    }

    isHostInRange(userHosts: number, maxHosts: number): boolean {
        return userHosts > (maxHosts + 2) / 2 - 2 && userHosts < maxHosts;
    }
}
const networkManager = new NetworkManager();

const app = express();
if (process.env.NODE_ENV !== "production") {
    const morgan = require("morgan");
    app.use(morgan("dev", { stream: new LoggerStream() }));
}

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(express.static("public"));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/valid-ip", (req, res) => {
    if (networkManager.isValidIp(req.query.ip)) res.sendStatus(200);
    else res.status(400).send("Invalid IP address");
});

app.get("/valid-mask", (req, res) => {
    const { mask, hosts } = req.query;
    if (networkManager.isValidMask(mask as any)) {
        const newHosts = networkManager.getHostsFromMask(mask as any);
        const slash = networkManager.getSlash(newHosts);

        const actualHosts =
            networkManager.isValidHostsNum(hosts) &&
            networkManager.isHostInRange(parseInt(hosts as any), newHosts)
                ? hosts
                : newHosts;

        res.json({ hosts: actualHosts, slash });
    } else res.status(400).send("Invalid subnet mask");
});

app.post("/", (req, res) => {
    const { ip, host } = req.body;
    const hostsNum = parseInt(host as any);
    if (!networkManager.isValidIp(ip))
        return res.status(400).send("Invalid IP address");
    else if (!networkManager.isValidHostsNum(host))
        return res.status(400).send("Invalid host number");

    // logger.debug(`IP: ${ip}`);

    const maxHosts = networkManager.getHostNumber(hostsNum);
    // logger.debug(`Richiesti: ${maxHosts}`);

    const mask = networkManager.getMaskFromHosts(hostsNum);
    const slash = networkManager.getSlash(hostsNum);
    // logger.debug(`Subnet: 255.255.255.${mask} /${slash}`);

    const baseIp = networkManager.getBaseIp(ip as any);
    const firstIp = networkManager.getFirstIp(ip as any, maxHosts);
    const lastIp = networkManager.getLastIp(ip as any, maxHosts);
    // logger.debug(`IP range: ${baseIp}.${firstIp} - ${baseIp}.${lastIp}`);

    res.json({ baseIp, firstIp, lastIp, mask, slash, maxHosts });
});

app.get("/from-hosts", (req, res) => {
    let { hosts } = req.query;
    if (!networkManager.isValidHostsNum(hosts)) {
        return res.status(400).send("Invalid host number");
    }
    const parsedHosts = parseInt(hosts as any);

    const mask = networkManager.getMaskFromHosts(parsedHosts);
    const slash = networkManager.getSlash(parsedHosts);

    res.json({ mask, slash });
});

app.get("/from-mask", (req, res) => {
    let { mask, hosts } = req.query;
    if (!networkManager.isValidMask(mask)) {
        return res.status(400).send("Invalid subnet mask");
    }
    const parsedMask = parseInt(mask as any);

    const newHosts = networkManager.getHostsFromMask(parsedMask);
    const slash = networkManager.getSlash(newHosts);

    const actualHosts =
        networkManager.isValidHostsNum(hosts) &&
        networkManager.isHostInRange(parseInt(hosts as any), newHosts)
            ? hosts
            : newHosts;

    res.json({ slash, hosts: actualHosts });
});

app.get("/from-slash", (req, res) => {
    let { slash, hosts } = req.query;
    if (!networkManager.isValidSlash(slash)) {
        return res.status(400).send("Invalid slash notation");
    }
    const parsedSlash = parseInt(slash as any);

    const mask = networkManager.getMaskFromSlash(parsedSlash);
    const newHosts = networkManager.getHostsFromMask(mask);

    const actualHosts =
        networkManager.isValidHostsNum(hosts) &&
        networkManager.isHostInRange(parseInt(hosts as any), newHosts)
            ? hosts
            : newHosts;

    res.json({ mask, hosts: actualHosts });
});

const PORT = Number(process.env.PORT) || 3000;
const IP = process.env.IP || "127.0.0.1";
app.listen(PORT, IP, () => {
    logger.info(`Subnet calculator server started on http://${IP}:${PORT}`);
});
