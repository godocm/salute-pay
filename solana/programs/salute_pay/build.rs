use std::{env, fs, path::Path};
fn main() {
    println!("cargo:rerun-if-env-changed=SALUTE_NETWORK_DOMAIN");
    let value = env::var("SALUTE_NETWORK_DOMAIN").unwrap_or_else(|_| "00".repeat(32));
    assert!(value.len() == 64, "SALUTE_NETWORK_DOMAIN must be 32 bytes in hex");
    let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&value[i*2..i*2+2], 16).expect("hex network domain")).collect();
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("network_domain.rs"), format!("pub const NETWORK_DOMAIN: [u8; 32] = {:?};", bytes)).unwrap();
}
