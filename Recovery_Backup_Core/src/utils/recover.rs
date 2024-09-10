use std::{fs, io, thread};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;
use crate::{error, info};

pub fn unzip_backup(zip_path: &Path, target_dir: &Path, seven_zip_path: &Path) -> io::Result<()> {
    // 构建解压命令
    let output = Command::new(seven_zip_path)
        .arg("x")  // 提取命令
        .arg(zip_path)  // 压缩文件路径
        .arg(format!("-o{}", target_dir.display()))  // 输出路径
        .arg("-y")  // 自动确认
        .output()?;  // 执行命令并捕获输出

    // 检查命令是否成功
    if !output.status.success() {
        error!("提取备份失败: {}", String::from_utf8_lossy(&output.stderr));
        return Err(io::Error::new(io::ErrorKind::Other, "Extraction failed"));
    }

    Ok(())
}

pub fn recover_backup(backup_path: &Path, target_dir: &Path, world_name: &str, server_exe: &str, seven_zip_path: &Path) -> io::Result<()> {
    let worlds_dir = target_dir.join("worlds");
    let world_path = worlds_dir.join(world_name);
    let server_exe_path = target_dir.join(server_exe);

    for _ in 0..3 {
        // 查找并终止服务器进程
        if let Err(e) = terminate_server_process(&server_exe_path) {
            error!("终止服务器进程时出错：{}", e);
        } else {
            break;
        }
        thread::sleep(Duration::from_secs(5));
    }

    // 检查目标目录中是否存在 world_name
    while world_path.exists() {
        match fs::remove_dir_all(&world_path) {
            Ok(_) => {
                info!("已成功删除世界目录");
                break;
            },
            Err(e) => {
                error!("Failed to delete the world directory: {}. Retrying...", e);
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

    info!("Backup {} recovered and server started.", backup_path.display());

    Ok(())
}

pub fn terminate_server_process(server_exe_path: &Path) -> io::Result<()> {
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