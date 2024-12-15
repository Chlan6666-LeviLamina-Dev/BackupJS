use std::io;

// 函数：判断字符串是否是 Base64 编码
pub fn is_base64_encoded(input: &str) -> bool {
    input.len() % 4 == 0 && input.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}

pub fn send_request(url: &str, auth: Option<&str>) -> io::Result<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(1)) // 限制超时时间为1秒
        .build()
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string()))?;

    let mut request = client.get(url);

    if let Some(auth) = auth {
        request = request.header("Authorization", format!("Bearer {}", auth));
    }

    let response = request
        .send()
        .map_err(|err| io::Error::new(io::ErrorKind::Other, err.to_string()))?;

    // 返回 HTTP 响应状态码的字符串
    Ok(response.status().as_u16().to_string())
}
