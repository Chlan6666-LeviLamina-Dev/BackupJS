// 函数：判断字符串是否是 Base64 编码
pub fn is_base64_encoded(input: &str) -> bool {
    input.len() % 4 == 0 && input.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}
