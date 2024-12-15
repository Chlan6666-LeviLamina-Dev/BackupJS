use std::{fs, io};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use rayon::prelude::*;
use tracing::{error};

// 复制 db 文件并确保文件长度符合指定要求
pub fn copy_and_truncate(source_path: &Path, destination_path: &Path, length: u64) -> io::Result<()> {
    // 复制文件
    fs::copy(source_path, destination_path)?;

    // 以读写模式打开目标文件并截断到指定长度
    let file = fs::OpenOptions::new()
        .write(true)
        .open(destination_path)?;
    // 截断文件到指定的长度
    file.set_len(length)?;
    Ok(())
}


pub fn copy_db(source_world: &Path, destination_world: &Path, db_list_file: &Path) -> io::Result<()> {
    // 提取 source_world 的文件名部分，例如 "Bedrock level"
    let source_world_name = match source_world.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid source_world path"));
        }
    };

    // 读取 db 文件列表，并动态去掉 source_world 前缀
    let db_files: Vec<(String, u64)> = {
        let file = fs::File::open(db_list_file)?;
        let reader = io::BufReader::new(file);

        // 使用 rayon 的并行读取行
        reader
            .lines()
            .par_bridge() // 并行读取行内容
            .flat_map(|line_result| {
                line_result
                    .map(|line| {
                        // 拆分行内容，以逗号分隔并进行并行处理
                        line.split(',')
                            .filter_map(|db_path| {
                                let db_path = db_path.trim();

                                // 检查是否以 source_world_name 开头
                                if db_path.starts_with(&source_world_name) {
                                    // 去除 source_world_name 和附加的分隔信息
                                    if let Some(stripped) = db_path.strip_prefix(&source_world_name) {
                                        // 去掉前导分隔符（如 '/'）
                                        let stripped = stripped.trim_start_matches(|c| c == '/' || c == '\\');
                                        // 提取文件路径和长度
                                        let mut parts = stripped.split(':');
                                        let file_path = parts.next().unwrap_or(stripped).trim().to_string();
                                        let length_str = parts.next().unwrap_or("0").trim();
                                        let length = length_str.parse::<u64>().unwrap_or(0);
                                        Some((file_path, length))
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>() // 收集结果
                    })
                    .unwrap_or_else(|_| vec![]) // 处理错误情况
            })
            .collect() // 收集所有 db 文件路径
    };

    if db_files.is_empty() {
        return Ok(());
    }

    // 并行复制 db 文件并截断到指定长度
    db_files.par_iter().for_each(|(db_file, length)| {
        let source_db_path = source_world.join(db_file);
        let destination_db_path = destination_world.join(db_file);

        if source_db_path.exists() {
            if let Some(parent) = destination_db_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Err(e) = copy_and_truncate(&source_db_path, &destination_db_path, *length) {
                error!("Error copying file {}: {:?}", source_db_path.display(), e);
            }
        }
    });

    // 复制除了 db 文件夹之外的其他文件和文件夹
    copy_other_files(source_world, destination_world)?;

    Ok(())
}

pub fn copy_other_files(source: &Path, destination: &Path) -> io::Result<()> {
    // 遍历 source 目录中的所有内容
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();

        // 跳过 db 文件夹
        if path.ends_with("db") {
            continue;
        }

        // 构建目标路径
        let dest_path = build_destination_path(&path, source, destination);

        if path.is_dir() {
            fs::create_dir_all(&dest_path)?; // 创建目标文件夹
            copy_other_files(&path, &dest_path)?; // 递归复制文件夹内容
        } else {
            fs::copy(&path, &dest_path)?; // 复制文件
        }
    }

    Ok(())
}

pub fn build_destination_path(path: &Path, source: &Path, destination: &Path) -> PathBuf {
    // 计算相对路径
    let relative_path = path.strip_prefix(source).unwrap_or_else(|_| path);
    // 拼接到目标路径
    destination.join(relative_path)
}