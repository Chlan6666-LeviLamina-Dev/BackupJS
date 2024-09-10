use std::env;
use std::str;
use std::path::{Path};
use rayon::prelude::*;
use Recovery_Backup_Core::{error, info};
use Recovery_Backup_Core::utils::cleanup::delete_old_backups;
use Recovery_Backup_Core::utils::copy::copy_dir_recursive;
use Recovery_Backup_Core::utils::copy_db::copy_db;
use Recovery_Backup_Core::utils::recover::recover_backup;
use Recovery_Backup_Core::utils::stats::{get_directory_stats_sync, DirectoryStats};
use Recovery_Backup_Core::utils::upload::upload_backup;
use Recovery_Backup_Core::utils::utils::is_base64_encoded;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        error!("Usage: {} <operation> [additional arguments...]", args[0]);
        std::process::exit(1);
    }

    let operation = &args[1];

    match operation.as_str() {
        "copy_db" => {
            if args.len() != 5 {
                error!("Usage for copy_db: {} copy_db <source_world> <destination_world> <db_files>", args[0]);
                std::process::exit(1);
            }

            let source_world = Path::new(&args[2]);
            let destination_world = Path::new(&args[3]);
            let db_list_file = Path::new(&args[4]);

            match copy_db(&source_world, &destination_world, &db_list_file) {
                Ok(_) => info!("数据文件复制成功。"),
                Err(e) => {
                    error!("复制数据文件时出错: {}", e);
                    std::process::exit(1);
                }
            }
        }


        "copy" => {
            if args.len() < 4 || args.len() > 5 {
                error!("Usage for copy: {} copy <source> <destination> [--delete]", args[0]);
                std::process::exit(1);
            }

            let source = Path::new(&args[2]);
            let destination = Path::new(&args[3]);

            // 判断是否有 --delete 参数
            let delete_after_copy = args.len() == 5 && args[4] == "--delete";

            match copy_dir_recursive(&source, &destination, delete_after_copy) {
                Ok(_) => info!("复制已成功完成。"),
                Err(e) => {
                    error!("Error during copy: {}", e);
                    std::process::exit(1);
                }
            }
        }

        "cleanup" => {
            if args.len() != 5 {
                error!("Usage for cleanup: {} cleanup <path> <max_age_days> <extension>", args[0]);
                std::process::exit(1);
            }

            let path = Path::new(&args[2]);
            let max_age_days: u64 = args[3].parse().unwrap_or_else(|_| {
                error!("Invalid max_age_days value");
                std::process::exit(1);
            });

            let extension = &args[4];

            if let Err(e) = delete_old_backups(&path, max_age_days, extension) {
                error!("Error during old backup cleanup: {}", e);
                std::process::exit(1);
            }
        }
        "recover" => {
            if args.len() != 7 {
                error!("Usage for recover: {} recover <backup_file> <target_dir> <world_name> <server_exe> <7za_exe>", args[0]);
                std::process::exit(1);
            }

            let backup_file_arg = &args[2];
            let decoded_backup_file: String;

            // 判断是否是 Base64 编码
            if is_base64_encoded(backup_file_arg) {
                match base64::decode(backup_file_arg) {
                    Ok(decoded) => match str::from_utf8(&decoded) {
                        Ok(decoded_str) => decoded_backup_file = decoded_str.to_string(),
                        Err(e) => {
                            error!("Error decoding Base64 to UTF-8: {}", e);
                            std::process::exit(1);
                        }
                    },
                    Err(e) => {
                        error!("Error decoding Base64: {}", e);
                        std::process::exit(1);
                    }
                }
            } else {
                decoded_backup_file = backup_file_arg.clone();
            }

            let backup_file = Path::new(&decoded_backup_file);
            let target_dir = Path::new(&args[3]);
            let world_name = &args[4];
            let server_exe = &args[5];
            let seven_zip_path = Path::new(&args[6]);

            if let Err(e) = recover_backup(&backup_file, &target_dir, world_name, server_exe, &seven_zip_path) {
                error!("Error during backup recovery: {}", e);
                std::process::exit(1);
            }
        }

        "upload" => {
            if args.len() < 8 {
                error!("Usage for upload: {} upload <backup_file> <remote_path> <webdav_url> <username> <password> <allow_insecure>", args[0]);
                std::process::exit(1);
            }

            let backup_file = Path::new(&args[2]);
            let remote_path = &args[3];
            let webdav_url = &args[4];
            let username = &args[5];
            let password = &args[6];
            let allow_insecure: bool = args[7].parse().unwrap_or(false);

            if let Err(e) = upload_backup(backup_file, webdav_url, remote_path, username, password, allow_insecure).await {
               error!("Error during file upload: {}", e);
                std::process::exit(1);
            }
        }
        "stats" => {
            if args.len() != 5 {
                error!("Usage for stats: {} stats <worldPath> <BackupPath> <PermanentBackupPath>", args[0]);
                std::process::exit(1);
            }

            let world_path = Path::new(&args[2]);
            let backup_path = Path::new(&args[3]);
            let permanent_backup_path = Path::new(&args[4]);

            let (world_size, world_count) = get_directory_stats_sync(world_path).unwrap();
            let (backup_size, backup_count) = get_directory_stats_sync(backup_path).unwrap();
            let (permanent_backup_size, permanent_backup_count) = get_directory_stats_sync(permanent_backup_path).unwrap();

            let stats = vec![
                DirectoryStats {
                    path: world_path.to_string_lossy().into_owned(),
                    size: world_size,
                    file_count: world_count,
                },
                DirectoryStats {
                    path: backup_path.to_string_lossy().into_owned(),
                    size: backup_size,
                    file_count: backup_count,
                },
                DirectoryStats {
                    path: permanent_backup_path.to_string_lossy().into_owned(),
                    size: permanent_backup_size,
                    file_count: permanent_backup_count,
                },
            ];

            let json_output = serde_json::to_string(&stats).unwrap();
            println!("{}", json_output);
        }
        _ => {
            error!("Unknown operation: {}", operation);
            std::process::exit(1);
        }
    }
}
