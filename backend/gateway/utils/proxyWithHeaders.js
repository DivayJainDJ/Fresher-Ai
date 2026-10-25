import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { normalizeServiceUrl } from "./normalizeServiceUrl.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cloudRunTokens = new Map();

const getCloudRunIdToken = async (audience) => {
    const cached = cloudRunTokens.get(audience);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const metadataUrl = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
    metadataUrl.searchParams.set("audience", audience);
    metadataUrl.searchParams.set("format", "full");
    const response = await fetch(metadataUrl, {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Cloud Run identity token request failed (${response.status})`);
    const token = (await response.text()).trim();
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    cloudRunTokens.set(audience, { token, expiresAt: Number(payload.exp) * 1000 });
    return token;
};

export const proxyWithHeaders = (serviceUrl, routePrefix, { preserveBody = false, rawBody = false, sse = false, timeoutMs = 180_000 } = {}) => {
    const target = normalizeServiceUrl(serviceUrl);

    if (!target) {
        throw new Error(`Missing proxy target for route prefix "${routePrefix}"`);
    }

    const routeRegex = new RegExp(`^${escapeRegex(routePrefix)}`);

    const proxy = createProxyMiddleware({
        target,
        changeOrigin: true,
        proxyTimeout: sse ? timeoutMs : 180_000,
        timeout: sse ? timeoutMs : 180_000,
        selfHandleResponse: false,
        pathRewrite: (path) => {
            const rewrittenPath = path.replace(routeRegex, "");
            return rewrittenPath || "/";
        },
        on: {
            proxyReq: (proxyReq, req) => {
                if (req.cloudRunAuthorization) proxyReq.setHeader("authorization", req.cloudRunAuthorization);
                if (sse) {
                    proxyReq.setHeader("accept-encoding", "identity");
                    proxyReq.setHeader("accept", "text/event-stream");
                }
                if (req.requestId) proxyReq.setHeader("x-request-id", req.requestId);
                if (req.user?.userId) {
                    proxyReq.setHeader("x-user-id", req.user.userId);
                }

                const sessionId =
                    req.cookies?.session ||
                    req.headers["x-session-id"];

                if (sessionId) {
                    proxyReq.setHeader("x-session-id", sessionId);
                }
                if (req.coinCharge && Number.isFinite(req.user?.interviewCoin)) {
                    proxyReq.setHeader("x-interview-coins", String(req.user.interviewCoin));
                }

                if (rawBody && req.rawBody) {
                    proxyReq.setHeader("content-length", req.rawBody.length);
                    proxyReq.write(req.rawBody);
                } else if (!preserveBody) {
                    fixRequestBody(proxyReq, req);
                }
            },
            proxyRes: (_proxyRes, _req, res) => {
                if (!sse) return;
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("X-Accel-Buffering", "no");
                res.setHeader("Content-Encoding", "identity");
            },
            error: (error, req, res) => {
                console.error(`proxy error [${routePrefix}] -> ${target}`, error.message);

                if (sse && res.headersSent && !res.destroyed && !res.writableEnded) {
                    try {
                        res.write(`event: error\ndata: ${JSON.stringify({ message: "Feedback stream connection failed" })}\n\n`);
                        res.end();
                    } catch { /* The client has already disconnected. */ }
                    return;
                }

                if (!res.headersSent) {
                    const origin = req.headers.origin;
                    if (origin) {
                        res.setHeader("Access-Control-Allow-Origin", origin);
                        res.setHeader("Access-Control-Allow-Credentials", "true");
                    }

                    const isTimeout =
                        error.code === "ECONNABORTED" ||
                        error.message?.includes("timeout") ||
                        error.message?.includes("ETIMEDOUT");

                    const status = isTimeout ? 504 : 502;
                    const message = isTimeout
                        ? `Service timeout for ${routePrefix}. The request took too long – please try again.`
                        : `Service unavailable for ${routePrefix}. Please try again in a moment.`;

                    res.status(status).json({ message });
                }
            },
        },
    });

    return (req, res, next) => {
        // Local Compose and Render targets do not use Cloud Run IAM. Cloud Run
        // services stay private and receive a short-lived audience-bound token.
        if (process.env.K_SERVICE && target.startsWith("https://")) {
            getCloudRunIdToken(target)
                .then((token) => {
                    req.cloudRunAuthorization = `Bearer ${token}`;
                    proxy(req, res, next);
                })
                .catch(next);
            return;
        }
        proxy(req, res, next);
    };
};
