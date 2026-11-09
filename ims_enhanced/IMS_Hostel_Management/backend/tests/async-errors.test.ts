import assert from "node:assert/strict";
import test from "node:test";
import { Router } from "express";
import { forwardAsyncErrors } from "../src/middleware/async-errors.js";

test("async route failures are forwarded to Express error middleware", async () => {
  const router = Router();
  router.get("/failure", async () => { throw new Error("test failure"); });
  forwardAsyncErrors(router);
  const routeLayer = (router as unknown as { stack: Array<{ route: { stack: Array<{ handle: (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<unknown> }> } }> }).stack[0].route.stack[0];
  let forwarded: unknown;
  await routeLayer.handle({}, {}, error => { forwarded = error; });
  assert.ok(forwarded instanceof Error);
  assert.equal(forwarded.message, "test failure");
});
