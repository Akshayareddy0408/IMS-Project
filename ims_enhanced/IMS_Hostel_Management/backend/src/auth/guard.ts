import type { NextFunction, Request, Response } from "express";
import { accountIsActive, roleFromAppMetadata } from "./roles.js";

export interface AuthUserClaims {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export type UserResolver = (token: string) => Promise<{ user?: AuthUserClaims | null; error?: unknown }>;

export function createRequireAuth(resolveUser: UserResolver) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ") || !header.slice(7).trim()) {
      return res.status(401).json({ message: "Please sign in." });
    }

    try {
      const { user, error } = await resolveUser(header.slice(7).trim());
      if (error || !user) return res.status(401).json({ message: "Invalid or expired session." });
      if (!accountIsActive(user.app_metadata)) return res.status(403).json({ message: "This account is inactive. Contact an Administrator." });
      const role = roleFromAppMetadata(user.app_metadata?.role);
      if (!role) return res.status(403).json({ message: "Your account has an invalid role claim. Contact an Administrator." });
      req.user = {
        id: user.id,
        email: user.email,
        role,
        userMetadata: user.user_metadata ?? {},
        appMetadata: user.app_metadata ?? {}
      };
      return next();
    } catch {
      return res.status(503).json({ message: "Authentication service is temporarily unavailable." });
    }
  };
}
