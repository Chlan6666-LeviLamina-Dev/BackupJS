use std::fs;
use std::fs::File;
use std::path::Path;
use futures::future::BoxFuture;
use futures::FutureExt;
use reqwest::Client;
use crate::{error, info};

pub async fn upload_file(client: &Client, file_path: &Path, url: &str, username: &str, password: &str) -> Result<(), Box<dyn std::error::Error>> {
    let file = File::open(file_path)?;
    let file_stream = reqwest::Body::wrap_stream(tokio_util::codec::FramedRead::new(tokio::fs::File::from_std(file), tokio_util::codec::BytesCodec::new()));

    let res = client
        .put(url)
        .basic_auth(username, Some(password))
        .body(file_stream)
        .send()
        .await?;

    if res.status().is_success() {
        info!("文件上传成功: {}", file_path.display());
    } else {
        error!("文件上传失败: {}", res.status());
    }

    Ok(())
}

pub fn upload_directory<'a>(client: &'a Client, dir_path: &'a Path, base_url: &'a str, remote_path: &'a str, username: &'a str, password: &'a str) -> BoxFuture<'a, Result<(), Box<dyn std::error::Error>>> {
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
                info!("上传文件: {}", remote_file_url); // 调试信息
                upload_file(client, &path, &remote_file_url, username, password).await?;
            } else if path.is_dir() {
                // 创建远程目录
                let res = client
                    .request(reqwest::Method::from_bytes(b"MKCOL")?, &remote_file_url)
                    .basic_auth(username, Some(password))
                    .send()
                    .await?;

                if res.status().is_success() {
                    info!("目录创建成功: {}", remote_file_url);
                } else {
                    error!("目录创建失败: {}", res.status());
                }

                // 递归上传子目录内容
                upload_directory(client, &path, base_url, &remote_file_url.strip_prefix(base_url).unwrap_or(&remote_file_url), username, password).await?;
            }
        }

        Ok(())
    }.boxed()
}

pub async fn upload_backup(file_path: &Path, webdav_url: &str, remote_path: &str, username: &str, password: &str, allow_insecure: bool) -> Result<(), Box<dyn std::error::Error>> {
    // 允许不安全的 HTTPS 连接（根据参数决定）
    let client_builder = reqwest::Client::builder();

    let client = if allow_insecure {
        client_builder.danger_accept_invalid_certs(true).build()?
    } else {
        client_builder.build()?
    };

    if file_path.is_file() {
        // 如果是文件，上传文件
        let file_name = file_path.file_name().unwrap().to_str().unwrap();
        let remote_file_url = format!("{}/{}", webdav_url.trim_end_matches('/'), format!("{}/{}", remote_path.trim_start_matches('/'), file_name));
        info!("准备上传文件到: {}", remote_file_url); // 调试信息
        upload_file(&client, file_path, &remote_file_url, username, password).await
    } else if file_path.is_dir() {
        // 如果是目录，上传目录内容
        info!("准备上传目录: {}", file_path.display()); // 调试信息
        upload_directory(&client, file_path, webdav_url, remote_path, username, password).await
    } else {
        Err("提供的路径无效".into())
    }
}
