import type { RequestHandler, Router } from "express";

/** Forward rejected async route promises to Express 4's error middleware. */
export function forwardAsyncErrors(router: Router): Router {
  const stack = (router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: RequestHandler }> } }> }).stack;
  for (const layer of stack) {
    for (const routeLayer of layer.route?.stack ?? []) {
      const handler = routeLayer.handle;
      if (handler.constructor.name !== "AsyncFunction") continue;
      routeLayer.handle = ((req, res, next) => {
        return Promise.resolve(handler(req, res, next)).catch(next);
      }) as RequestHandler;
    }
  }
  return router;
}
