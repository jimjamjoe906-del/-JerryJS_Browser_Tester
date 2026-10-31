
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const HOST = "0.0.0.0";
const PORT = 8787;

const HTML_FILE = path.join(__dirname, "index2.html");
const NATIVE_FILE = path.join(__dirname, "JerryNative.exe");

let messageCount = 0;

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify(data));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 2048) {
                reject(new Error("Request too large"));
                req.destroy();
            }
        });

        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function runNative() {
    return new Promise(resolve => {
        if (!fs.existsSync(NATIVE_FILE)) {
            resolve({
                ok: false,
                message: "JerryNative.exe was not found."
            });
            return;
        }

        execFile(
            NATIVE_FILE,
            [],
            {
                timeout: 5000,
                windowsHide: true,
                maxBuffer: 1024 * 1024
            },
            (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        ok: false,
                        message: error.message,
                        stderr: stderr || ""
                    });
                    return;
                }

                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch {
                    resolve({
                        ok: false,
                        message: "Native program returned invalid JSON.",
                        output: stdout
                    });
                }
            }
        );
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });

        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/index2.html") {
        if (!fs.existsSync(HTML_FILE)) {
            res.writeHead(404, {
                "Content-Type": "text/plain"
            });

            res.end("index2.html could not be read. Check that it is beside the bridge script.");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        });

        fs.createReadStream(HTML_FILE).pipe(res);
        return;
    }

    if (url.pathname === "/status") {
        sendJSON(res, 200, {
            ok: true,
            bridge: "JerryJS PC Bridge",
            messageCount,
            nativeModule: fs.existsSync(NATIVE_FILE)
        });
        return;
    }

    if (url.pathname === "/native/status") {
        const result = await runNative();
        sendJSON(res, 200, result);
        return;
    }

    if (url.pathname === "/send" && req.method === "POST") {
        try {
            const body = await readRequestBody(req);
            const data = JSON.parse(body);

            if (typeof data.message !== "string" || !data.message.trim()) {
                sendJSON(res, 400, {
                    ok: false,
                    message: "A message is required."
                });
                return;
            }

            if (data.message.length > 200) {
                sendJSON(res, 400, {
                    ok: false,
                    message: "Message is too long."
                });
                return;
            }

            messageCount++;

            console.log("[PS5 MESSAGE]", data.message);

            sendJSON(res, 200, {
                ok: true,
                reply: "Your PC received the message!",
                messageCount
            });
        } catch (error) {
            sendJSON(res, 400, {
                ok: false,
                message: error.message
            });
        }

        return;
    }

    sendJSON(res, 404, {
        ok: false,
        message: "Endpoint not found."
    });
});

server.listen(PORT, HOST, () => {
    console.log("\nJERRYJS PC BRIDGE RUNNING\n");

    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const network of entries || []) {
            if (network.family === "IPv4" && !network.internal) {
                console.log(`http://${network.address}:${PORT}/`);
            }
        }
    }

    console.log("\nKeep this window open.\n");
});
