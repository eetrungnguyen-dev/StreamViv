fn main() {
    embed_macos_info_plist();
    tauri_build::build()
}

/// Bake `Info.plist` into the binary's `__TEXT,__info_plist` section.
///
/// The bundled `.app` gets its `Info.plist` from the bundler, but
/// `tauri dev` (and `cargo run`) launch the bare Mach-O binary, which has no
/// bundle and therefore no usage descriptions. The first `getUserMedia()`
/// call then does not fail - TCC terminates the process outright. Linking
/// the plist in gives the loose binary the same privacy strings, so the
/// development build can open a capture card like the packaged one.
///
/// `CARGO_CFG_TARGET_OS` is the *target*, not the host, so this also does
/// the right thing when cross-compiling.
fn embed_macos_info_plist() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rerun-if-changed=Info.plist");

    let plist = match std::fs::canonicalize("Info.plist") {
        Ok(path) => path,
        Err(err) => {
            println!("cargo:warning=Info.plist not found ({err}); the dev binary will be killed by TCC when it opens the camera");
            return;
        }
    };
    println!(
        "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{}",
        plist.display()
    );
}
