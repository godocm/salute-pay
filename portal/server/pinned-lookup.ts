import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

/** Socket lookups must return an array when Node requests all address families. */
export function pinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  const pinned = addresses.map((address) => ({ ...address }));
  if (!pinned.length) throw Error("No webhook DNS addresses.");
  return (_hostname, options, callback) => {
    if (options.all) callback(null, pinned);
    else {
      const selected = pinned.find((address) => address.family === (options.family || 4)) || pinned[0];
      callback(null, selected.address, selected.family);
    }
  };
}
