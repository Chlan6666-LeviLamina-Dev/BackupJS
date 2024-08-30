

use std::env;
use std::fs;
use std::str;
use std::io;
use std::thread;
use std::fs::File;
use std::thread::sleep;
use std::sync::{Arc, Mutex};
use std::path::{Path};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};
use reqwest::Client;
use rayon::prelude::*;
use futures::future::BoxFuture;
use std::sync::atomic::{AtomicU64, Ordering};
use futures::FutureExt;
use serde::Serialize;

async fn upload_file(client: &Client, file_path: &Path, url: &str, username: &str, password: &str) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::open(file_path)?;
    let file_stream = reqwest::Body::wrap_stream(tokio_util::codec::FramedRead::new(tokio::fs::File::from_std(file), tokio_util::codec::BytesCodec::new()));

    let res = client
        .put(url)
        .basic_auth(username, Some(password))
        .body(file_stream)
        .send()
        .await?;

    if res.status().is_success() {
        println!("文件上传成功: {}", file_path.display());
    } else {
        eprintln!("文件上传失败: {}", res.status());
    }

    Ok(())
}

fn upload_directory<'a>(client: &'a Client, dir_path: &'a Path, base_url: &'a str, remote_path: &'a str, username: &'a str, password: &'a str) -> BoxFuture<'a, Result<(), Box<dyn std::error::Error>>> {
    async move {
        let entries = fs::read_dir(dir_path)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            let relative_path = path.strip_prefix(dir_path)?;
            let remote_path_str = remote_path.strip_prefix('/').unwrap_or(remote_path);
            let remote_file_url = if path.is_file() {
                format!("{}/{}/{}", base_url.strip_suffix('/').unwrap_or(base_url), remote_path_str, relative_path.display())
            } else {
                format!("{}/{}/{}", base_url.strip_suffix('/').unwrap_or(base_url), remote_path_str, relative_path.display())
            };

            if path.is_file() {
                println!("上传文件: {}", remote_file_url); // 调试信息
                upload_file(client, &path, &remote_file_url, username, password).await?;
            } else if path.is_dir() {
                // 创建远程目录
                let res = client
                    .request(reqwest::Method::from_bytes(b"MKCOL")?, &remote_file_url)
                    .basic_auth(username, Some(password))
                    .send()
                    .await?;

                if res.status().is_success() {
                    println!("目录创建成功: {}", remote_file_url);
                } else {
                    eprintln!("目录创建失败: {}", res.status());
                }

                // 递归上传子目录内容
                upload_directory(client, &path, base_url, &remote_file_url.strip_prefix(base_url).unwrap_or(&remote_file_url), username, password).await?;
            }
        }

        Ok(())
    }.boxed()
}

async fn upload_backup(file_path: &Path, webdav_url: &str, remote_path: &str, username: &str, password: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();

    if file_path.is_file() {
        // 如果是文件，上传文件
        let file_name = file_path.file_name().unwrap().to_str().unwrap();
        let remote_file_url = format!("{}/{}", webdav_url.strip_suffix('/').unwrap_or(webdav_url), remote_path.strip_prefix('/').unwrap_or(remote_path).to_string() + "/" + file_name);
        println!("准备上传文件到: {}", remote_file_url); // 调试信息
        upload_file(&client, file_path, &remote_file_url, username, password).await
    } else if file_path.is_dir() {
        // 如果是目录，上传目录内容
        println!("准备上传目录: {}", file_path.display()); // 调试信息
        upload_directory(&client, file_path, webdav_url, remote_path, username, password).await
    } else {
        Err("提供的路径无效".into())
    }
}





fn copy_dir_recursive(src: &Path, dst: &Path, delete_after_copy: bool) -> io::Result<()> {
    if src.is_file() {
        // 如果是文件，直接复制
        fs::copy(src, dst)?;

        if delete_after_copy {
            fs::remove_file(src)?;
        }
        return Ok(());
    }

    if !dst.exists() {
        fs::create_dir(dst)?;
    }

    let entries: Vec<_> = fs::read_dir(src)?
        .map(|res| res.map(|e| e.path()))
        .collect::<Result<Vec<_>, io::Error>>()?;

    entries.par_iter().try_for_each(|path| {
        let dst_path = dst.join(path.file_name().unwrap());

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path, delete_after_copy)
        } else {
            fs::copy(path, &dst_path).map(|_| ())?;

            if delete_after_copy {
                fs::remove_file(path)?;
            }
            Ok(())
        }
    })
}



fn delete_old_backups(backup_path: &Path, max_age_days: u64, extension: &str) -> io::Result<()> {
    let now = SystemTime::now();
    let cutoff_time = now - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);

    let mut files = Vec::new();
    for entry in fs::read_dir(backup_path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            let metadata = fs::metadata(&path)?;
            let modified_time = metadata.modified()?;

            // 检查文件后缀是否匹配
            if modified_time < cutoff_time && path.extension().and_then(|ext| ext.to_str()) == Some(extension) {
                files.push(path);
            }
        }
    }

    let files = Arc::new(Mutex::new(files));
    let mut handles = vec![];
    const NUM_THREADS: usize = 4;

    for _ in 0..NUM_THREADS {
        let files = Arc::clone(&files);
        let handle = thread::spawn(move || {
            while let Some(path) = files.lock().unwrap().pop() {
                if let Err(e) = fs::remove_file(&path) {
                    eprintln!("Failed to delete file: {:?}", e);
                } else {
                    println!("Deleted old backup file: {:?}", path);
                }
            }
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.join().unwrap();
    }

    Ok(())
}




fn unzip_backup(zip_path: &Path, target_dir: &Path, seven_zip_path: &Path) -> io::Result<()> {
    // 构建解压命令
    let output = Command::new(seven_zip_path)
        .arg("x")  // 提取命令
        .arg(zip_path)  // 压缩文件路径
        .arg(format!("-o{}", target_dir.display()))  // 输出路径
        .arg("-y")  // 自动确认
        .output()?;  // 执行命令并捕获输出

    // 检查命令是否成功
    if !output.status.success() {
        eprintln!("Failed to extract backup: {}", String::from_utf8_lossy(&output.stderr));
        return Err(io::Error::new(io::ErrorKind::Other, "Extraction failed"));
    }

    Ok(())
}

fn recover_backup(backup_path: &Path, target_dir: &Path, world_name: &str, server_exe: &str, seven_zip_path: &Path) -> io::Result<()> {
    let worlds_dir = target_dir.join("worlds");
    let world_path = worlds_dir.join(world_name);
    let server_exe_path = target_dir.join(server_exe);

    for _ in 0..3 {
        // 查找并终止服务器进程
        if let Err(e) = terminate_server_process(&server_exe_path) {
            eprintln!("Error terminating server process: {}", e);
        } else {
            break;
        }
        thread::sleep(Duration::from_secs(5));
    }

    // 检查目标目录中是否存在 world_name
    while world_path.exists() {
        match fs::remove_dir_all(&world_path) {
            Ok(_) => {
                println!("Successfully deleted the world directory.");
                break;
            },
            Err(e) => {
                eprintln!("Failed to delete the world directory: {}. Retrying...", e);
                sleep(Duration::from_secs(3)); // 等待一秒后重试
            },
        }
    }

    // 解压备份文件到目标目录，并命名为 world_name
    unzip_backup(&backup_path, &world_path, seven_zip_path)?;

    // 启动服务器
    Command::new(&server_exe_path)
        .current_dir(target_dir) // 设置工作目录
        .spawn()?;

    println!("Backup {} recovered and server started.", backup_path.display());

    Ok(())
}

fn terminate_server_process(server_exe_path: &Path) -> io::Result<()> {
    let output = Command::new("tasklist")
        .stdout(Stdio::piped())
        .spawn()?
        .wait_with_output()?;

    let output_str = String::from_utf8_lossy(&output.stdout);

    for line in output_str.lines() {
        if line.contains(server_exe_path.file_name().unwrap().to_str().unwrap()) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid) = parts.get(1) {
                Command::new("taskkill")
                    .args(&["/PID", pid, "/F"])
                    .spawn()?
                    .wait()?;
            }
        }
    }

    Ok(())
}

#[derive(Serialize)]
struct DirectoryStats {
    path: String,
    size: u64,
    file_count: u64,
}

fn get_directory_stats_sync(dir_path: &Path) -> io::Result<(u64, u64)> {
    let total_size = AtomicU64::new(0);
    let file_count = AtomicU64::new(0);

    let entries: Vec<_> = fs::read_dir(dir_path)?
        .filter_map(Result::ok)
        .collect();

    entries.par_iter().try_for_each(|entry| -> io::Result<()> {
        let path = entry.path();
        let metadata = fs::metadata(&path)?;

        if metadata.is_file() {
            total_size.fetch_add(metadata.len(), Ordering::Relaxed);
            file_count.fetch_add(1, Ordering::Relaxed);
        } else if metadata.is_dir() {
            let (size, count) = get_directory_stats_sync(&path)?;
            total_size.fetch_add(size, Ordering::Relaxed);
            file_count.fetch_add(count, Ordering::Relaxed);
        }
        Ok(())
    })?;

    Ok((total_size.load(Ordering::Relaxed), file_count.load(Ordering::Relaxed)))
}


// 函数：判断字符串是否是 Base64 编码
fn is_base64_encoded(input: &str) -> bool {
    input.len() % 4 == 0 && input.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}


#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <operation> [additional arguments...]", args[0]);
        std::process::exit(1);
    }

    let operation = &args[1];

    match operation.as_str() {
        "copy" => {
            if args.len() < 4 || args.len() > 5 {
                eprintln!("Usage for copy: {} copy <source> <destination> [--delete]", args[0]);
                std::process::exit(1);
            }

            let source = Path::new(&args[2]);
            let destination = Path::new(&args[3]);

            // 判断是否有 --delete 参数
            let delete_after_copy = args.len() == 5 && args[4] == "--delete";

            match copy_dir_recursive(&source, &destination, delete_after_copy) {
                Ok(_) => println!("Copy completed successfully."),
                Err(e) => {
                    eprintln!("Error during copy: {}", e);
                    std::process::exit(1);
                }
            }
        }

        "cleanup" => {
            if args.len() != 5 {
                eprintln!("Usage for cleanup: {} cleanup <path> <max_age_days> <extension>", args[0]);
                std::process::exit(1);
            }

            let path = Path::new(&args[2]);
            let max_age_days: u64 = args[3].parse().unwrap_or_else(|_| {
                eprintln!("Invalid max_age_days value");
                std::process::exit(1);
            });

            let extension = &args[4];

            if let Err(e) = delete_old_backups(&path, max_age_days, extension) {
                eprintln!("Error during old backup cleanup: {}", e);
                std::process::exit(1);
            }
        }
        "recover" => {
            if args.len() != 7 {
                eprintln!("Usage for recover: {} recover <backup_file> <target_dir> <world_name> <server_exe> <7za_exe>", args[0]);
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
                            eprintln!("Error decoding Base64 to UTF-8: {}", e);
                            std::process::exit(1);
                        }
                    },
                    Err(e) => {
                        eprintln!("Error decoding Base64: {}", e);
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
                eprintln!("Error during backup recovery: {}", e);
                std::process::exit(1);
            }
        }

        "upload" => {
            if args.len() < 7 {
                eprintln!("Usage for upload: {} upload <backup_file> <remote_path> <webdav_url> <username> <password>", args[0]);
                std::process::exit(1);
            }

            let backup_file = Path::new(&args[2]);
            let remote_path = &args[3];
            let webdav_url = &args[4];
            let username = &args[5];
            let password = &args[6];

            if let Err(e) = upload_backup(backup_file, webdav_url, remote_path, username, password).await {
                eprintln!("Error during file upload: {}", e);
                std::process::exit(1);
            }
        }
        "stats" => {
            if args.len() != 5 {
                eprintln!("Usage for stats: {} stats <worldPath> <BackupPath> <PermanentBackupPath>", args[0]);
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
            eprintln!("Unknown operation: {}", operation);
            std::process::exit(1);
        }
    }
}
