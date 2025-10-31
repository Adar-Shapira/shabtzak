// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::api::process::{Command, CommandEvent};
use std::collections::HashMap;
use regex::Regex;

fn strip_ansi_codes(text: &str) -> String {
    // Remove ANSI escape sequences (color codes)
    let re = Regex::new(r"\x1b\[[0-9;]*m").unwrap_or_else(|_| Regex::new("").unwrap());
    re.replace_all(text, "").to_string()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Compute an app-local SQLite path and start backend sidecar if available
            let app_handle = app.handle();
            let app_dir = tauri::api::path::app_data_dir(&app_handle.config())
                .unwrap_or_else(|| std::env::temp_dir().join("shabtzak"));
            let _ = std::fs::create_dir_all(&app_dir);

            let db_path = app_dir.join("shabtzak.db");
            
            // On first launch, copy the bundled database to user's app data directory
            // This ensures all users get the initial data with Hebrew soldier names
            if !db_path.exists() {
                if let Some(resource_dir) = app_handle.path_resolver().resource_dir() {
                    let resource_path = resource_dir.join("shabtzak.db");
                    if resource_path.exists() {
                        if let Err(e) = std::fs::copy(&resource_path, &db_path) {
                            eprintln!("Failed to copy initial database: {}", e);
                        } else {
                            println!("[Shabtzak] Initialized database from bundle");
                        }
                    }
                }
            }
            
            let database_url = format!(
                "sqlite:///{}",
                db_path.to_string_lossy().replace('\\', "/")
            );
            
            // Log app data directory location for debugging
            println!("[Shabtzak] App data directory: {}", app_dir.display());
            println!("[Shabtzak] Database: {}", db_path.display());
            println!("[Shabtzak] Log file: {}\\backend.log", app_dir.display());

            // Try to spawn a bundled sidecar named "api-server"
            let mut cmd = Command::new_sidecar("api-server")
                .map_err(|e| {
                    eprintln!("No sidecar found: {}", e);
                    e
                })?;

            let mut envs = HashMap::new();
            envs.insert("DATABASE_URL".to_string(), database_url);
            cmd = cmd.envs(envs)
                .args(["--host", "127.0.0.1", "--port", "8000"]);

            let (mut rx, _child) = cmd.spawn().map_err(|e| {
                eprintln!("Failed to start backend sidecar: {}", e);
                e
            })?;

            // Capture backend port and inject it into the frontend
            // Also write logs to a file for debugging
            let log_file_path = app_dir.join("backend.log");
            let log_file_path_clone = log_file_path.clone();
            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                use std::fs::OpenOptions;
                use std::io::Write;
                
                // Open log file with UTF-8 encoding
                use std::io::BufWriter;
                let log_file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_file_path_clone)
                    .unwrap_or_else(|e| {
                        eprintln!("Failed to open log file: {}", e);
                        panic!("Cannot open log file");
                    });
                let mut log_writer = BufWriter::new(log_file);
                
                let mut backend_port = 8000u16;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            eprintln!("[api] {}", line);
                            // Strip ANSI color codes and write as UTF-8
                            let cleaned_line = strip_ansi_codes(&line);
                            if let Err(e) = writeln!(log_writer, "[api] {}", cleaned_line) {
                                eprintln!("Failed to write to log file: {}", e);
                            }
                            let _ = log_writer.flush();
                            
                            // Parse port from "Uvicorn running on http://127.0.0.1:8001"
                            if line.contains("Uvicorn running on") {
                                if let Some(port_str) = line
                                    .split("http://127.0.0.1:")
                                    .nth(1)
                                    .and_then(|s| s.split_whitespace().next())
                                {
                                    if let Ok(port) = port_str.parse::<u16>() {
                                        backend_port = port;
                                        let port_url = format!("http://localhost:{}", port);
                                        // Inject API URL into frontend via window (store in localStorage and update API)
                                        if let Some(window) = app_handle.get_window("main") {
                                            let _ = window.eval(&format!(
                                                "window.__BACKEND_URL__ = '{}'; \
                                                if (typeof localStorage !== 'undefined') {{ \
                                                    localStorage.setItem('backend_url', '{}'); \
                                                }} \
                                                if (window.updateApiBaseURL) {{ \
                                                    window.updateApiBaseURL('{}'); \
                                                }}",
                                                port_url, port_url, port_url
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|event| {
            let _ = event;
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

