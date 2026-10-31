'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const PORT = 8787;
const HOST = '0.0.0.0';

const HTML_FILE = path.join(__dirname, 'JerryJS_v4.html');
const NATIVE_FILE = path.join(__dirname, 'JerryNative.exe');

let messageCount = 0;
let nativeCalls = 0;

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify(data));
}

function sendHTML(res) {
    fs.readFile(HTML_FILE, (error, data) => {
        if (error) {
            sendJSON(res, 500, {
                ok: false,
                message: 'JerryJS_v4.html could not be read. Check that it is beside the bridge script.'
            });
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
        });

        res.end(data);
    });
}

function runNative() {
    return new Promise((resolve) => {
        if (!fs.existsSync(NATIVE_FILE)) {
            resolve({
                ok: false,
                message: 'JerryNative.exe was not found. Compile JerryNative.cpp first.'
            });
            return;
        }

        nativeCalls++;

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
                        message: 'Native executable failed: ' + error.message,
                        errorOutput: String(stderr || '').slice(0, 1000)
                    });
                    return;
                }

                try {
                    const result = JSON.parse(stdout.trim());

                    resolve({
                        ...result,
                        nativeCalls
                    });
                } catch (_) {
                    resolve({
                        ok: false,
                        message: 'Native executable returned invalid JSON.',
                        output: String(stdout || '').slice(0, 1000)
                    });
                }
            }
        );
    });
}

function readRequestBody(req, limit = 2048) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        let tooLarge = false;

        req.on('data', chunk => {
            size += chunk.length;

            if (size > limit) {
                tooLarge = true;
                return;
            }

            body += chunk.toString('utf8');
        });

        req.on('end', () => {
            if (tooLarge) {
                reject(new Error('Request body too large.'));
                return;
            }

            resolve(body);
        });

        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'
        });

        res.end();
        return;
    }

    const pathname = new URL(
        req.url,
        `http://${req.headers.host || 'localhost'}`
    ).pathname;

    if (req.method === 'GET' && pathname === '/') {
        sendHTML(res);
        return;
    }

    if (req.method === 'GET' && pathname === '/status') {
        sendJSON(res, 200, {
            ok: true,
            bridge: 'JerryJS PC Bridge',
            messageCount,
            nativeModule: fs.existsSync(NATIVE_FILE)
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/native/status') {
        const result = await runNative();
        sendJSON(res, result.ok ? 200 : 500, result);
        return;
    }

    if (req.method === 'POST' && pathname === '/send') {
        try {
            const body = await readRequestBody(req);
            const data = JSON.parse(body);

            if (typeof data.message !== 'string') {
                sendJSON(res, 400, {
                    ok: false,
                    message: 'Message must be text.'
                });
                return;
            }

            const message = data.message.trim();

            if (!message || message.length > 200) {
                sendJSON(res, 400, {
                    ok: false,
                    message: 'Message must contain between 1 and 200 characters.'
                });
                return;
            }

            messageCount++;

            console.log('[PS5 MESSAGE] ' + message);

            sendJSON(res, 200, {
                ok: true,
                reply: 'Your PC received the message!',
                messageCount
            });
        } catch (error) {
            sendJSON(res, 400, {
                ok: false,
                message: error.message === 'Request body too large.'
                    ? error.message
                    : 'Invalid JSON request.'
            });
        }

        return;
    }

    sendJSON(res, 404, {
        ok: false,
        message: 'Route not found.'
    });
});

server.listen(PORT, HOST, () => {
    console.log('');
    console.log('JERRYJS PC BRIDGE RUNNING');
    console.log('');

    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const item of entries || []) {
            if (item.family === 'IPv4' && !item.internal) {
                console.log(`http://${item.address}:${PORT}/`);
            }
        }
    }

    console.log('');
    console.log('Keep this window open.');
    console.log('Press Ctrl+C to stop the bridge.');
    console.log('');
});

server.on('error', error => {
    console.error('Bridge server error:', error.message);
});