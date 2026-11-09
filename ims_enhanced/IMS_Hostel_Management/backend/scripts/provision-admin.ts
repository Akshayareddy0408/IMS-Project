import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient, type User } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env before running this command.");
}

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const terminal = createInterface({ input, output });

async function listAllUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not inspect Auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function confirmExact(prompt: string, expected: string): Promise<boolean> {
  return (await terminal.question(`${prompt}\nType ${expected} to continue: `)).trim() === expected;
}

try {
  const email = (process.env.ADMIN_EMAIL ?? await terminal.question("Email to provision as the first Administrator: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");

  const users = await listAllUsers();
  const existing = users.find((user) => user.email?.toLowerCase() === email);
  const existingAdmins = users.filter((user) => {
    const role = user.app_metadata?.role;
    return role === "Administrator" || role === "Admin";
  });

  if (existing?.app_metadata?.role === "Administrator" || existing?.app_metadata?.role === "Admin") {
    console.log(`No change made. ${email} is already an Administrator.`);
    process.exitCode = 0;
  } else {
    if (existingAdmins.length > 0) {
      throw new Error("An Administrator already exists. This one-time provisioner will not create or promote another account.");
    }

    let target = existing;
    if (!target) {
      if (!(await confirmExact(`No Auth user exists for ${email}. The command can send a Supabase invitation.`, "INVITE"))) {
        throw new Error("Invitation cancelled; no account or role was changed.");
      }
      const { data, error } = await client.auth.admin.inviteUserByEmail(email);
      if (error || !data.user) throw new Error(`Could not invite the account: ${error?.message ?? "No user was returned."}`);
      target = data.user;
    } else {
      const currentRole = String(target.app_metadata?.role ?? "(no role)");
      const confirmation = `PROMOTE ${email}`;
      if (!(await confirmExact(`This will change the existing ${currentRole} role on ${email} to Administrator.`, confirmation))) {
        throw new Error("Promotion cancelled; no role was changed.");
      }
    }

    const { error } = await client.auth.admin.updateUserById(target.id, {
      app_metadata: { ...target.app_metadata, role: "Administrator" }
    });
    if (error) throw new Error(`The user exists, but the Administrator role could not be set: ${error.message}`);
    console.log(`Administrator role provisioned for ${email}. Sign in again to refresh the session claims.`);
  }
} finally {
  terminal.close();
}
