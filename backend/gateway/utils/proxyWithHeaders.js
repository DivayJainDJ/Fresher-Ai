import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { normalizeServiceUrl } from "./normalizeServiceUrl.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const proxyWithHeaders = (serviceUrl, routePrefix, { preserveBody = false, rawBody = false } = {}) => {
    const target = normalizeServiceUrl(serviceUrl);

    if (!target) {
        throw new Error(`Missing proxy target for route prefix "${routePrefix}"`);
    }

    const routeRegex = new RegExp(`^${escapeRegex(routePrefix)}`);

    return createProxyMiddleware({
        target,
        changeOrigin: true,
        proxyTimeout: 180_000,
        timeout: 180_000,
        selfHandleResponse: false,
        pathRewrite: (path) => {
            const rewrittenPath = path.replace(routeRegex, "");
            return rewrittenPath || "/";
        },
        on: {
            proxyReq: (proxyReq, req) => {
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
            error: (error, req, res) => {
                console.error(`proxy error [${routePrefix}] -> ${target}`, error.message);

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
};
