use std::{fs, io};
use std::path::Path;
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};

pub fn copy_dir_recursive(src: &Path, dst: &Path, delete_after_copy: bool) -> io::Result<()> {
    if src.is_file() {
        // 如果是文件，直接复制
        fs::copy(src, dst)?;

        if delete_after_copy {
            fs::remove_file(src)?;
        }
        return Ok(());
    }

    if !dst.exists() {
        fs::create_dir(dst)?;
    }

    let entries: Vec<_> = fs::read_dir(src)?
        .map(|res| res.map(|e| e.path()))
        .collect::<Result<Vec<_>, io::Error>>()?;

    entries.par_iter().try_for_each(|path| {
        let dst_path = dst.join(path.file_name().unwrap());

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path, delete_after_copy)
        } else {
            fs::copy(path, &dst_path).map(|_| ())?;

            if delete_after_copy {
                fs::remove_file(path)?;
            }
            Ok(())
        }
    })
}
