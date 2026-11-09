import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import complaintsRouter from "./routes/complaints.js";
import resourcesRouter from "./routes/resources.js";
import dashboardRouter from "./routes/dashboard.js";
import { requireAuth } from "./middleware/auth.js";
import accountsRouter from "./routes/accounts.js";
import staffRouter from "./routes/staff.js";
import notificationsRouter from "./routes/notifications.js";
import { createRoomsRouter } from "./routes/rooms.js";
import { roomService } from "./routes/rooms-service.js";
import activityRouter from "./routes/activity.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const configuredOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => new URL(value).origin);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || configuredOrigins.includes(origin));
  },
  optionsSuccessStatus: 204
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", message: "IMS API is running." })
);

app.use("/api/complaints", requireAuth, complaintsRouter);
app.use("/api/resources", requireAuth, resourcesRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/accounts", requireAuth, accountsRouter);
app.use("/api/staff", requireAuth, staffRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/rooms", requireAuth, createRoomsRouter(roomService));
app.use("/api/activity", requireAuth, activityRouter);
app.use("/api", (_req, res) =>
  res.status(404).json({ message: "API endpoint not found." })
);

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(frontendDist, "index.html"), error => {
    if (error) next(error);
  });
});
app.use((_req, res) => res.status(404).json({ message: "Page not found." }));

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const isInvalidJson = error instanceof SyntaxError && "body" in error;
  if (!isInvalidJson) console.error(`Unhandled API error on ${req.method} ${req.path}.`);
  return res.status(isInvalidJson ? 400 : 500).json({
    message: isInvalidJson ? "Request body must contain valid JSON." : "The server could not complete the request."
  });
});

app.listen(port, () =>
  console.log(`IMS API listening at http://localhost:${port}`)
);
