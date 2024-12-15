use std::{fs, io, thread};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;
use tracing::{error, info};
use crate::utils::utils::send_request;

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

pub fn recover_backup(
    backup_path: &Path,
    target_dir: &Path,
    world_name: &str,
    server_exe: &str,
    seven_zip_path: &Path,
    url: Option<&str>,
    auth: Option<&str>,
) -> io::Result<()> {
    let worlds_dir = target_dir.join("worlds");
    let world_path = worlds_dir.join(world_name);
    let server_exe_path = target_dir.join(server_exe);

    // 先处理 stop 请求
    if let Some(url) = url {
        let mut modified_url = url.replace("{}", "stop"); // 替换为 stop

        // 检查是否存在 &msg= 参数
        if let Some(pos) = modified_url.rfind("&msg=") {
            // 找到最后一个 &msg=，然后找到该值的结束位置
            let end_pos = modified_url[pos + "&msg=".len()..]
                .find('&')
                .map(|x| pos + "&msg=".len() + x) // 找到下一个 & 或结尾
                .unwrap_or(modified_url.len());   // 如果没有找到 &，就取结尾

            // 删除最后一个 &msg=<value> 的值部分
            modified_url.replace_range(pos..end_pos, "");
        }

        let api_status = send_request(&modified_url, auth).unwrap_or_else(|e| {
            error!("Failed to check API status: {}", e);
            "unknown".to_string() // 返回状态未知
        });
        info!("API status: {}", api_status);

        thread::sleep(Duration::from_secs(5));
    }




    // 查找并终止服务器进程
    for _ in 0..3 {
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

    if let Some(url) = url {
        let mut modified_url = url.replace("{}", "start"); // 替换为 start

        // 如果有多个 &msg= 参数
        let mut msg_positions = Vec::new();
        let mut start = 0;

        // 找到所有 &msg= 的位置
        while let Some(pos) = modified_url[start..].find("&msg=") {
            let pos = start + pos;
            msg_positions.push(pos);
            start = pos + 5; // 跳过 &msg= 部分继续查找
        }

        // 如果找到多个 &msg=，删除第一个多余的
        if msg_positions.len() > 1 {
            // 删除第一个 &msg= 参数，保留最后一个
            let first_msg_pos = msg_positions[0];
            let next_amp_pos = modified_url[first_msg_pos + "&msg=".len()..]
                .find('&')
                .map(|x| first_msg_pos + "&msg=".len() + x)
                .unwrap_or(modified_url.len());

            // 删除 &msg= 后的值部分
            modified_url.replace_range(first_msg_pos..next_amp_pos, "");
        }

        // 如果有多余的 & 需要去掉
        if modified_url.ends_with("&") {
            modified_url.pop(); // 删除最后的 &
        }

        info!("url: {}", &modified_url);

        let api_status = send_request(&modified_url, auth).unwrap_or_else(|e| {
            error!("Failed to check API status: {}", e);
            "unknown".to_string() // 返回状态未知
        });
        info!("API status: {}", api_status);

        if auth.is_some() {
            info!("URL and Auth provided. Skipping server startup.");
            return Ok(()); // 如果 auth 存在，跳过启动服务器
        }
    }




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