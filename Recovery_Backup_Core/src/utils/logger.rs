use chrono::{DateTime, Local, Utc};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;

pub enum LogLevel {
    Info,
    Warning,
    Error,
    Debug,
}

pub fn log(level: LogLevel, message: &str) {
    let now: DateTime<Utc> = Utc::now();
    let local_now = now.with_timezone(&Local);

    let timestamp = local_now.format("%Y-%m-%d %H:%M:%S");

    let (log_level_str, log_level_str_no_color) = match level {
        LogLevel::Info => ("\x1b[32mINFO\x1b[0m", "INFO"),
        LogLevel::Warning => ("\x1b[33mWARNING\x1b[0m", "WARNING"),
        LogLevel::Error => ("\x1b[31mERROR\x1b[0m", "ERROR"),
        LogLevel::Debug => ("\x1b[34mDEBUG\x1b[0m", "DEBUG"),
    };

    // 根据日志级别选择输出到标准输出或标准错误
    match level {
        LogLevel::Error => eprintln!("[{}] {} {}", timestamp, log_level_str, message),
        _ => println!("[{}] {} {}", timestamp, log_level_str, message),
    }

    // 创建 logs 目录
    let logs_dir = "logs/BackupJS";
    create_dir_all(logs_dir).expect("Unable to create logs directory");

    // 生成按年-月-日格式的日志文件名
    let log_file_name = format!("{}/{}.log", logs_dir, local_now.format("%Y-%m-%d"));

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_name)
        .expect("Unable to open log file");

    // 文件写入不带颜色的日志
    writeln!(&mut file, "[{}] [{}] {}", timestamp, log_level_str_no_color, message)
        .expect("Unable to write to log file");
}

#[macro_export]
macro_rules! info {
    ($($arg:tt)*) => {
        $crate::utils::logger::log($crate::utils::logger::LogLevel::Info, &format!($($arg)*));
    };
}

#[macro_export]
macro_rules! warning {
    ($($arg:tt)*) => {
        $crate::utils::logger::log($crate::utils::logger::LogLevel::Warning, &format!($($arg)*));
    };
}

#[macro_export]
macro_rules! error {
    ($($arg:tt)*) => {
        $crate::utils::logger::log($crate::utils::logger::LogLevel::Error, &format!($($arg)*));
    };
}

#[macro_export]
macro_rules! debug {
    ($($arg:tt)*) => {
        $crate::utils::logger::log($crate::utils::logger::LogLevel::Debug, &format!($($arg)*));
    };
}
