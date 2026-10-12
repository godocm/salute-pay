import type { Intent, Network } from "./intents";
import { connect, signLogin, parseLink } from "./intents";
export type Account = {
  address: string;
  family: string;
  plan: "free" | "growth" | "scale";
  webhookUrl: string;
  webhookSecret: string;
  linksThisMonth: number;
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  let b: { error?: string };
  try {
    b = await r.json();
  } catch {
    throw Error(
      `The status service returned an unreadable response (${r.status}). Keep any transaction receipt and try refreshing later.`,
    );
  }
  if (!r.ok) throw Error(b.error || "Request failed.");
  return b as T;
}
export async function login(n: Network) {
  const address = await connect(n),
    c = await api<{ id: string; message: string }>("auth/challenge", {
      method: "POST",
      body: JSON.stringify({ chain: n.chain, address }),
    }),
    signature = await signLogin(n, c.message);
  await api("auth/verify", {
    method: "POST",
    body: JSON.stringify({ id: c.id, signature }),
  });
  return api<Account>("me");
}
export const publish = (i: Intent) =>
  api<Intent>("payments", { method: "POST", body: JSON.stringify(i) });
export async function importOrder(text: string): Promise<Intent> {
  const input = text.trim();
  if (input.startsWith("{")) {
    try {
      return parseLink(input);
    } catch {
      throw Error(
        "Invalid signed order JSON. Import the complete file exported by Salute.",
      );
    }
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw Error(
      "Paste a complete Salute payment link or exported signed-order JSON.",
    );
  }
  if (url.hash.startsWith("#pay=")) return parseLink(input);
  const match = /^\/pay\/([\w-]{20,40})\/?$/.exec(url.pathname);
  if (!match || url.origin !== location.origin)
    throw Error(
      "Import a Salute payment link from this site, an offline link, or exported signed JSON.",
    );
  return api<Intent>(`payments/${match[1]}`);
}
export const submitTransaction = (i: Intent, chain: string, hash: string) =>
  i.slug
    ? api(`payments/${i.slug}/transactions`, {
        method: "POST",
        body: JSON.stringify({ chain, hash }),
      })
    : Promise.resolve();
