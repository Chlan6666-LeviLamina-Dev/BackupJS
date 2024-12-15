use std::{fs, io};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};
use serde::Serialize;

#[derive(Serialize)]
pub struct DirectoryStats {
    pub path: String,
    pub size: u64,
    pub file_count: u64,
}

pub fn get_directory_stats_sync(dir_path: &Path) -> io::Result<(u64, u64)> {
    let total_size = AtomicU64::new(0);
    let file_count = AtomicU64::new(0);

    let entries: Vec<_> = fs::read_dir(dir_path)?
        .filter_map(Result::ok)
        .collect();

    entries.par_iter().try_for_each(|entry| -> io::Result<()> {
        let path = entry.path();
        let metadata = fs::metadata(&path)?;

        if metadata.is_file() {
            total_size.fetch_add(metadata.len(), Ordering::Relaxed);
            file_count.fetch_add(1, Ordering::Relaxed);
        } else if metadata.is_dir() {
            let (size, count) = get_directory_stats_sync(&path)?;
            total_size.fetch_add(size, Ordering::Relaxed);
            file_count.fetch_add(count, Ordering::Relaxed);
        }
        Ok(())
    })?;

    Ok((total_size.load(Ordering::Relaxed), file_count.load(Ordering::Relaxed)))
}
