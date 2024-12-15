use std::{fs, io, thread};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tracing::{error, info};

pub fn delete_old_backups(backup_path: &Path, max_age_days: u64, extension: &str) -> io::Result<()> {
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
                    error!("Failed to delete file: {:?}", e);
                } else {
                    info!("Deleted old backup file: {:?}", path)
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


