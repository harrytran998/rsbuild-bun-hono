import { Context, Hono, MiddlewareHandler, Next } from 'hono'
import type { IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'node:http';

import { createRsbuild, loadConfig } from "@rsbuild/core";

type ExpressMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: any) => void
) => void

export function adaptExpressMiddleware(middleware: ExpressMiddleware): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const req = c.req.raw as unknown as IncomingMessage
    const res = c.res as unknown as ServerResponse

    await new Promise<void>((resolve, reject) => {
      middleware(req, res, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    await next()
  }
}


const serverRender = (serverAPI) => async (_req: Context['req'], res: Context['res'], _next) => {
  const indexModule = await serverAPI.environments.ssr.loadBundle("index");

  const markup = indexModule.render();

  const template = await serverAPI.environments.web.getTransformedHtml("index");

  const html = template.replace("<!--app-content-->", markup);

  return new Response(html, {
    status: 200,
    headers: {
      "X-Custom-Header": "Hello",
      "Content-Type": "text/html",
    },
  });
};

const { content } = await loadConfig({});

const rsbuild = await createRsbuild({
  rsbuildConfig: content,
});

const app = new Hono()

// Create Rsbuild DevServer instance
const rsbuildServer = await rsbuild.createDevServer();

const serverRenderMiddleware = serverRender(rsbuildServer);

app.get("/", async (c, next) => {
  try {
    await serverRenderMiddleware(c.req, c.res, next);
  } catch (err) {
    console.error("SSR render error, downgrade to CSR...\n", err);
    next();
  }
});

app.use(adaptExpressMiddleware(rsbuildServer.middlewares));



const server = Bun.serve({
  port: rsbuildServer.port,
  async fetch(req, server) {
    const response = await app.fetch(req, { IP: server.requestIP(req) })
    rsbuildServer.afterListen();
    return response;
  },
  maxRequestBodySize: 200_000_000_000,
});

rsbuildServer.connectWebSocket({ server: server as unknown as Server });

console.log(`Server is running on port ${server.port}`);

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.stop();
  rsbuildServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.stop();
  rsbuildServer.close();
  process.exit(0);
});

