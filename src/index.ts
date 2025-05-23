import path from "node:path";

import bodyParser from "body-parser";
import dotenv from "dotenv";
import express from "express";
import { LoggerStream, logger } from "./logger";

dotenv.config();

class NetworkManager {
    private _isNormalInteger(str: string | number): boolean {
        if (typeof str === "number") str = (str as number).toString();
        var n = Math.floor(Number(str));
        return n !== Infinity && String(n) === str && n >= 0;
    }

    private _validateNumberInput(
        value: unknown,
        min?: number,
        max?: number
    ): number | null {
        if (!value) return null;
        if (typeof value !== "string" && typeof value !== "number") return null;
        if (!this._isNormalInteger(value)) return null;

        const parsedValue = parseInt(value.toString());
        if (Number.isNaN(parsedValue)) return null;

        if (min !== undefined && parsedValue < min) return null;
        if (max !== undefined && parsedValue > max) return null;

        return parsedValue;
    }

    private _isValidMaskValue(value: number): boolean {
        return [0, 128, 192, 224, 240, 248, 252].includes(value);
    }

    isValidIp(ip: unknown): boolean {
        if (!ip || typeof ip !== "string") return false;
        const dividedIp = ip.split(".");
        if (dividedIp.length !== 4) return false;

        return dividedIp.every((part) => {
            const num = this._validateNumberInput(part, 0, 255);
            return num !== null;
        });
    }

    isValidHostsNum(hosts: unknown): boolean {
        return this._validateNumberInput(hosts, 0, 254) !== null;
    }

    isValidMask(mask: unknown): boolean {
        const parsedMask = this._validateNumberInput(mask);
        return parsedMask !== null && this._isValidMaskValue(parsedMask);
    }

    isValidSlash(slash: unknown): boolean {
        return this._validateNumberInput(slash, 24, 30) !== null;
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
        return 2 ** index - 2;
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
        logger.debug(`netLength = ${netLength}`);

        // 192.168.0.*100*
        const hostIp = this.getHostIp(ip);
        logger.debug(`hostIp = ${hostIp}`);

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

app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/valid-ip", (req, res) => {
    if (networkManager.isValidIp(req.query.ip)) res.sendStatus(200);
    else res.status(400).send("Invalid IP address");
});

app.get("/valid-mask", (req, res) => {
    const { mask, hosts } = req.query;
    if (networkManager.isValidMask(mask as string)) {
        const newHosts = networkManager.getHostsFromMask(
            parseInt(mask as string)
        );
        const slash = networkManager.getSlash(newHosts);

        const actualHosts =
            networkManager.isValidHostsNum(hosts as string) &&
            networkManager.isHostInRange(parseInt(hosts as string), newHosts)
                ? hosts
                : newHosts;

        res.json({ hosts: actualHosts, slash });
    } else res.status(400).send("Invalid subnet mask");
});

app.post("/", (req, res) => {
    const { ip, host } = req.body;
    const hostsNum = parseInt(host as string);
    if (!networkManager.isValidIp(ip as string))
        return res.status(400).send("Invalid IP address");
    else if (!networkManager.isValidHostsNum(host as string))
        return res.status(400).send("Invalid host number");

    logger.debug(`IP: ${ip}`);

    const maxHosts = networkManager.getHostNumber(hostsNum);
    logger.debug(`Richiesti: ${maxHosts}`);

    const mask = networkManager.getMaskFromHosts(hostsNum);
    const slash = networkManager.getSlash(hostsNum);
    logger.debug(`Subnet: 255.255.255.${mask} /${slash}`);

    const baseIp = networkManager.getBaseIp(ip as string);
    const firstIp = networkManager.getFirstIp(ip as string, maxHosts);
    const lastIp = networkManager.getLastIp(ip as string, maxHosts);
    logger.debug(`IP range: ${baseIp}.${firstIp} - ${baseIp}.${lastIp}`);

    res.json({ baseIp, firstIp, lastIp, mask, slash, maxHosts });
});

app.get("/from-hosts", (req, res) => {
    let { hosts } = req.query;
    if (!networkManager.isValidHostsNum(hosts as string)) {
        return res.status(400).send("Invalid host number");
    }
    const parsedHosts = parseInt(hosts as string);

    const mask = networkManager.getMaskFromHosts(parsedHosts);
    const slash = networkManager.getSlash(parsedHosts);

    res.json({ mask, slash });
});

app.get("/from-mask", (req, res) => {
    let { mask, hosts } = req.query;
    if (!networkManager.isValidMask(mask as string)) {
        return res.status(400).send("Invalid subnet mask");
    }
    const parsedMask = parseInt(mask as string);

    const newHosts = networkManager.getHostsFromMask(parsedMask);
    const slash = networkManager.getSlash(newHosts);

    const actualHosts =
        networkManager.isValidHostsNum(hosts as string) &&
        networkManager.isHostInRange(parseInt(hosts as string), newHosts)
            ? hosts
            : newHosts;

    res.json({ slash, hosts: actualHosts });
});

app.get("/from-slash", (req, res) => {
    let { slash, hosts } = req.query;
    if (!networkManager.isValidSlash(slash as string)) {
        return res.status(400).send("Invalid slash notation");
    }
    const parsedSlash = parseInt(slash as string);

    const mask = networkManager.getMaskFromSlash(parsedSlash);
    const newHosts = networkManager.getHostsFromMask(mask);

    const actualHosts =
        networkManager.isValidHostsNum(hosts as string) &&
        networkManager.isHostInRange(parseInt(hosts as string), newHosts)
            ? hosts
            : newHosts;

    res.json({ mask, hosts: actualHosts });
});

const PORT = Number(process.env.PORT) || 3000;
const IP = process.env.IP || "127.0.0.1";
app.listen(PORT, IP, () => {
    logger.info(`Subnet calculator server started on http://${IP}:${PORT}`);
});
