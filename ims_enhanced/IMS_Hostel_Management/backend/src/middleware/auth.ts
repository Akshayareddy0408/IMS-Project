import { supabase } from "../supabase.js";
import { createRequireAuth } from "../auth/guard.js";
import { roleAllowed, type AuthRole, type UserRole } from "../auth/roles.js";
import type { Request, Response, NextFunction } from "express";

export type { UserRole } from "../auth/roles.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string | undefined;
        role: AuthRole;
        userMetadata: Record<string, unknown>;
        appMetadata: Record<string, unknown>;
      };
    }
  }
}

export const requireAuth = createRequireAuth(async (token) => {
  const { data, error } = await supabase.auth.getUser(token);
  return { user: data.user, error };
});

export function allowRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roleAllowed(req.user.role, roles)) {
      return res.status(403).json({
        message: "You are not allowed to perform this action."
      });
    }

    next();
  };
}

export const isManager = (role: AuthRole | undefined) =>
  role === "Warden" || role === "Administrator";
