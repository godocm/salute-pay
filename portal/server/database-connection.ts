// pg currently treats these names as verify-full unless libpq compatibility is
// explicitly enabled. Preserve that behavior across the driver's upcoming change.
export function explicitDatabaseTls(connectionString: string) {
  const url = new URL(connectionString);
  if (url.searchParams.get("uselibpqcompat") === "true")
    return connectionString;
  const mode = url.searchParams.get("sslmode");
  if (!mode || !["prefer", "require", "verify-ca"].includes(mode))
    return connectionString;
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
