use std::fmt;
use std::fs::create_dir_all;
use chrono::{Local};
use tracing_subscriber::{layer::SubscriberExt, EnvFilter};
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::util::SubscriberInitExt;

struct CustomTime;

impl FormatTime for CustomTime {
    fn format_time(&self, w: &mut tracing_subscriber::fmt::format::Writer<'_>) -> fmt::Result {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        write!(w, "{}", timestamp)
    }
}

pub fn init_logger() {
    let logs_dir = "logs/BackupJS";
    create_dir_all(logs_dir).expect("Unable to create logs directory");
    // 控制台层
    let console_layer = tracing_subscriber::fmt::layer()
        .with_timer(CustomTime) // 使用启动时间计时器
        .with_ansi(true)         // 控制台输出时使用 ANSI 转义字符
        .with_target(true);      // 显示目标模块

    // 文件层 - 按日期记录日志
    let file_layer = tracing_subscriber::fmt::layer()
        .with_timer(CustomTime)
        .with_ansi(false) // 文件无 ANSI 转义
        .with_target(true) // 显示目标模块
        .with_writer(std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!("{}/{}.log", logs_dir, Local::now().format("%Y-%m-%d")))
            .unwrap()); // 明确指定文件输出



    // 初始化日志订阅器
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")), // 根据配置设置日志级别
        )
        .with(console_layer)        // 控制台日志层
        .with(file_layer)           // 按日期日志文件层
        .init();                    // 初始化日志系统

}
