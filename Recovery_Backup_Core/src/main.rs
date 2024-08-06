use std::env;
use std::fs;
use std::io;
use std::thread;
use std::fs::File;
use std::io::{Read, Write};
use std::thread::sleep;
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use reqwest::Client;
use zip::ZipArchive;
use rayon::prelude::*;
use futures::future::BoxFuture;
use futures::FutureExt;

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





fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if !dst.exists() {
        fs::create_dir(dst)?;
    }

    let entries: Vec<_> = fs::read_dir(src)?.collect();

    entries.par_iter().for_each(|entry| {
        let entry = entry.as_ref().unwrap();
        let path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path).unwrap();
        } else {
            fs::copy(&path, &dst_path).unwrap();
        }
    });

    Ok(())
}

fn delete_old_backups(backup_path: &Path, max_age_days: u64) -> io::Result<()> {
    let now = SystemTime::now();
    let cutoff_time = now - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);

    let mut files = Vec::new();
    for entry in fs::read_dir(backup_path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            let metadata = fs::metadata(&path)?;
            let modified_time = metadata.modified()?;
            if modified_time < cutoff_time {
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

const BUFFER_SIZE: usize = 8 * 1024; // 8 KB

fn unzip_backup(zip_path: &Path, target_dir: &Path) -> io::Result<()> {
    let file = File::open(zip_path)?;
    let archive = Arc::new(Mutex::new(ZipArchive::new(file)?));
    let file_count = archive.lock().unwrap().len();

    (0..file_count).into_par_iter().try_for_each(|i| {
        let archive = Arc::clone(&archive);
        let mut archive = archive.lock().unwrap();
        let mut file = archive.by_index(i)?;

        let outpath = target_dir.join(file.name());

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)?;
                }
            }
            let mut outfile = File::create(&outpath)?;

            let mut buffer = vec![0; BUFFER_SIZE];
            loop {
                let bytes_read = file.read(&mut buffer)?;
                if bytes_read == 0 {
                    break;
                }
                outfile.write_all(&buffer[..bytes_read])?;
            }
        }

        Ok::<(), io::Error>(())
    })?;

    Ok(())
}

fn recover_backup(backup_path: &Path, target_dir: &Path, world_name: &str, server_exe: &str) -> io::Result<()> {
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
    unzip_backup(&backup_path, &world_path)?;

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
            if args.len() != 4 {
                eprintln!("Usage for copy: {} copy <source> <destination>", args[0]);
                std::process::exit(1);
            }
            let source = Path::new(&args[2]);
            let destination = Path::new(&args[3]);
            match copy_dir_recursive(&source, &destination) {
                Ok(_) => println!("Copy completed successfully."),
                Err(e) => {
                    eprintln!("Error during copy: {}", e);
                    std::process::exit(1);
                }
            }
        }
        "cleanup" => {
            if args.len() != 4 {
                eprintln!("Usage for cleanup: {} cleanup <path> <max_age_days>", args[0]);
                std::process::exit(1);
            }

            let path = Path::new(&args[2]);
            let max_age_days: u64 = args[3].parse().unwrap_or_else(|_| {
                eprintln!("Invalid max_age_days value");
                std::process::exit(1);
            });

            if let Err(e) = delete_old_backups(&path, max_age_days) {
                eprintln!("Error during old backup cleanup: {}", e);
                std::process::exit(1);
            }
        }
        "recover" => {
            if args.len() != 6 {
                eprintln!("Usage for recover: {} recover <backup_file> <target_dir> <world_name> <server_exe>", args[0]);
                std::process::exit(1);
            }

            let backup_file = Path::new(&args[2]);
            let target_dir = Path::new(&args[3]);
            let world_name = &args[4];
            let server_exe = &args[5];

            if let Err(e) = recover_backup(&backup_file, &target_dir, world_name, server_exe) {
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
        _ => {
            eprintln!("Unknown operation: {}", operation);
            std::process::exit(1);
        }
    }
}
