fn main() {
    tauri_build::build();
    
    // Patch NSIS installer to remove unwanted desktop shortcuts
    // This runs after Tauri generates the installer.nsi but before it's compiled
    use std::fs;
    use std::path::PathBuf;
    
    // Try to find the installer.nsi that was just generated
    // Tauri generates it in target/release/nsis/x64/installer.nsi
    if let Ok(cargo_manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let installer_nsi = PathBuf::from(cargo_manifest_dir)
            .join("target")
            .join("release")
            .join("nsis")
            .join("x64")
            .join("installer.nsi");
        
        if installer_nsi.exists() {
            if let Ok(content) = fs::read_to_string(&installer_nsi) {
                // Skip if already patched
                if !content.contains("Custom cleanup: Remove unwanted shortcuts") {
                    // Add cleanup code to .onInstSuccess function
                    let cleanup = r#"
  ; Custom cleanup: Remove unwanted shortcuts (only keep Shabtzak app)
  Delete "$DESKTOP\api-server.lnk"
  Delete "$DESKTOP\Uninstall Shabtzak.lnk"
  Delete "$DESKTOP\resources.lnk"
  Delete "$DESKTOP\api-server.exe.lnk"
"#;
                    
                    // Find .onInstSuccess and add cleanup before FunctionEnd
                    if let Some(pos) = content.find("  run_done:") {
                        if let Some(end_pos) = content[pos..].find("FunctionEnd") {
                            let insert_pos = pos + end_pos;
                            let mut new_content = content.clone();
                            new_content.insert_str(insert_pos, cleanup);
                            let _ = fs::write(&installer_nsi, new_content);
                        }
                    }
                }
            }
        }
    }
}
